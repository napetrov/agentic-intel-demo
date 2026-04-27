"""Tests for the long-lived agent registry + GET /agents wire surface.

Covers:
  * config/agents.yaml is parsed correctly into AgentRecords
  * unknown kind/system/duplicate-id is a hard error
  * missing seed file is a soft "empty pool" (operator may not have
    seeded yet; the rest of the demo must still function)
  * GET /agents returns the seed when no discovery overlay is wired
  * GET /agents/{id} 404s on unknown id
  * POST /sessions rejects unknown agent_id with 400 + allow-list
  * POST /sessions with a valid agent_id propagates through the
    LocalSessionBackend onto the SessionRecord, and the Job-rendered
    label set carries `agent-id` for the kube path

The kube discovery overlay is exercised against fake CustomObjectsApi /
AppsV1Api stubs — no live cluster is required.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace

# Match test_app.py / test_sessions.py env-var defaults so the module
# imports cleanly even if Bedrock/MinIO env isn't set in the shell.
os.environ.setdefault("OFFLOAD_WORKER_URL", "http://offload-worker.test")
os.environ.setdefault("MINIO_ENDPOINT", "http://minio.test:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "minioadmin")
os.environ.setdefault("MINIO_SECRET_KEY", "minioadmin")
os.environ.setdefault("MINIO_BUCKET", "demo-artifacts")
os.environ.setdefault("SESSION_BACKEND", "local")

import pytest
from fastapi.testclient import TestClient

# Make sibling imports work when pytest collects from the repo root.
_HERE = Path(__file__).resolve().parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import agent_registry as ar  # noqa: E402


# --------------------- load_seed (config/agents.yaml shape) ----------------


def _write_seed(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "agents.yaml"
    p.write_text(textwrap.dedent(body), encoding="utf-8")
    return p


def test_load_seed_returns_records(tmp_path):
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v1
        kind: AgentRegistry
        agents:
          - id: openclaw-a-1
            name: OpenClaw on System A
            kind: openclaw
            system: system_a
            capabilities: [shell, summarize]
          - id: flowise-a-1
            name: Flowise on System A
            kind: flowise
            system: system_a
            capabilities: [terminal-agent]
            discovery:
              deployment: flowise
              namespace: flowise
              chatflow_id: null
        """,
    )
    seed = ar.load_seed(str(p))
    assert [a.id for a in seed] == ["openclaw-a-1", "flowise-a-1"]
    assert seed[0].kind == "openclaw"
    assert seed[1].discovery == {
        "deployment": "flowise",
        "namespace": "flowise",
        "chatflow_id": None,
    }


def test_load_seed_missing_file_returns_empty_pool(tmp_path):
    # Operator hasn't seeded yet — the registry must boot empty rather
    # than crash the control plane on cold start.
    seed = ar.load_seed(str(tmp_path / "nope.yaml"))
    assert seed == []


def test_load_seed_rejects_duplicate_id(tmp_path):
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v1
        kind: AgentRegistry
        agents:
          - {id: x, name: A, kind: openclaw, system: system_a, capabilities: []}
          - {id: x, name: B, kind: flowise,  system: system_b, capabilities: []}
        """,
    )
    with pytest.raises(ValueError, match="duplicate agent id"):
        ar.load_seed(str(p))


def test_load_seed_rejects_unknown_kind(tmp_path):
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v1
        kind: AgentRegistry
        agents:
          - {id: a, name: A, kind: nope, system: system_a, capabilities: []}
        """,
    )
    with pytest.raises(ValueError, match="unknown kind"):
        ar.load_seed(str(p))


def test_load_seed_rejects_unknown_system(tmp_path):
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v1
        kind: AgentRegistry
        agents:
          - {id: a, name: A, kind: openclaw, system: mars, capabilities: []}
        """,
    )
    with pytest.raises(ValueError, match="unknown system"):
        ar.load_seed(str(p))


def test_load_seed_rejects_wrong_apiversion(tmp_path):
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v0
        kind: AgentRegistry
        agents: []
        """,
    )
    with pytest.raises(ValueError, match="apiVersion"):
        ar.load_seed(str(p))


# --------------------- AgentRegistry behavior ------------------------------


