"""
Control-plane offload relay — System A entry point for offload_system_b route.

Implements the documented contract in docs/contracts/offload-result-contract.md
and docs/architecture.md:

    POST /offload            -> submit a task, returns {job_id, status}
    GET  /offload/{job_id}   -> poll the job, returns status + result/ref
    GET  /artifacts/{ref}    -> presigned URL for MinIO-stored results

Forwards execution to the System B offload-worker over HTTP. Job state is
kept in-memory: the control plane is a thin relay, not a queue. For the
demo scope that is intentional — a real deployment would persist state.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

import boto3
import httpx
from botocore.client import Config as BotoConfig
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

# Ensure sibling modules in this directory resolve when app.py is loaded
# via importlib (the test suite does this so it can import app.py without
# making runtimes/control-plane an installable package).
import sys as _sys
from pathlib import Path as _Path
_HERE = _Path(__file__).resolve().parent
if str(_HERE) not in _sys.path:
    _sys.path.insert(0, str(_HERE))

from persistence import SqliteJsonStore  # noqa: E402
from session_manager import (  # noqa: E402  (after sys.path tweak)
    DEFAULT_PROFILE,
    PROFILES,
    TARGET_SYSTEMS,
    SessionBackend,
    make_backend,
)
from agent_registry import (  # noqa: E402
    AGENT_KINDS,
    AGENT_SYSTEMS,
    make_registry,
)

app = FastAPI(title="demo-control-plane", version="0.1.0")
logger = logging.getLogger("control-plane")


def _parse_env_number(name: str, default: str, caster):
    raw = os.environ.get(name, default)
    try:
        return caster(raw)
    except ValueError:
        logger.warning(
            "invalid value for %s=%r (expected %s); falling back to default %s",
            name, raw, caster.__name__, default,
        )
        return caster(default)


OFFLOAD_WORKER_URL = os.environ.get(
    "OFFLOAD_WORKER_URL", "http://offload-worker.system-b.svc.cluster.local:8080"
).rstrip("/")
OFFLOAD_TIMEOUT_SECONDS = _parse_env_number("OFFLOAD_TIMEOUT_SECONDS", "60", float)
OFFLOAD_ASYNC_SUBMIT = os.environ.get("OFFLOAD_ASYNC_SUBMIT", "0").strip().lower() in {"1", "true", "yes", "on"}
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "demo-artifacts")
PRESIGN_EXPIRES_SECONDS = _parse_env_number("PRESIGN_EXPIRES_SECONDS", "900", int)

# Optional probe targets surfaced via /probe/{name}. Each is a base URL or
# health URL; when unset, the probe returns state="unconfigured" so the UI
# can show a neutral "not wired" indicator instead of falsely reporting OK.
# Keys here match the data-health attribute values in web-demo/index.html.
PROBE_TARGETS: dict[str, str] = {
    "openclaw": os.environ.get("OPENCLAW_GATEWAY_URL", "").rstrip("/"),
    "litellm": os.environ.get("LITELLM_BASE_URL", "").rstrip("/"),
    "sambanova": os.environ.get("SAMBANOVA_PROBE_URL", "").rstrip("/"),
}
# Path appended to the base URL when probing. OpenClaw exposes /health (the
# agent-stub stand-in does too); LiteLLM exposes /health/liveliness in 1.x
# but the cheap, auth-free check is just `/`. Override per-target if needed.
PROBE_PATHS: dict[str, str] = {
    "openclaw": os.environ.get("OPENCLAW_PROBE_PATH", "/health"),
    "litellm": os.environ.get("LITELLM_PROBE_PATH", "/health/liveliness"),
    "sambanova": os.environ.get("SAMBANOVA_PROBE_PATH", "/"),
}
# Optional bearer tokens for endpoints that require auth even for a cheap
# liveness/model-list probe. Values are never returned to the browser; the
# public /probe response exposes only the logical target name.
PROBE_BEARER_TOKENS: dict[str, str] = {
    "litellm": os.environ.get("LITELLM_API_KEY", ""),
    "sambanova": os.environ.get("SAMBANOVA_API_KEY", ""),
}
PROBE_TIMEOUT_SECONDS = _parse_env_number("PROBE_TIMEOUT_SECONDS", "2.5", float)


def _safe_probe_target(url: str) -> str:
    """Strip userinfo, query, and fragment from a probe URL before it
    leaves the control plane. Operators sometimes embed credentials or
    api-keys in env-configured URLs (e.g. http://user:token@host/...);
    the probe response is consumed by browsers via /api/probe/{name},
    so we don't want those parts on the wire.

    Returns "" on malformed input so the caller can substitute a
    non-leaking identifier (the probe's logical name) instead.
    """
    try:
        parts = urlsplit(url)
        # parts.port raises ValueError for non-numeric or out-of-range
        # port specifications (e.g. "host:abc", "host:99999"); guard so
        # bad config doesn't 500 the probe handler.
        port = parts.port
    except ValueError:
        return ""
    host = parts.hostname or ""
    if port is not None:
        host = f"{host}:{port}"
    return urlunsplit((parts.scheme, host, parts.path, "", ""))


# Durable job registry. JOBS_DB_PATH points at a sqlite file; leave it
# unset (or ":memory:") to keep the previous in-memory behavior — the
# unit tests rely on that default so they don't need a writable cwd.
# The compose / dev-up path mounts a volume and sets the env var so a
# `docker compose restart control-plane` no longer drops every job's
# result_ref. See docs/contracts/offload-result-contract.md.
_jobs = SqliteJsonStore(
    path=os.environ.get("JOBS_DB_PATH") or None,
    table="jobs",
)
# Back-compat alias: the unit tests acquire `_jobs_lock` around direct
# dict access. The store ships a re-entrant lock that callers can hold
# externally for read-modify-write sequences.
_jobs_lock = _jobs.lock

# Lazily-initialised S3/MinIO client, shared across /artifacts calls.
# boto3.client() is not cheap — several hundred ms on cold import under load.
_s3: Optional[Any] = None
_s3_lock = threading.Lock()


def _s3_client():
    if not MINIO_ENDPOINT:
        raise HTTPException(status_code=503, detail="MINIO_ENDPOINT not configured")
    global _s3
    if _s3 is None:
        with _s3_lock:
            if _s3 is None:
                _s3 = boto3.client(
                    "s3",
                    endpoint_url=MINIO_ENDPOINT,
                    aws_access_key_id=MINIO_ACCESS_KEY,
                    aws_secret_access_key=MINIO_SECRET_KEY,
                    region_name="us-east-1",
                    config=BotoConfig(signature_version="s3v4"),
                )
    return _s3


class OffloadRequest(BaseModel):
    task_type: str = Field(min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None
    # gt=0: a non-positive timeout is a client error, not "use default".
    timeout_seconds: Optional[float] = Field(default=None, gt=0)


class OffloadSubmitted(BaseModel):
    job_id: str
    status: str
    session_id: Optional[str] = None


class OffloadStatus(BaseModel):
    job_id: str
    status: str
    session_id: Optional[str] = None
    task_id: Optional[str] = None
    result: Optional[Any] = None
    result_ref: Optional[str] = None
    error: Optional[str] = None
    submitted_at: float
    completed_at: Optional[float] = None


class ArtifactRef(BaseModel):
    ref: str
    url: str
    expires_in: int


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. Returns 200 as long as the process is up."""
    return {"status": "ok"}


@app.get("/probe/{name}")
def probe_dependency(name: str) -> dict[str, Any]:
    """Best-effort liveness probe of a named external dependency.

    Used by the web demo's "Platform health" rail so each indicator
    reflects something real instead of mirroring control-plane health.
    Returns {state, target?, detail?}; states:
      ok            target answered 2xx
      down          target unreachable / non-2xx
      unconfigured  no target URL is configured for this name
    """
    if name not in PROBE_TARGETS:
        raise HTTPException(status_code=404, detail=f"unknown probe {name!r}")
    base = PROBE_TARGETS[name]
    if not base:
        return {"state": "unconfigured"}
    url = base + PROBE_PATHS.get(name, "/health")
    # The probe's `target` field is consumed by the browser, so we surface
    # only the probe's logical name. The full URL stays in server-side
    # logs for the operator. _safe_probe_target() is still computed so a
    # future caller (e.g. an admin endpoint) can opt into a sanitized
    # URL instead of the bare name.
    _safe_probe_target(url)
    headers = {}
    bearer_token = PROBE_BEARER_TOKENS.get(name, "")
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    try:
        r = httpx.get(url, headers=headers, timeout=PROBE_TIMEOUT_SECONDS)
        r.raise_for_status()
    except (httpx.HTTPError, httpx.InvalidURL, ValueError) as exc:
        # httpx.HTTPError covers connect/read/timeout/non-2xx;
        # httpx.InvalidURL is a sibling (NOT a subclass) and triggers on
        # malformed URLs; ValueError can leak from urlsplit/.port for
        # bad port syntax. Bad config must surface as state=down, never
        # as a 500 from this handler.
        logger.warning("probe %s failed: url=%s err=%s", name, url, exc)
        return {
            "state": "down",
            "target": name,
            "detail": type(exc).__name__,
        }
    return {"state": "ok", "target": name}


@app.get("/ready")
def ready() -> dict[str, str]:
    """Readiness probe. Returns 503 until the offload-worker is reachable.

    Used by the Deployment's readinessProbe so k8s won't route traffic
    until the relay can actually forward to its upstream. Kept cheap — a
    short-timeout GET on the worker's /health.
    """
    try:
        r = httpx.get(f"{OFFLOAD_WORKER_URL}/health", timeout=2.0)
        r.raise_for_status()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=503, detail=f"offload-worker not ready: {exc}"
        ) from exc
    return {"status": "ready"}


def _run_offload_worker(job_id: str, req: OffloadRequest, timeout: float) -> None:
    """Execute the worker call and update the job registry.

    The public demo uses this in a background thread so POST /offload can
    return `running` immediately and the browser can observe a real
    running → completed transition via polling. Unit/local paths can keep
    synchronous submission by leaving OFFLOAD_ASYNC_SUBMIT unset.
    """
    try:
        resp = httpx.post(
            f"{OFFLOAD_WORKER_URL}/run",
            json={
                "task_type": req.task_type,
                "payload": req.payload,
                "session_id": req.session_id,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        body = resp.json()
        if not isinstance(body, dict):
            raise ValueError(
                f"unexpected offload-worker payload type: {type(body).__name__}"
            )
    except (httpx.HTTPError, ValueError) as exc:
        _jobs.update_fields(
            job_id,
            status="error",
            error=f"offload-worker call failed: {exc}",
            completed_at=time.time(),
        )
        return

    worker_status = body.get("status")
    if worker_status == "ok":
        _jobs.update_fields(
            job_id,
            task_id=body.get("task_id"),
            completed_at=time.time(),
            status="completed",
            result=body.get("result"),
            result_ref=body.get("result_key"),
        )
    else:
        _jobs.update_fields(
            job_id,
            task_id=body.get("task_id"),
            completed_at=time.time(),
            status="error",
            error=body.get("error") or "offload-worker returned error",
        )


@app.post("/offload", response_model=OffloadSubmitted)
def submit_offload(req: OffloadRequest) -> OffloadSubmitted:
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    now = time.time()
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "running",
        "session_id": req.session_id,
        "task_id": None,
        "result": None,
        "result_ref": None,
        "error": None,
        "submitted_at": now,
        "completed_at": None,
    }

    # `is not None`: 0 is an invalid request (validator rejects it), not
    # "use the default". Truthiness would silently coerce 0 to default.
    timeout = (
        req.timeout_seconds
        if req.timeout_seconds is not None
        else OFFLOAD_TIMEOUT_SECONDS
    )

    if OFFLOAD_ASYNC_SUBMIT:
        threading.Thread(
            target=_run_offload_worker,
            args=(job_id, req, timeout),
            name=f"offload-{job_id}",
            daemon=True,
        ).start()
        return OffloadSubmitted(
            job_id=job_id,
            status="running",
            session_id=req.session_id,
        )

    _run_offload_worker(job_id, req, timeout)
    entry = _jobs[job_id]
    if entry["status"] == "error" and str(entry.get("error") or "").startswith(
        "offload-worker call failed:"
    ):
        raise HTTPException(status_code=502, detail=entry["error"])

    return OffloadSubmitted(
        job_id=job_id,
        status=entry["status"],
        session_id=req.session_id,
    )


@app.get("/offload/{job_id}", response_model=OffloadStatus)
def get_offload(job_id: str) -> OffloadStatus:
    entry = _jobs.get(job_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"unknown job_id {job_id}")
    return OffloadStatus(**entry)


# ---------------------------------------------------------------------------
# Sessions API — multi-agent fan-out
# ---------------------------------------------------------------------------
#
# Each session is one running agent workload. In the k8s deployment the
# backend creates a batch/v1.Job per session; in the docker-compose / dev-up
# path it simulates the same lifecycle in-memory. Either way the wire
# contract is identical so the web UI doesn't need to know which is in
# use. See session_manager.py for the backend implementations.
#
# Routes:
#   POST   /sessions             create one session
#   POST   /sessions/batch       create N sessions in one call (load demo)
#   GET    /sessions             list all sessions
#   GET    /sessions/{id}        poll one session
#   DELETE /sessions/{id}        request termination

# Hard cap on a single batch create so a runaway browser tab can't DoS the
# backend by asking for ten thousand Jobs at once. The local backend stores
# everything in-memory, so a generous-but-bounded ceiling keeps RAM finite.
SESSION_BATCH_MAX = int(os.environ.get("SESSION_BATCH_MAX", "50"))

# Build the backend once at import time. Failures here propagate to the
# uvicorn startup so the operator sees them in the deployment logs instead
# of getting a confusing 500 on the first /sessions call.
_session_backend: SessionBackend = make_backend()
logger.info("session backend: %s", _session_backend.name)

# Long-lived agent registry. Read-only in v1: declared in
# config/agents.yaml, optionally overlaid with live cluster status when
# AGENT_DISCOVERY=kube. A malformed registry file is a startup error so
# the operator sees it in deployment logs (mirrors make_backend()).
_agent_registry = make_registry()
logger.info("agent registry seeded with %d agent(s)", len(_agent_registry.ids()))


# K8s DNS-1035 labels (used for Job names) cap at 63 chars; KubeSessionBackend
# appends "-job" (4 chars) to session_id when forming the Job name, so the
# bound here is 59. `scenario` becomes a label value (max 63 chars). These
# limits matter even when SESSION_BACKEND=local: a request that succeeds
# locally should also succeed against the kube backend, otherwise demo
# viewers hit an inconsistency the moment they switch backends.
_K8S_LABEL_MAX = 63
_SESSION_ID_MAX = _K8S_LABEL_MAX - len("-job")  # 59


class SessionCreateRequest(BaseModel):
    scenario: str = Field(min_length=1, max_length=_K8S_LABEL_MAX)
    profile: str = Field(default=DEFAULT_PROFILE)
    session_id: Optional[str] = Field(default=None, max_length=_SESSION_ID_MAX)
    # Optional override of the system that runs the agent. None = use the
    # scenario's catalog default (today: System A for everything).
    # Validated against TARGET_SYSTEMS in the route handler so the error
    # body lists the allowed values.
    target_system: Optional[str] = Field(default=None)
    # Optional attribution to a long-lived agent in the registry. None =
    # ephemeral (today's behavior). Validated against the registry at
    # the API edge (unknown id → 400) so the backend stays decoupled.
    agent_id: Optional[str] = Field(default=None, max_length=_K8S_LABEL_MAX)


class SessionBatchRequest(BaseModel):
    # No session_id field on batch — ids are auto-generated, and the
    # generator (sess- + 10 hex chars) is well under the limit.
    scenario: str = Field(min_length=1, max_length=_K8S_LABEL_MAX)
    profile: str = Field(default=DEFAULT_PROFILE)
    # gt=0: zero sessions is a no-op the client could just not send.
    count: int = Field(gt=0)
    target_system: Optional[str] = Field(default=None)
    agent_id: Optional[str] = Field(default=None, max_length=_K8S_LABEL_MAX)


class SessionResponse(BaseModel):
    session_id: str
    scenario: str
    profile: str
    status: str
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    pod_name: Optional[str] = None
    job_name: Optional[str] = None
    backend: str
    cpu_request: Optional[str] = None
    memory_request: Optional[str] = None
    message: Optional[str] = None
    target_system: Optional[str] = None
    agent_id: Optional[str] = None


class SessionListResponse(BaseModel):
    backend: str
    total: int
    by_status: dict[str, int]
    sessions: list[SessionResponse]
    # Populated by /sessions/batch when the loop bails early so the
    # caller learns *why* the batch was partial (kube quota, RBAC,
    # transient API outage, etc.) instead of just seeing `_error: 1`
    # in by_status. Always None for full-success responses and for
    # /sessions (list).
    error: Optional[str] = None


def _record_to_response(rec) -> SessionResponse:
    return SessionResponse(**rec.to_public())


@app.get("/sessions/profiles")
def list_profiles() -> dict[str, Any]:
    """Resource specs the /sessions endpoint accepts. Surfaced so the web
    UI can render the profile picker without hard-coding the table."""
    return {
        "default": DEFAULT_PROFILE,
        "profiles": PROFILES,
    }


@app.get("/sessions/target-systems")
def list_target_systems() -> dict[str, Any]:
    """Allowed target_system values for /sessions and /sessions/batch.

    Lets the web UI render the system picker without hard-coding the
    list — when a new system is added to TARGET_SYSTEMS the picker
    picks it up on the next page reload.
    """
    return {
        "default": None,
        "target_systems": sorted(TARGET_SYSTEMS),
    }


def _validate_agent_id_request(agent_id: Optional[str]) -> None:
    """Reject unknown agent_id values at the API edge.

    Mirrors the pattern used for target_system: keep the backend agnostic
    of the registry, surface a clear allow-list error to the caller. An
    empty registry (e.g. no config/agents.yaml) means *any* agent_id is
    rejected — that's deliberate, since there's nothing to attribute to.
    """
    if agent_id is None:
        return
    known = _agent_registry.ids()
    if agent_id not in known:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown agent_id {agent_id!r}; "
                f"registered={sorted(known) or '[]'}"
            ),
        )


