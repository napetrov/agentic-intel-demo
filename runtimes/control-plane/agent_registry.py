"""
Long-lived agent registry for the control plane.

Read-only in v1: agents are declared in config/agents.yaml and surfaced
through GET /agents. The local backend returns the seed as-is; the kube
backend overlays live cluster status (OpenClawInstance phase, Flowise
Deployment readiness) on top of each seed entry.

Lifecycle is operator-driven, not control-plane-driven:
  * OpenClaw instances are created/deleted through openclaw-operator
    (scripts/install-openclaw-operator.sh + smoke tests). The registry
    only reads CR phase.
  * Flowise chatflows are authored through the Flowise UI per
    docs/flowise-integration.md. The registry just references the flow
    id once the operator has imported it.

Adding/removing agents at runtime is intentionally absent — the reviews
flagged programmatic OpenClawInstance writes as a violation of the
operator-first contract, and programmatic Flowise chatflow imports as a
separate sub-project. Both can return as POST/DELETE in v2.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("control-plane.agents")


AGENT_KINDS: frozenset[str] = frozenset({"openclaw", "flowise"})
AGENT_SYSTEMS: frozenset[str] = frozenset({"system_a", "system_b"})

# Status vocabulary surfaced to the UI. We keep it small on purpose:
# `Unknown` covers "kube backend can't reach the cluster" and "local
# backend has no live signal" without forcing a probe loop in v1.
STATUS_READY = "Ready"
STATUS_PROVISIONING = "Provisioning"
STATUS_DEGRADED = "Degraded"
STATUS_STOPPED = "Stopped"
STATUS_UNKNOWN = "Unknown"


@dataclass
class AgentRecord:
    id: str
    name: str
    kind: str
    system: str
    capabilities: list[str] = field(default_factory=list)
    status: str = STATUS_UNKNOWN
    # Source of the live status reading. "seed" = no overlay applied
    # (Tier 1 / cluster unreachable); "cluster" = derived from a CR or
    # Deployment lookup; "missing" = seed entry whose target resource was
    # not found in the cluster (operator hasn't deployed it yet).
    source: str = "seed"
    message: Optional[str] = None
    discovery: dict[str, Any] = field(default_factory=dict)

    def to_public(self) -> dict[str, Any]:
        return asdict(self)


def _validate_agent_dict(idx: int, raw: dict[str, Any]) -> AgentRecord:
    """Coerce one YAML entry to an AgentRecord. Caller catches ValueError."""
    for key in ("id", "name", "kind", "system"):
        if not isinstance(raw.get(key), str) or not raw.get(key):
            raise ValueError(f"agents[{idx}]: {key} must be a non-empty string")
    if raw["kind"] not in AGENT_KINDS:
        raise ValueError(
            f"agents[{idx}]: unknown kind {raw['kind']!r}; allowed={sorted(AGENT_KINDS)}"
        )
    if raw["system"] not in AGENT_SYSTEMS:
        raise ValueError(
            f"agents[{idx}]: unknown system {raw['system']!r}; "
            f"allowed={sorted(AGENT_SYSTEMS)}"
        )
    caps_raw = raw.get("capabilities") or []
    if not isinstance(caps_raw, list) or not all(
        isinstance(c, str) and c for c in caps_raw
    ):
        raise ValueError(
            f"agents[{idx}]: capabilities must be a list of non-empty strings"
        )
    discovery = raw.get("discovery") or {}
    if not isinstance(discovery, dict):
        raise ValueError(f"agents[{idx}]: discovery must be a mapping")
    return AgentRecord(
        id=raw["id"],
        name=raw["name"],
        kind=raw["kind"],
        system=raw["system"],
        capabilities=list(caps_raw),
        discovery=discovery,
    )


def load_seed(path: Optional[str]) -> list[AgentRecord]:
    """Read config/agents.yaml. Missing file → empty pool, with a log
    line so the operator knows live discovery is the only source.
    A malformed file is a hard error — bad config should fail loud, not
    silently boot with no agents.
    """
    if not path:
        return []
    p = Path(path)
    if not p.exists():
        logger.info("agent registry seed not found at %s; pool starts empty", p)
        return []
    try:
        import yaml  # local import keeps the control-plane image footprint
    except ImportError as exc:  # pragma: no cover — dependency is shipped
        raise RuntimeError("agent registry requires PyYAML") from exc
    with p.open("r", encoding="utf-8") as fh:
        doc = yaml.safe_load(fh) or {}
    if not isinstance(doc, dict):
        raise ValueError(f"{p}: root must be a mapping")
    if doc.get("apiVersion") != "demo.agents/v1":
        raise ValueError(f"{p}: apiVersion must be demo.agents/v1")
    if doc.get("kind") != "AgentRegistry":
        raise ValueError(f"{p}: kind must be AgentRegistry")
    raw_agents = doc.get("agents") or []
    if not isinstance(raw_agents, list):
        raise ValueError(f"{p}: `agents` must be a list")
    seen: set[str] = set()
    out: list[AgentRecord] = []
    for idx, raw in enumerate(raw_agents):
        if not isinstance(raw, dict):
            raise ValueError(f"{p}: agents[{idx}] must be a mapping")
        rec = _validate_agent_dict(idx, raw)
        if rec.id in seen:
            raise ValueError(f"{p}: duplicate agent id {rec.id!r}")
        seen.add(rec.id)
        out.append(rec)
    return out


class AgentRegistry:
    """Read-only registry served by GET /agents.

    The kube backend optionally overlays cluster discovery on top of the
    seed; if the overlay client isn't configured (Tier 1, dev-up) the
    seed is returned with `status=Unknown, source=seed` so the UI can
    show the pool without claiming health information it doesn't have.
    """

    def __init__(
        self,
        seed: list[AgentRecord],
        discovery: Optional["AgentDiscovery"] = None,
    ) -> None:
        self._seed = seed
        self._discovery = discovery

    def list(self) -> list[AgentRecord]:
        if not self._discovery:
            # Return copies so callers can't mutate the cached seed.
            return [
                AgentRecord(**asdict(rec))
                for rec in self._seed
            ]
        out: list[AgentRecord] = []
        for rec in self._seed:
            try:
                overlaid = self._discovery.overlay(rec)
            except Exception as exc:  # pragma: no cover — defensive
                # A cluster API outage must not turn GET /agents into a
                # 5xx; fall back to the seed entry and surface the
                # failure on the row.
                logger.warning("discovery failed for %s: %s", rec.id, exc)
                overlaid = AgentRecord(**asdict(rec))
                overlaid.status = STATUS_UNKNOWN
                overlaid.source = "seed"
                overlaid.message = f"discovery error: {exc}"
            out.append(overlaid)
        return out

    def get(self, agent_id: str) -> Optional[AgentRecord]:
        for rec in self.list():
            if rec.id == agent_id:
                return rec
        return None

    def ids(self) -> set[str]:
        return {rec.id for rec in self._seed}


class AgentDiscovery:
    """Live-cluster overlay for the kube backend.

    Reads OpenClawInstance phase and Flowise Deployment readiness; never
    writes. The seed entry is the source of identity (id/name/kind/
    system/capabilities) — discovery only fills in `status`/`message`/
    `source` so a CR rename can't silently retitle a registered agent.
    """

    OPENCLAW_GROUP = "openclaw.intel.com"
    OPENCLAW_VERSION = "v1alpha1"
    OPENCLAW_PLURAL = "openclawinstances"

    def __init__(self, kubeconfig_path: Optional[str] = None) -> None:
        try:
            from kubernetes import client, config  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError(
                "AgentDiscovery requires the 'kubernetes' package; "
                "install it in the control-plane image"
            ) from exc

        self._client = client
        if kubeconfig_path:
            config.load_kube_config(config_file=kubeconfig_path)
        else:
            try:
                config.load_incluster_config()
            except config.ConfigException:
                config.load_kube_config()
        self._apps = client.AppsV1Api()
        self._custom = client.CustomObjectsApi()

    def overlay(self, rec: AgentRecord) -> AgentRecord:
        out = AgentRecord(**asdict(rec))
        if rec.kind == "openclaw":
            self._overlay_openclaw(out)
        elif rec.kind == "flowise":
            self._overlay_flowise(out)
        else:  # pragma: no cover — schema rejects this earlier
            out.status = STATUS_UNKNOWN
        return out

    def _overlay_openclaw(self, rec: AgentRecord) -> None:
        name = rec.discovery.get("openclaw_instance")
        ns = rec.discovery.get("namespace") or "openclaw"
        if not name:
            rec.status = STATUS_UNKNOWN
            rec.source = "seed"
            rec.message = "no openclaw_instance set in discovery"
            return
        try:
            obj = self._custom.get_namespaced_custom_object(
                group=self.OPENCLAW_GROUP,
                version=self.OPENCLAW_VERSION,
                namespace=ns,
                plural=self.OPENCLAW_PLURAL,
                name=name,
            )
        except self._client.exceptions.ApiException as exc:
            if getattr(exc, "status", None) == 404:
                rec.status = STATUS_STOPPED
                rec.source = "missing"
                rec.message = f"OpenClawInstance {ns}/{name} not found"
                return
            rec.status = STATUS_UNKNOWN
            rec.source = "seed"
            rec.message = f"kube error: {exc.status} {exc.reason}"
            return
        phase = ((obj or {}).get("status") or {}).get("phase")
        rec.source = "cluster"
        if phase in ("Ready", "Available", "Running"):
            rec.status = STATUS_READY
        elif phase in ("Pending", "Provisioning", "Reconciling"):
            rec.status = STATUS_PROVISIONING
        elif phase in ("Failed", "Error"):
            rec.status = STATUS_DEGRADED
        else:
            rec.status = STATUS_UNKNOWN
        rec.message = phase or None

    def _overlay_flowise(self, rec: AgentRecord) -> None:
        name = rec.discovery.get("deployment")
        ns = rec.discovery.get("namespace") or "flowise"
        if not name:
            rec.status = STATUS_UNKNOWN
            rec.source = "seed"
            rec.message = "no deployment set in discovery"
            return
        try:
            dep = self._apps.read_namespaced_deployment(name=name, namespace=ns)
        except self._client.exceptions.ApiException as exc:
            if getattr(exc, "status", None) == 404:
                rec.status = STATUS_STOPPED
                rec.source = "missing"
                rec.message = f"Deployment {ns}/{name} not found"
                return
            rec.status = STATUS_UNKNOWN
            rec.source = "seed"
            rec.message = f"kube error: {exc.status} {exc.reason}"
            return
        rec.source = "cluster"
        status = getattr(dep, "status", None)
        ready_replicas = getattr(status, "ready_replicas", None) or 0
        replicas = getattr(status, "replicas", None) or 0
        if replicas > 0 and ready_replicas >= replicas:
            # Deployment is up. If the seed never got a chatflow id we
            # surface that as Provisioning so the operator knows to
            # finish the manual import step from docs/flowise-integration.md.
            if not rec.discovery.get("chatflow_id"):
                rec.status = STATUS_PROVISIONING
                rec.message = "deployment ready; chatflow_id not yet set"
            else:
                rec.status = STATUS_READY
                rec.message = f"{ready_replicas}/{replicas} replicas ready"
        elif replicas == 0:
            rec.status = STATUS_STOPPED
            rec.message = "deployment scaled to 0"
        else:
            rec.status = STATUS_PROVISIONING
            rec.message = f"{ready_replicas}/{replicas} replicas ready"


def make_registry() -> AgentRegistry:
    """Factory wired by env vars. Defaults to seed-only so the existing
    docker-compose / dev-up paths keep working.

    AGENT_REGISTRY_PATH=config/agents.yaml — seed file. Defaulted to the
        in-tree path; missing file is OK (returns empty pool).
    AGENT_DISCOVERY=kube — turn on the live-cluster overlay. Anything
        else (or unset) keeps the registry seed-only.
    """
    # Resolve the fallback path lazily — `os.environ.get(name, default)`
    # evaluates `default` eagerly, so a fallback that walks `__file__` can
    # IndexError before the env-var-set branch ever runs. In the shipped
    # container layout (/app/agent_registry.py) `Path(__file__).parents`
    # only has 2 entries, so `parents[2]` crashes control-plane startup
    # even when AGENT_REGISTRY_PATH is set explicitly. Compute the
    # fallback only on the path that actually needs it, and tolerate a
    # short parents chain by leaving the seed path unset (load_seed
    # treats that as "no seed", same as a missing file).
    seed_path = os.environ.get("AGENT_REGISTRY_PATH")
    if not seed_path:
        try:
            seed_path = str(
                Path(__file__).resolve().parents[2] / "config" / "agents.yaml"
            )
        except IndexError:
            seed_path = None
    seed = load_seed(seed_path)
    discovery: Optional[AgentDiscovery] = None
    kind = os.environ.get("AGENT_DISCOVERY", "").strip().lower()
    if kind == "kube":
        try:
            discovery = AgentDiscovery(
                kubeconfig_path=os.environ.get("AGENT_DISCOVERY_KUBECONFIG") or None,
            )
        except RuntimeError as exc:
            # Don't crash the control plane on cold start just because
            # the kube client is missing — the seed-only fallback still
            # serves a useful read-only view.
            logger.warning(
                "AGENT_DISCOVERY=kube but discovery init failed: %s; "
                "falling back to seed-only", exc,
            )
    return AgentRegistry(seed=seed, discovery=discovery)