def test_registry_seed_only_returns_unknown_status(tmp_path):
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v1
        kind: AgentRegistry
        agents:
          - {id: a, name: A, kind: openclaw, system: system_a, capabilities: []}
        """,
    )
    reg = ar.AgentRegistry(seed=ar.load_seed(str(p)))
    [rec] = reg.list()
    # Without an overlay the registry must surface "Unknown" + source=seed
    # so the UI doesn't claim health it can't verify.
    assert rec.status == ar.STATUS_UNKNOWN
    assert rec.source == "seed"


def test_registry_list_returns_copies(tmp_path):
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v1
        kind: AgentRegistry
        agents:
          - {id: a, name: A, kind: openclaw, system: system_a, capabilities: []}
        """,
    )
    reg = ar.AgentRegistry(seed=ar.load_seed(str(p)))
    a = reg.list()[0]
    a.status = "tampered"
    # Mutating the returned copy must not leak into the cached seed.
    assert reg.list()[0].status == ar.STATUS_UNKNOWN


# --------------------- AgentDiscovery overlay (no live cluster) ------------


def _record(kind: str, **kw) -> ar.AgentRecord:
    base = dict(
        id="x", name="X", kind=kind, system="system_a",
        capabilities=[], status=ar.STATUS_UNKNOWN, source="seed",
    )
    base.update(kw)
    return ar.AgentRecord(**base)


def _make_discovery_with_fakes(monkeypatch, custom_api=None, apps_api=None):
    """Build an AgentDiscovery without going through __init__ (which
    pulls in the kubernetes client). Tests patch in fake API stubs."""
    d = object.__new__(ar.AgentDiscovery)
    d._client = SimpleNamespace(
        exceptions=SimpleNamespace(ApiException=Exception),
    )
    d._custom = custom_api
    d._apps = apps_api
    return d


def test_overlay_openclaw_ready(monkeypatch):
    class FakeCustom:
        def get_namespaced_custom_object(self, **kw):
            return {"status": {"phase": "Ready"}}

    d = _make_discovery_with_fakes(monkeypatch, custom_api=FakeCustom())
    rec = _record(
        "openclaw",
        discovery={"openclaw_instance": "demo", "namespace": "openclaw"},
    )
    out = d.overlay(rec)
    assert out.status == ar.STATUS_READY
    assert out.source == "cluster"


def test_overlay_openclaw_missing_cr(monkeypatch):
    class ApiException(Exception):
        def __init__(self, status, reason="Not Found"):
            self.status = status
            self.reason = reason

    class FakeCustom:
        def get_namespaced_custom_object(self, **kw):
            raise ApiException(404)

    d = _make_discovery_with_fakes(monkeypatch, custom_api=FakeCustom())
    d._client = SimpleNamespace(
        exceptions=SimpleNamespace(ApiException=ApiException),
    )
    rec = _record(
        "openclaw",
        discovery={"openclaw_instance": "demo", "namespace": "openclaw"},
    )
    out = d.overlay(rec)
    # Missing CR = operator hasn't deployed it yet. Surface Stopped +
    # source=missing so the UI can hint at the operator step.
    assert out.status == ar.STATUS_STOPPED
    assert out.source == "missing"


def test_overlay_flowise_ready_without_chatflow(monkeypatch):
    class FakeApps:
        def read_namespaced_deployment(self, **kw):
            return SimpleNamespace(
                status=SimpleNamespace(ready_replicas=1, replicas=1),
            )

    d = _make_discovery_with_fakes(monkeypatch, apps_api=FakeApps())
    rec = _record(
        "flowise",
        discovery={"deployment": "flowise", "namespace": "flowise"},
    )
    out = d.overlay(rec)
    # Deployment up + chatflow_id absent → Provisioning, with a hint at
    # the manual import step from docs/flowise-integration.md.
    assert out.status == ar.STATUS_PROVISIONING
    assert "chatflow_id" in (out.message or "")


def test_overlay_flowise_ready_with_chatflow(monkeypatch):
    class FakeApps:
        def read_namespaced_deployment(self, **kw):
            return SimpleNamespace(
                status=SimpleNamespace(ready_replicas=2, replicas=2),
            )

    d = _make_discovery_with_fakes(monkeypatch, apps_api=FakeApps())
    rec = _record(
        "flowise",
        discovery={
            "deployment": "flowise",
            "namespace": "flowise",
            "chatflow_id": "abc",
        },
    )
    out = d.overlay(rec)
    assert out.status == ar.STATUS_READY


# --------------------- /agents wire contract -------------------------------