def _validate_target_system_request(target_system: Optional[str]) -> None:
    """Reject unknown target_system values at the API edge.

    We could let the backend's _validate_target_system raise — it does,
    and the handler turns ValueError into 400 — but doing it here too
    keeps the error message consistent with the profile validator (which
    is also enforced at the API edge before the backend call). One
    rejection path is easier for the UI to message about than two.
    """
    if target_system is None:
        return
    if target_system not in TARGET_SYSTEMS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown target_system {target_system!r}; "
                f"allowed={sorted(TARGET_SYSTEMS)}"
            ),
        )


@app.post("/sessions", response_model=SessionResponse, status_code=201)
def create_session(req: SessionCreateRequest) -> SessionResponse:
    if req.profile not in PROFILES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown profile {req.profile!r}; allowed={sorted(PROFILES)}",
        )
    _validate_target_system_request(req.target_system)
    _validate_agent_id_request(req.agent_id)
    try:
        rec = _session_backend.create(
            scenario=req.scenario,
            profile=req.profile,
            session_id=req.session_id,
            target_system=req.target_system,
            agent_id=req.agent_id,
        )
    except ValueError as exc:
        # Duplicate session_id and unknown-profile both surface here.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Backend-side failures (kube API errors, missing template).
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _record_to_response(rec)


