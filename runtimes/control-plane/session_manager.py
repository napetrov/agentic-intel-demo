"""
Session lifecycle backends for the control plane.

A "session" maps 1:1 to one running agent workload. The control plane
exposes /sessions endpoints (in app.py) that fan out to one of these
backends:

  * `LocalSessionBackend`  — in-memory state-machine simulator.
    Used by docker-compose and `scripts/dev-up.sh` so the multi-session
    demo works without a live Kubernetes cluster. Sessions progress
    Pending → Running → Completed on a wall-clock timer; no real work
    is launched.

  * `KubeSessionBackend`   — creates a real `batch/v1.Job` per session
    from a ConfigMap-stored template (`session-job-template`). Used in
    the k8s deployment. Status is read back from the Job's conditions.

Backend selection is driven by the SESSION_BACKEND env var; defaulting
to `local` keeps the compose path working unchanged. Set
SESSION_BACKEND=kube in the k8s Deployment.

The two backends share the same `SessionRecord` shape, so callers (and
the web UI) don't need to know which one is in use.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict, fields
from typing import Any, Optional, Protocol

# Sibling module: the control-plane package isn't installable, so the
# import works the same way it does in app.py via PYTHONPATH munging.
from persistence import SqliteJsonStore

logger = logging.getLogger("control-plane.sessions")


# Pod-profile sizes mirror config/pod-profiles/profiles.yaml. Kept in code
# (not parsed from yaml) so the local backend can run without the file
# being mounted, which matters for the dev-up path.
PROFILES: dict[str, dict[str, str]] = {
    "small": {
        "cpu_request": "1",
        "cpu_limit": "2",
        "memory_request": "2Gi",
        "memory_limit": "4Gi",
    },
    "medium": {
        "cpu_request": "4",
        "cpu_limit": "8",
        "memory_request": "8Gi",
        "memory_limit": "16Gi",
    },
    "large": {
        "cpu_request": "16",
        "cpu_limit": "32",
        "memory_request": "32Gi",
        "memory_limit": "64Gi",
    },
}
DEFAULT_PROFILE = "small"

# Target systems the multi-agent fan-out can schedule onto. Mirrors the
# `systems` map in config/demo-systems.yaml; kept in code so the local
# backend can validate without the file being mounted. `None` means
# "use the scenario default" (System A for everything today, but the
# routing contract may evolve — keep the override path explicit).
TARGET_SYSTEMS: frozenset[str] = frozenset({"system_a", "system_b"})

# Session status vocabulary. Aligns with k8s Job conditions so the kube
# backend can map 1:1 without inventing extra states.
STATUS_PENDING = "Pending"
STATUS_RUNNING = "Running"
STATUS_COMPLETED = "Completed"
STATUS_FAILED = "Failed"
STATUS_DELETING = "Deleting"
TERMINAL_STATUSES = frozenset({STATUS_COMPLETED, STATUS_FAILED})


@dataclass
class SessionRecord:
    session_id: str
    scenario: str
    profile: str
    status: str
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    pod_name: Optional[str] = None
    job_name: Optional[str] = None
    backend: str = "local"
    cpu_request: Optional[str] = None
    memory_request: Optional[str] = None
    message: Optional[str] = None
    # Which demo system runs the agent. `None` = use the scenario's
    # catalog default. Surfaced so the UI can render each session in the
    # correct system pool (System A vs System B).
    target_system: Optional[str] = None
    # Backend-specific extras (e.g. raw k8s phase) live here so callers
    # can introspect without leaking k8s types into the public schema.
    extras: dict[str, Any] = field(default_factory=dict)

    def to_public(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("extras", None)
        return d


class SessionBackend(Protocol):
    name: str

    def create(
        self,
        scenario: str,
        profile: str,
        session_id: Optional[str] = None,
        target_system: Optional[str] = None,
    ) -> SessionRecord: ...
    def get(self, session_id: str) -> Optional[SessionRecord]: ...
    def list(self) -> list[SessionRecord]: ...
    def delete(self, session_id: str) -> bool: ...


def _validate_target_system(target_system: Optional[str]) -> Optional[str]:
    """Reject anything outside the allow-list.

    `None` is a first-class value (= "use scenario default") and passes
    through unchanged. We intentionally don't lower-case the input — a
    typo should fail loudly so the operator sees their mistake instead
    of silently scheduling on the wrong system.
    """
    if target_system is None:
        return None
    if target_system not in TARGET_SYSTEMS:
        raise ValueError(
            f"unknown target_system {target_system!r}; allowed={sorted(TARGET_SYSTEMS)}"
        )
    return target_system


def _new_session_id() -> str:
    # Short, URL-safe, sortable enough for demo logs. Don't use uuid4 hex
    # whole — the shorter id is friendlier in the UI table.
    return f"sess-{uuid.uuid4().hex[:10]}"


_SESSION_FIELD_NAMES = {f.name for f in fields(SessionRecord)}


def _record_from_dict(data: dict[str, Any]) -> SessionRecord:
    """Rebuild a SessionRecord from its persisted JSON form.

    Tolerates extra keys (forward-compat) and missing optional ones
    (records persisted by an older binary). `extras` is restored as a
    dict so backend-private bookkeeping survives a restart.
    """
    payload = {k: v for k, v in data.items() if k in _SESSION_FIELD_NAMES}
    payload.setdefault("extras", {})
    return SessionRecord(**payload)


class LocalSessionBackend:
    """Simulator backend with optional SQLite persistence.

    Without a path: in-memory only — every session moves
    Pending → Running → Completed on a fixed schedule, lost on restart.

    With ``db_path`` set (or via SESSIONS_DB_PATH): the same simulation,
    plus every mutation is durably committed. A restart rehydrates the
    record set and the lazy state-machine advance picks up where the
    wall-clock left off — sessions older than PENDING+RUNNING come back
    as Completed without re-running the timer.
    """

    name = "local"

    # Phase durations (seconds). Tuned so a "spawn 10 sessions" demo
    # finishes in under a minute but is slow enough to actually watch.
    PENDING_SECONDS = 1.5
    RUNNING_SECONDS = 8.0

    def __init__(self, db_path: Optional[str] = None) -> None:
        self._store = SqliteJsonStore(path=db_path, table="sessions")
        # _records is a write-through cache of the SQLite table — keeping
        # the dict in front of the DB preserves the existing O(1) reads
        # the demo's tight UI poll loop expects.
        self._records: dict[str, SessionRecord] = {}
        self._lock = threading.Lock()
        # Rehydrate on startup. The SqliteJsonStore returns the rows the
        # table actually contains; an in-memory store starts empty so this
        # is a no-op for the unit tests that don't pass a path.
        for key, data in self._store.items():
            try:
                self._records[key] = _record_from_dict(data)
            except (TypeError, ValueError) as exc:
                # A row written by a future binary may carry fields this
                # one can't parse; skip rather than crash the worker.
                logger.warning("dropped unparseable session %s: %s", key, exc)

    def _persist(self, rec: SessionRecord) -> None:
        """Write a record through to SQLite. Cheap no-op for in-memory mode."""
        self._store[rec.session_id] = asdict(rec)

    # The state machine runs on read so we don't need a background thread
    # (which would complicate uvicorn worker counts and shutdown). The
    # advance is idempotent — calling _advance() twice on the same record
    # is a no-op once it reaches a terminal state.
    #
    # Ordering: when the state changes, the durable write happens BEFORE
    # the in-memory mutation is published. _persist needs the new field
    # values, so we mutate `rec` in place, snapshot the originals, persist,
    # and roll back on failure. Without the rollback a SQLite hiccup would
    # leave the cache showing state that disappears on the next restart.
    def _advance(self, rec: SessionRecord, now: float) -> None:
        if rec.status in TERMINAL_STATUSES or rec.status == STATUS_DELETING:
            return
        snapshot = (rec.status, rec.started_at, rec.completed_at, rec.message)
        elapsed = now - rec.created_at
        if rec.status == STATUS_PENDING and elapsed >= self.PENDING_SECONDS:
            rec.status = STATUS_RUNNING
            rec.started_at = rec.created_at + self.PENDING_SECONDS
        if (
            rec.status == STATUS_RUNNING
            and elapsed >= (self.PENDING_SECONDS + self.RUNNING_SECONDS)
        ):
            rec.status = STATUS_COMPLETED
            rec.completed_at = rec.created_at + self.PENDING_SECONDS + self.RUNNING_SECONDS
            rec.message = f"simulated {rec.scenario} run completed"
        if rec.status != snapshot[0]:
            try:
                self._persist(rec)
            except Exception:
                rec.status, rec.started_at, rec.completed_at, rec.message = snapshot
                raise

    def create(
        self,
        scenario: str,
        profile: str,
        session_id: Optional[str] = None,
        target_system: Optional[str] = None,
    ) -> SessionRecord:
        if profile not in PROFILES:
            raise ValueError(f"unknown profile {profile!r}; allowed={sorted(PROFILES)}")
        target_system = _validate_target_system(target_system)
        sid = session_id or _new_session_id()
        with self._lock:
            if sid in self._records:
                raise ValueError(f"session {sid!r} already exists")
            specs = PROFILES[profile]
            rec = SessionRecord(
                session_id=sid,
                scenario=scenario,
                profile=profile,
                status=STATUS_PENDING,
                created_at=time.time(),
                pod_name=f"{sid}-pod",
                job_name=f"{sid}-job",
                backend=self.name,
                cpu_request=specs["cpu_request"],
                memory_request=specs["memory_request"],
                message="simulated session created (local backend)",
                target_system=target_system,
            )
            # Durable write first — if SQLite barfs, the in-memory cache
            # stays empty and the caller sees the failure instead of a
            # session that exists in memory but vanishes on restart.
            self._persist(rec)
            self._records[sid] = rec
            return rec

    def get(self, session_id: str) -> Optional[SessionRecord]:
        with self._lock:
            rec = self._records.get(session_id)
            if rec is None:
                return None
            self._advance(rec, time.time())
            return rec

    def list(self) -> list[SessionRecord]:
        now = time.time()
        with self._lock:
            for rec in self._records.values():
                self._advance(rec, now)
            # Sorted oldest-first so the UI table grows downward.
            return sorted(self._records.values(), key=lambda r: r.created_at)

    def close(self) -> None:
        """Release the underlying SQLite handle. Tests use this to keep
        tmp-path teardown clean on platforms that don't free open files
        eagerly. Production code holds the backend for the whole process
        lifetime and never calls this."""
        self._store.close()

    def delete(self, session_id: str) -> bool:
        with self._lock:
            if session_id not in self._records:
                return False
            # The local backend has no real teardown work to wait on, so
            # we drop the record directly. (An earlier draft set
            # STATUS_DELETING here, but that transition was never
            # observable — the dict entry was removed in the same locked
            # section.)
            # Drop from disk before cache so a SQLite failure leaves both
            # views consistent (record still present in both) instead of
            # resurrecting the session on the next process restart.
            self._store.pop(session_id, None)
            del self._records[session_id]
            return True


class KubeSessionBackend:
    """Creates one batch/v1.Job per session in the agents namespace.

    The Job spec is rendered from a ConfigMap-stored template
    (`session-job-template`, key `job.yaml`) — the operator can edit the
    template without redeploying the control plane. Resource requests
    come from the named profile.

    Status mapping:
      no pods running, no condition           → Pending
      ≥1 active pod                           → Running
      condition Complete=True                 → Completed
      condition Failed=True (backoff exhausted) → Failed

    The kubernetes Python client is imported lazily so the local backend
    keeps working when the package isn't installed (e.g. in the
    docker-compose image for the agent-stub). When the kube backend is
    selected but the package is missing, this constructor raises so the
    operator gets a clear error at startup, not on the first request.
    """

    name = "kube"

    def __init__(
        self,
        namespace: str,
        template_configmap: str,
        template_namespace: Optional[str] = None,
        kubeconfig_path: Optional[str] = None,
        session_image: Optional[str] = None,
        ttl_seconds_after_finished: int = 600,
    ) -> None:
        try:
            from kubernetes import client, config  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError(
                "SESSION_BACKEND=kube requires the 'kubernetes' package; "
                "install it in the control-plane image"
            ) from exc

        self._client = client
        if kubeconfig_path:
            config.load_kube_config(config_file=kubeconfig_path)
        else:
            try:
                config.load_incluster_config()
            except config.ConfigException:
                # Falls back to default kubeconfig — useful when running
                # the control plane outside the cluster for debugging.
                config.load_kube_config()
        self._batch = client.BatchV1Api()
        self._core = client.CoreV1Api()
        self._namespace = namespace
        self._template_configmap = template_configmap
        self._template_namespace = template_namespace or namespace
        self._session_image = session_image
        self._ttl = ttl_seconds_after_finished

    # Env vars the template can reference as ${NAME}. Anything not in this
    # allow-list is left verbatim so the template can carry literal `${...}`
    # text on purpose. Kept narrow because the substituted values land in
    # Pod env / image fields where a typo silently produces a broken Pod.
    _SUBSTITUTABLE_ENV_VARS = (
        "SESSION_IMAGE",
        "AWS_REGION",
        "AWS_BEARER_TOKEN_BEDROCK",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "BEDROCK_MODEL_ID",
    )

    @classmethod
    def _interpolate(cls, raw: str) -> str:
        """Expand ${NAME} references for the allow-listed env vars.

        Used on the raw ConfigMap text before yaml.safe_load() so the
        Job that lands in the cluster has concrete values, not literal
        '${...}' placeholders. A missing env var becomes an empty string
        — the same fallback Bash and envsubst use — so an operator who
        forgets to set one sees a Pod failing on empty config rather
        than a confusing parse error.
        """
        import re

        def repl(match):
            name = match.group(1)
            if name not in cls._SUBSTITUTABLE_ENV_VARS:
                return match.group(0)  # leave unknown placeholders alone
            return os.environ.get(name, "")

        return re.sub(r"\$\{([A-Z0-9_]+)\}", repl, raw)

    def _load_template(self) -> dict:
        # Loaded fresh on every create() so an operator edit (kubectl
        # edit configmap session-job-template) takes effect for the next
        # session without restarting the control plane. The cost is one
        # extra GET per session create — negligible at the demo's rate.
        cm = self._core.read_namespaced_config_map(
            name=self._template_configmap, namespace=self._template_namespace
        )
        raw = (cm.data or {}).get("job.yaml")
        if not raw:
            raise RuntimeError(
                f"ConfigMap {self._template_configmap!r} missing key 'job.yaml'"
            )
        # Resolve ${...} placeholders before parsing so the loaded spec
        # already contains concrete strings — otherwise the agent Pod
        # gets env vars whose values are literal `${AWS_REGION}` etc.
        raw = self._interpolate(raw)
        import yaml  # local import: yaml is a kubernetes-package dep
        spec = yaml.safe_load(raw)
        if not isinstance(spec, dict):
            raise RuntimeError("session-job-template job.yaml did not parse to a mapping")
        return spec

    def _render_job(
        self,
        session_id: str,
        scenario: str,
        profile: str,
        target_system: Optional[str] = None,
    ) -> tuple[dict, str]:
        if profile not in PROFILES:
            raise ValueError(f"unknown profile {profile!r}")
        specs = PROFILES[profile]
        spec = self._load_template()
        # Strip generateName if the template carries one — we provide an
        # explicit, deterministic name so callers can address the Job by
        # session_id without an extra lookup.
        meta = spec.setdefault("metadata", {})
        job_name = f"{session_id}-job"
        meta["name"] = job_name
        meta.pop("generateName", None)
        labels = meta.setdefault("labels", {})
        labels.update(
            {
                "session-id": session_id,
                "scenario": scenario,
                "profile": profile,
                "managed-by": "control-plane",
            }
        )
        if target_system:
            # Label so an operator can `kubectl get jobs -l target-system=system_b`
            # and so a downstream controller (federation, scheduler webhook)
            # can route the Job to the right cluster/nodepool.
            labels["target-system"] = target_system
        else:
            # `target_system=None` means "use scenario default" — the
            # API contract is that the session round-trips with
            # target_system=null. If the operator-managed template
            # already carried a `target-system` label, leaving it in
            # place would tag this Job as that stale system and make
            # _record_for_job read it back as non-null, silently
            # breaking the contract. Clear it explicitly.
            labels.pop("target-system", None)

        job_spec = spec.setdefault("spec", {})
        job_spec.setdefault("ttlSecondsAfterFinished", self._ttl)
        pod_template = job_spec.setdefault("template", {})
        pod_meta = pod_template.setdefault("metadata", {})
        pod_labels = pod_meta.setdefault("labels", {})
        pod_labels.update(
            {
                "session-id": session_id,
                "scenario": scenario,
                "profile": profile,
            }
        )
        if target_system:
            pod_labels["target-system"] = target_system
        else:
            # Same reasoning as the Job-level label above — clear any
            # stale value from the template so pod selectors don't trip
            # on inherited routing.
            pod_labels.pop("target-system", None)
        pod_spec = pod_template.setdefault("spec", {})
        containers = pod_spec.get("containers") or []
        if not containers:
            raise RuntimeError("session-job-template has no containers")
        container = containers[0]
        if self._session_image:
            container["image"] = self._session_image
        # Inject scenario / profile envs so the agent process knows what
        # it was launched for. We append rather than replace so template
        # envs (model creds, etc.) survive.
        envs = container.setdefault("env", [])
        envs.append({"name": "SESSION_ID", "value": session_id})
        envs.append({"name": "SCENARIO", "value": scenario})
        envs.append({"name": "PROFILE", "value": profile})
        if target_system:
            envs.append({"name": "TARGET_SYSTEM", "value": target_system})
        # Profile-driven resources override whatever the template set.
        container["resources"] = {
            "requests": {
                "cpu": specs["cpu_request"],
                "memory": specs["memory_request"],
            },
            "limits": {
                "cpu": specs["cpu_limit"],
                "memory": specs["memory_limit"],
            },
        }
        return spec, job_name

    @staticmethod
    def _status_from_job(job, pods) -> tuple[str, Optional[float], Optional[float], Optional[str]]:
        """Translate (Job, [Pod]) → (status, started_at, completed_at, message).

        Pure function so it can be unit-tested without a live cluster
        (see tests/test_sessions.py).
        """
        st = getattr(job, "status", None) or {}
        # job.status may be either a kubernetes V1JobStatus or a plain dict
        # (the unit tests pass dicts to avoid pulling in the k8s types).
        def _get(obj, key, default=None):
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, default)

        # Pull start_time once — terminal Jobs (Complete/Failed) still
        # have it set by the controller, and the UI uses it to compute
        # session duration. Returning None for those would hide useful
        # signal even though the data is right there in the status.
        start_time = _get(st, "start_time") or _get(st, "startTime")
        started_ts = start_time.timestamp() if hasattr(start_time, "timestamp") else None

        conditions = _get(st, "conditions") or []
        for cond in conditions:
            ctype = _get(cond, "type")
            cstatus = _get(cond, "status")
            if ctype == "Complete" and cstatus == "True":
                completed_at = _get(cond, "last_transition_time") or _get(cond, "lastTransitionTime")
                ts = completed_at.timestamp() if hasattr(completed_at, "timestamp") else None
                return STATUS_COMPLETED, started_ts, ts, _get(cond, "message")
            if ctype == "Failed" and cstatus == "True":
                completed_at = _get(cond, "last_transition_time") or _get(cond, "lastTransitionTime")
                ts = completed_at.timestamp() if hasattr(completed_at, "timestamp") else None
                return STATUS_FAILED, started_ts, ts, _get(cond, "message") or "job failed"

        active = _get(st, "active") or 0
        if active > 0 or pods:
            return STATUS_RUNNING, started_ts, None, None
        return STATUS_PENDING, None, None, None

    def _record_for_job(
        self, session_id: str, job, pods
    ) -> SessionRecord:
        labels = (job.metadata.labels or {}) if hasattr(job, "metadata") else {}
        scenario = labels.get("scenario", "unknown")
        profile = labels.get("profile", DEFAULT_PROFILE)
        # Read target_system back from the Job label so list/get reflect
        # the choice made at create time — even if the control-plane
        # process restarted between create and the next poll.
        target_system = labels.get("target-system") or None
        specs = PROFILES.get(profile, PROFILES[DEFAULT_PROFILE])
        status, started_at, completed_at, message = self._status_from_job(job, pods)
        created_at = (
            job.metadata.creation_timestamp.timestamp()
            if getattr(job.metadata, "creation_timestamp", None)
            else time.time()
        )
        pod_name = pods[0].metadata.name if pods else None
        return SessionRecord(
            session_id=session_id,
            scenario=scenario,
            profile=profile,
            status=status,
            created_at=created_at,
            started_at=started_at,
            completed_at=completed_at,
            pod_name=pod_name,
            job_name=job.metadata.name,
            backend=self.name,
            cpu_request=specs["cpu_request"],
            memory_request=specs["memory_request"],
            message=message,
            target_system=target_system,
        )

    def create(
        self,
        scenario: str,
        profile: str,
        session_id: Optional[str] = None,
        target_system: Optional[str] = None,
    ) -> SessionRecord:
        target_system = _validate_target_system(target_system)
        sid = session_id or _new_session_id()
        # Wrap the template-read AND the Job create in the same translator.
        # _render_job() calls _load_template() which does a ConfigMap GET —
        # if that fails (missing ConfigMap, RBAC denied, API outage) we want
        # the caller to see a backend error (502), not an unhandled 500.
        # ValueError / RuntimeError from _render_job (unknown profile,
        # malformed template) keep their own semantics and bubble up
        # untouched.
        try:
            spec, job_name = self._render_job(
                sid, scenario, profile, target_system=target_system
            )
            self._batch.create_namespaced_job(namespace=self._namespace, body=spec)
        except self._client.exceptions.ApiException as exc:
            # 409 Conflict means the Job name (deterministic from session_id)
            # is already taken — surface as ValueError so the FastAPI handler
            # returns 400, matching LocalSessionBackend.create's duplicate-id
            # behavior. Without this, a duplicate session_id would 502 on the
            # kube backend and 400 on the local backend — confusing for
            # callers writing against the same wire contract.
            if getattr(exc, "status", None) == 409:
                raise ValueError(f"session {sid!r} already exists") from exc
            raise RuntimeError(
                f"failed to create session Job for {sid}: {exc.status} {exc.reason}"
            ) from exc
        # Read back so we report the same fields as get(); avoids a 0-state
        # window where the UI would otherwise show "unknown" for a moment.
        try:
            job = self._batch.read_namespaced_job(name=job_name, namespace=self._namespace)
        except self._client.exceptions.ApiException:
            # Job is created but not yet readable — return a Pending stub
            # built from the requested spec so the caller still gets a
            # well-formed record.
            specs = PROFILES[profile]
            return SessionRecord(
                session_id=sid,
                scenario=scenario,
                profile=profile,
                status=STATUS_PENDING,
                created_at=time.time(),
                job_name=job_name,
                backend=self.name,
                cpu_request=specs["cpu_request"],
                memory_request=specs["memory_request"],
                message="job created; status not yet available",
                target_system=target_system,
            )
        return self._record_for_job(sid, job, pods=[])

    def get(self, session_id: str) -> Optional[SessionRecord]:
        job_name = f"{session_id}-job"
        try:
            job = self._batch.read_namespaced_job(name=job_name, namespace=self._namespace)
            pods = self._core.list_namespaced_pod(
                namespace=self._namespace,
                label_selector=f"session-id={session_id}",
            ).items
        except self._client.exceptions.ApiException as exc:
            if getattr(exc, "status", None) == 404:
                return None
            # Anything else (RBAC, API outage, 5xx) gets translated to
            # RuntimeError so the FastAPI handler can return 502 instead
            # of leaking a raw ApiException as a 500.
            raise RuntimeError(
                f"failed to read session {session_id!r}: {exc.status} {exc.reason}"
            ) from exc
        return self._record_for_job(session_id, job, pods)

    def list(self) -> list[SessionRecord]:
        try:
            jobs = self._batch.list_namespaced_job(
                namespace=self._namespace,
                label_selector="managed-by=control-plane",
            ).items
        except self._client.exceptions.ApiException as exc:
            raise RuntimeError(
                f"failed to list sessions: {exc.status} {exc.reason}"
            ) from exc
        # One label-selector pod query per Job is wasteful at scale, but at
        # the demo's session count (tens, not thousands) it's simpler than
        # joining the full pod list client-side.
        out: list[SessionRecord] = []
        for job in jobs:
            sid = (job.metadata.labels or {}).get("session-id")
            if not sid:
                continue
            try:
                pods = self._core.list_namespaced_pod(
                    namespace=self._namespace,
                    label_selector=f"session-id={sid}",
                ).items
            except self._client.exceptions.ApiException as exc:
                raise RuntimeError(
                    f"failed to list pods for session {sid!r}: {exc.status} {exc.reason}"
                ) from exc
            out.append(self._record_for_job(sid, job, pods))
        out.sort(key=lambda r: r.created_at)
        return out

    def delete(self, session_id: str) -> bool:
        job_name = f"{session_id}-job"
        try:
            self._batch.delete_namespaced_job(
                name=job_name,
                namespace=self._namespace,
                # Foreground propagation so the Job's pods go away too;
                # without this k8s would leave the pod orphaned briefly.
                body=self._client.V1DeleteOptions(propagation_policy="Foreground"),
            )
        except self._client.exceptions.ApiException as exc:
            if getattr(exc, "status", None) == 404:
                return False
            raise RuntimeError(
                f"failed to delete session {session_id!r}: {exc.status} {exc.reason}"
            ) from exc
        return True


def make_backend() -> SessionBackend:
    """Factory driven by env vars. Default is `local` so the existing
    docker-compose path works without further configuration.
    """
    kind = os.environ.get("SESSION_BACKEND", "local").strip().lower()
    if kind == "local":
        # SESSIONS_DB_PATH points at a sqlite file mounted on a volume
        # in compose / dev-up; unset = in-memory only, which is what the
        # unit tests rely on.
        return LocalSessionBackend(db_path=os.environ.get("SESSIONS_DB_PATH") or None)
    if kind == "kube":
        namespace = os.environ.get("AGENTS_NAMESPACE", "agents")
        template = os.environ.get("SESSION_TEMPLATE_CONFIGMAP", "session-job-template")
        template_ns = os.environ.get("SESSION_TEMPLATE_NAMESPACE") or namespace
        kubeconfig = os.environ.get("SESSION_KUBECONFIG") or None
        session_image = os.environ.get("SESSION_IMAGE") or None
        return KubeSessionBackend(
            namespace=namespace,
            template_configmap=template,
            template_namespace=template_ns,
            kubeconfig_path=kubeconfig,
            session_image=session_image,
        )
    raise RuntimeError(f"unknown SESSION_BACKEND={kind!r}; expected 'local' or 'kube'")