@pytest.fixture
def cp_app(tmp_path, monkeypatch):
    """Reload app.py with AGENT_REGISTRY_PATH pointed at a tmp seed.

    Done per-test so the registry contents are deterministic — the
    module-level _agent_registry initialises at import time.
    """
    p = _write_seed(
        tmp_path,
        """
        apiVersion: demo.agents/v1
        kind: AgentRegistry
        agents:
          - id: openclaw-a-1
            name: OpenClaw A
            kind: openclaw
            system: system_a
            capabilities: [shell]
          - id: flowise-b-1
            name: Flowise B
            kind: flowise
            system: system_b
            capabilities: [market-research]
        """,
    )
    monkeypatch.setenv("AGENT_REGISTRY_PATH", str(p))
    monkeypatch.delenv("AGENT_DISCOVERY", raising=False)
    # Each test gets a fresh app module so the module-level registry +
    # session backend pick up the env above.
    spec = importlib.util.spec_from_file_location(
        f"control_plane_app_agents_{tmp_path.name}", _HERE / "app.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_get_agents_returns_seed(cp_app):
    tc = TestClient(cp_app.app)
    r = tc.get("/agents")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["by_system"] == {"system_a": 1, "system_b": 1}
    ids = {a["id"] for a in body["agents"]}
    assert ids == {"openclaw-a-1", "flowise-b-1"}


def test_get_agent_404_on_unknown(cp_app):
    tc = TestClient(cp_app.app)
    r = tc.get("/agents/nope")
    assert r.status_code == 404


def test_post_session_rejects_unknown_agent_id(cp_app):
    tc = TestClient(cp_app.app)
    r = tc.post(
        "/sessions",
        json={
            "scenario": "terminal-agent",
            "profile": "small",
            "agent_id": "ghost",
        },
    )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "ghost" in detail
    # Allow-list must surface so the operator sees what's valid.
    assert "openclaw-a-1" in detail


def test_post_session_propagates_agent_id(cp_app):
    tc = TestClient(cp_app.app)
    r = tc.post(
        "/sessions",
        json={
            "scenario": "terminal-agent",
            "profile": "small",
            "agent_id": "flowise-b-1",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["agent_id"] == "flowise-b-1"
    sid = body["session_id"]
    # Round-trip: the GET reflects the same attribution.
    r2 = tc.get(f"/sessions/{sid}")
    assert r2.json()["agent_id"] == "flowise-b-1"


# --------------------- Kube backend label propagation ----------------------


def test_render_job_carries_agent_label():
    """KubeSessionBackend._render_job propagates agent_id onto Job + Pod
    labels so `kubectl get jobs -l agent-id=...` finds every Job a given
    agent has hosted, and a control-plane restart can re-derive the
    attribution from labels alone."""
    import session_manager as sm

    # Build a backend without going through __init__ (the kubernetes
    # client isn't available in this test env). Same trick test_sessions
    # uses.
    be = object.__new__(sm.KubeSessionBackend)
    be._namespace = "agents"
    be._template_namespace = "agents"
    be._template_configmap = "session-job-template"
    be._session_image = None
    be._ttl = 600

    # Minimal in-memory template that _render_job can mutate.
    template = {
        "metadata": {},
        "spec": {
            "template": {
                "metadata": {},
                "spec": {
                    "containers": [
                        {"name": "agent", "image": "demo:latest", "env": []},
                    ],
                },
            },
        },
    }
    be._load_template = lambda: template

    spec, job_name = be._render_job(
        session_id="sess-abc",
        scenario="terminal-agent",
        profile="small",
        target_system="system_b",
        agent_id="openclaw-b-1",
    )
    assert spec["metadata"]["labels"]["agent-id"] == "openclaw-b-1"
    pod_labels = spec["spec"]["template"]["metadata"]["labels"]
    assert pod_labels["agent-id"] == "openclaw-b-1"
    envs = {e["name"]: e["value"] for e in spec["spec"]["template"]["spec"]["containers"][0]["env"]}
    assert envs.get("AGENT_ID") == "openclaw-b-1"


def test_render_job_clears_stale_agent_label_when_omitted():
    """Symmetric to the target-system contract: omitting agent_id must
    drop any inherited label so a control-plane restart can't read back
    a stale attribution from a template that already carried one."""
    import session_manager as sm

    be = object.__new__(sm.KubeSessionBackend)
    be._namespace = "agents"
    be._template_namespace = "agents"
    be._template_configmap = "session-job-template"
    be._session_image = None
    be._ttl = 600

    template = {
        "metadata": {"labels": {"agent-id": "stale-from-template"}},
        "spec": {
            "template": {
                "metadata": {"labels": {"agent-id": "stale-from-template"}},
                "spec": {
                    "containers": [
                        {"name": "agent", "image": "demo:latest", "env": []},
                    ],
                },
            },
        },
    }
    be._load_template = lambda: template

    spec, _ = be._render_job(
        session_id="sess-xyz",
        scenario="terminal-agent",
        profile="small",
        target_system=None,
        agent_id=None,
    )
    assert "agent-id" not in spec["metadata"]["labels"]
    assert "agent-id" not in spec["spec"]["template"]["metadata"]["labels"]