@app.post("/sessions/batch", response_model=SessionListResponse, status_code=201)
def create_session_batch(
    req: SessionBatchRequest, response: Response
) -> SessionListResponse:
    """Create N sessions in one shot. Used by the load-simulator and the
    "Spawn N concurrent sessions" panel in the web UI. Each session gets
    its own auto-generated id.

    Status codes:
      201 — every requested session was created
      207 — partial success: some sessions created, then the loop bailed.
            Body still carries the successfully-created sessions plus an
            `_error: 1` marker in `by_status` so the caller can clean up.
            207 (rather than 201) so HTTP-status-only callers (curl,
            shell scripts, automation) don't treat partial as success.
      502 — total failure: zero sessions were created. Returned as a
            JSON body so the caller learns *why* (vs a bare HTTPException
            stripping context).
    """
    if req.count > SESSION_BATCH_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"count {req.count} exceeds SESSION_BATCH_MAX={SESSION_BATCH_MAX}",
        )
    if req.profile not in PROFILES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown profile {req.profile!r}; allowed={sorted(PROFILES)}",
        )
    _validate_target_system_request(req.target_system)
    _validate_agent_id_request(req.agent_id)
    created = []
    error: Optional[str] = None
    for _ in range(req.count):
        try:
            rec = _session_backend.create(
                scenario=req.scenario,
                profile=req.profile,
                target_system=req.target_system,
                agent_id=req.agent_id,
            )
        except (ValueError, RuntimeError) as exc:
            error = str(exc)
            break
        created.append(rec)
    by_status = _summarize_status(created)
    if error is not None:
        # Mark partial failure in both the body (for the JS client which
        # already inspects `_error`) and the HTTP status (for clients
        # that only check status). Total failure becomes a hard 502 so
        # `curl -f` and similar tooling exit non-zero.
        by_status = {**by_status, "_error": 1}
        response.status_code = 502 if not created else 207
    return SessionListResponse(
        backend=_session_backend.name,
        total=len(created),
        by_status=by_status,
        sessions=[_record_to_response(r) for r in created],
        error=error,
    )


def _summarize_status(records) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in records:
        counts[r.status] = counts.get(r.status, 0) + 1
    return counts


@app.get("/sessions", response_model=SessionListResponse)
def list_sessions() -> SessionListResponse:
    try:
        records = _session_backend.list()
    except RuntimeError as exc:
        # KubeSessionBackend translates kube ApiException to RuntimeError;
        # surfacing as 502 keeps the read-side error contract aligned with
        # POST /sessions.
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return SessionListResponse(
        backend=_session_backend.name,
        total=len(records),
        by_status=_summarize_status(records),
        sessions=[_record_to_response(r) for r in records],
    )


@app.get("/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: str) -> SessionResponse:
    try:
        rec = _session_backend.get(session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if rec is None:
        raise HTTPException(status_code=404, detail=f"unknown session {session_id!r}")
    return _record_to_response(rec)


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str) -> dict[str, str]:
    try:
        deleted = _session_backend.delete(session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail=f"unknown session {session_id!r}")
    return {"session_id": session_id, "status": "deleting"}


# ---------------------------------------------------------------------------
# Agents API — long-lived agent registry (read-only in v1)
# ---------------------------------------------------------------------------
#
# The registry is seeded from config/agents.yaml at startup. In Tier 2 the
# kube backend overlays live cluster status (OpenClawInstance phase,
# Flowise Deployment readiness) on each entry. There are no write routes
# yet — adding/removing agents goes through the operator path
# (scripts/install-openclaw-operator.sh + the documented Flowise UI step
# in docs/flowise-integration.md). See agent_registry.py for details.
#
# Routes:
#   GET  /agents             list all registered agents
#   GET  /agents/{agent_id}  poll one agent
#   GET  /agents/kinds       enum of allowed `kind` values
#   GET  /agents/systems     enum of allowed `system` values


class AgentResponse(BaseModel):
    id: str
    name: str
    kind: str
    system: str
    capabilities: list[str]
    status: str
    source: str
    message: Optional[str] = None
    discovery: dict[str, Any] = Field(default_factory=dict)


class AgentListResponse(BaseModel):
    total: int
    by_system: dict[str, int]
    by_status: dict[str, int]
    agents: list[AgentResponse]


def _summarize_agents(records) -> tuple[dict[str, int], dict[str, int]]:
    by_system: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for rec in records:
        by_system[rec.system] = by_system.get(rec.system, 0) + 1
        by_status[rec.status] = by_status.get(rec.status, 0) + 1
    return by_system, by_status


@app.get("/agents/kinds")
def list_agent_kinds() -> dict[str, Any]:
    """Allowed `kind` values for registered agents. Surfaced so the UI
    can render the kind picker without hard-coding the list."""
    return {"kinds": sorted(AGENT_KINDS)}


@app.get("/agents/systems")
def list_agent_systems() -> dict[str, Any]:
    """Allowed `system` values for registered agents."""
    return {"systems": sorted(AGENT_SYSTEMS)}


@app.get("/agents", response_model=AgentListResponse)
def list_agents() -> AgentListResponse:
    records = _agent_registry.list()
    by_system, by_status = _summarize_agents(records)
    return AgentListResponse(
        total=len(records),
        by_system=by_system,
        by_status=by_status,
        agents=[AgentResponse(**rec.to_public()) for rec in records],
    )


@app.get("/agents/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: str) -> AgentResponse:
    rec = _agent_registry.get(agent_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"unknown agent {agent_id!r}")
    return AgentResponse(**rec.to_public())


# ---------------------------------------------------------------------------
# Artifacts (existing offload code resumes here)
# ---------------------------------------------------------------------------


@app.get("/artifacts/{ref:path}", response_model=ArtifactRef)
def get_artifact(ref: str) -> ArtifactRef:
    if not ref or ref.startswith("/") or ".." in ref:
        raise HTTPException(status_code=400, detail="invalid artifact ref")
    # Only presign refs that this relay actually issued (via POST /offload).
    # Otherwise any caller who can guess an object key turns this into a
    # bucket-wide read proxy. The set of issued refs lives in `_jobs`.
    issued = {
        entry["result_ref"] for entry in _jobs.values() if entry.get("result_ref")
    }
    if ref not in issued:
        raise HTTPException(status_code=404, detail=f"unknown artifact ref {ref}")
    client = _s3_client()
    try:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": MINIO_BUCKET, "Key": ref},
            ExpiresIn=PRESIGN_EXPIRES_SECONDS,
        )
    except Exception as exc:  # boto3 raises ClientError / EndpointConnectionError
        raise HTTPException(
            status_code=502, detail=f"failed to presign artifact: {exc}"
        ) from exc
    return ArtifactRef(ref=ref, url=url, expires_in=PRESIGN_EXPIRES_SECONDS)
