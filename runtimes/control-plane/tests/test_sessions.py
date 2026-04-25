"""Tests for session_manager + the /sessions HTTP surface.

The kube backend isn't exercised against a live cluster — we test only
its pure status-translation function here. End-to-end k8s coverage would
need a kind/minikube fixture, which is out of scope for unit tests.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

# Same env-var defaults as test_app.py so the module imports cleanly even
# if the Bedrock/MinIO env isn't set in the developer's shell.
os.environ.setdefault("OFFLOAD_WORKER_URL", "http://offload-worker.test")
os.environ.setdefault("MINIO_ENDPOINT", "http://minio.test:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "minioadmin")
os.environ.setdefault("MINIO_SECRET_KEY", "minioadmin")
os.environ.setdefault("MINIO_BUCKET", "demo-artifacts")
os.environ.setdefault("SESSION_BACKEND", "local")

import pytest
from fastapi.testclient import TestClient

# Make sibling imports (`from session_manager import ...`) work when this
# test file is loaded directly via pytest from the repo root.
_HERE = Path(__file__).resolve().parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

# Load app.py under a unique module name (mirrors test_app.py) so the two
# test files don't collide on sys.modules["app"] under `pytest runtimes/`.
_APP_PATH = _HERE / "app.py"
_spec = importlib.util.spec_from_file_location("control_plane_app_sessions", _APP_PATH)
assert _spec is not None and _spec.loader is not None
cp_app = importlib.util.module_from_spec(_spec)
sys.modules["control_plane_app_sessions"] = cp_app
_spec.loader.exec_module(cp_app)

import session_manager as sm  # noqa: E402  (imported after sys.path tweak)


# ----------------------------- LocalSessionBackend ---------------------------


def test_local_backend_creates_session_with_profile():
    backend = sm.LocalSessionBackend()
    rec = backend.create(scenario="terminal-agent", profile="small")
    assert rec.session_id.startswith("sess-")
    assert rec.scenario == "terminal-agent"
    assert rec.profile == "small"
    assert rec.status == sm.STATUS_PENDING
    # cpu_request comes from PROFILES; small => "1"
    assert rec.cpu_request == "1"
    assert rec.backend == "local"


def test_local_backend_rejects_unknown_profile():
    backend = sm.LocalSessionBackend()
    with pytest.raises(ValueError, match="unknown profile"):
        backend.create(scenario="x", profile="huge")


def test_local_backend_advances_through_lifecycle(monkeypatch):
    backend = sm.LocalSessionBackend()
    # Anchor the wall-clock so we can deterministically advance phases.
    t0 = 1_700_000_000.0
    times = iter([t0, t0, t0, t0])
    monkeypatch.setattr(sm.time, "time", lambda: next(times, t0))
    rec = backend.create(scenario="x", profile="small")

    # Right after create: still Pending.
    monkeypatch.setattr(sm.time, "time", lambda: t0 + 0.1)
    assert backend.get(rec.session_id).status == sm.STATUS_PENDING

    # After PENDING_SECONDS: Running.
    monkeypatch.setattr(sm.time, "time", lambda: t0 + sm.LocalSessionBackend.PENDING_SECONDS + 0.1)
    assert backend.get(rec.session_id).status == sm.STATUS_RUNNING

    # After PENDING + RUNNING: Completed.
    monkeypatch.setattr(
        sm.time,
        "time",
        lambda: t0 + sm.LocalSessionBackend.PENDING_SECONDS + sm.LocalSessionBackend.RUNNING_SECONDS + 0.1,
    )
    final = backend.get(rec.session_id)
    assert final.status == sm.STATUS_COMPLETED
    assert final.completed_at is not None
    assert final.message and "completed" in final.message


def test_local_backend_delete_removes_record():
    backend = sm.LocalSessionBackend()
    rec = backend.create(scenario="x", profile="small")
    assert backend.get(rec.session_id) is not None
    assert backend.delete(rec.session_id) is True
    assert backend.get(rec.session_id) is None
    # Second delete returns False instead of raising.
    assert backend.delete(rec.session_id) is False


def test_local_backend_list_is_sorted_oldest_first(monkeypatch):
    backend = sm.LocalSessionBackend()
    base = 1_700_000_000.0
    monkeypatch.setattr(sm.time, "time", lambda: base)
    a = backend.create(scenario="x", profile="small")
    monkeypatch.setattr(sm.time, "time", lambda: base + 1)
    b = backend.create(scenario="x", profile="small")
    monkeypatch.setattr(sm.time, "time", lambda: base + 2)
    out = backend.list()
    assert [r.session_id for r in out] == [a.session_id, b.session_id]


def test_local_backend_duplicate_session_id_rejected():
    backend = sm.LocalSessionBackend()
    backend.create(scenario="x", profile="small", session_id="dup-1")
    with pytest.raises(ValueError, match="already exists"):
        backend.create(scenario="x", profile="small", session_id="dup-1")


# ----------------------------- KubeSessionBackend ----------------------------
# Only the pure status-translation function is unit-tested. The rest of the
# class talks to the kubernetes API and is covered by manual tests in a
# kind cluster.


def _job(conditions=None, active=0, start_time=None):
    return SimpleNamespace(
        status={
            "conditions": conditions or [],
            "active": active,
            "start_time": start_time,
        },
        metadata=SimpleNamespace(),
    )


def test_status_pending_when_no_pods_and_no_conditions():
    status, started, completed, msg = sm.KubeSessionBackend._status_from_job(
        _job(), pods=[]
    )
    assert (status, started, completed, msg) == (sm.STATUS_PENDING, None, None, None)


def test_status_running_when_pods_active():
    start_time = datetime(2026, 4, 25, 12, 0, 0, tzinfo=timezone.utc)
    status, started, _, _ = sm.KubeSessionBackend._status_from_job(
        _job(active=1, start_time=start_time), pods=[]
    )
    assert status == sm.STATUS_RUNNING
    assert started == start_time.timestamp()


def test_status_completed_when_complete_condition_true():
    last = datetime(2026, 4, 25, 12, 5, 0, tzinfo=timezone.utc)
    job = _job(conditions=[{"type": "Complete", "status": "True", "last_transition_time": last, "message": "All done"}])
    status, _, completed, msg = sm.KubeSessionBackend._status_from_job(job, pods=[])
    assert status == sm.STATUS_COMPLETED
    assert completed == last.timestamp()
    assert msg == "All done"


def test_status_failed_when_failed_condition_true():
    last = datetime(2026, 4, 25, 12, 5, 0, tzinfo=timezone.utc)
    job = _job(conditions=[{"type": "Failed", "status": "True", "last_transition_time": last}])
    status, _, completed, msg = sm.KubeSessionBackend._status_from_job(job, pods=[])
    assert status == sm.STATUS_FAILED
    assert completed == last.timestamp()
    assert msg == "job failed"


def test_status_completed_preserves_started_at(monkeypatch):
    """CodeRabbit nitpick: terminal Jobs still have status.start_time set
    by the controller; reporting None hides session-duration data the UI
    needs."""
    start = datetime(2026, 4, 25, 12, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 4, 25, 12, 5, 0, tzinfo=timezone.utc)
    job = _job(
        conditions=[{"type": "Complete", "status": "True", "last_transition_time": end}],
        start_time=start,
    )
    status, started, completed, _ = sm.KubeSessionBackend._status_from_job(job, pods=[])
    assert status == sm.STATUS_COMPLETED
    assert started == start.timestamp()
    assert completed == end.timestamp()


def test_status_failed_preserves_started_at():
    start = datetime(2026, 4, 25, 12, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 4, 25, 12, 5, 0, tzinfo=timezone.utc)
    job = _job(
        conditions=[{"type": "Failed", "status": "True", "last_transition_time": end}],
        start_time=start,
    )
    _, started, completed, _ = sm.KubeSessionBackend._status_from_job(job, pods=[])
    assert started == start.timestamp()
    assert completed == end.timestamp()


# ---- Template env-substitution (CodeRabbit critical review feedback) -----


def test_interpolate_resolves_allow_listed_env_vars(monkeypatch):
    monkeypatch.setenv("SESSION_IMAGE", "registry.local/agent:v1")
    monkeypatch.setenv("AWS_REGION", "us-east-2")
    raw = "image: ${SESSION_IMAGE}\nregion: ${AWS_REGION}\n"
    out = sm.KubeSessionBackend._interpolate(raw)
    assert "registry.local/agent:v1" in out
    assert "us-east-2" in out
    assert "${" not in out


def test_interpolate_leaves_unknown_placeholders_alone():
    """Anything outside the allow-list stays as a literal so a template
    can carry intentional ${...} text without being mangled."""
    raw = "x: ${NOT_IN_ALLOW_LIST}\n"
    assert sm.KubeSessionBackend._interpolate(raw) == raw


def test_interpolate_missing_env_becomes_empty(monkeypatch):
    """Mirrors envsubst / Bash semantics — missing variable expands to
    empty so the operator sees a Pod fail with empty config rather than
    a confusing parse error."""
    monkeypatch.delenv("SESSION_IMAGE", raising=False)
    raw = "image: ${SESSION_IMAGE}\n"
    assert sm.KubeSessionBackend._interpolate(raw) == "image: \n"


# ----------------------------- /sessions endpoints ---------------------------


@pytest.fixture
def client(monkeypatch):
    """Fresh LocalSessionBackend per test so cross-test pollution is impossible."""
    fresh = sm.LocalSessionBackend()
    monkeypatch.setattr(cp_app, "_session_backend", fresh)
    return TestClient(cp_app.app)


def test_get_profiles_returns_known_profiles(client):
    r = client.get("/sessions/profiles")
    assert r.status_code == 200
    body = r.json()
    assert body["default"] == "small"
    assert set(body["profiles"].keys()) == {"small", "medium", "large"}


def test_create_and_get_session(client):
    r = client.post("/sessions", json={"scenario": "terminal-agent", "profile": "small"})
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]
    assert sid.startswith("sess-")

    r2 = client.get(f"/sessions/{sid}")
    assert r2.status_code == 200
    assert r2.json()["scenario"] == "terminal-agent"


def test_create_rejects_unknown_profile(client):
    r = client.post("/sessions", json={"scenario": "x", "profile": "huge"})
    assert r.status_code == 400
    assert "unknown profile" in r.json()["detail"]


def test_create_rejects_session_id_above_k8s_label_limit(client):
    """Codex/CodeRabbit P-major: session_id + "-job" must fit in 63 chars."""
    too_long = "s" * 60  # 60 + len("-job") = 64 > 63
    r = client.post("/sessions", json={"scenario": "x", "session_id": too_long})
    assert r.status_code == 422  # pydantic max_length validator


def test_create_rejects_scenario_above_k8s_label_limit(client):
    too_long = "s" * 64
    r = client.post("/sessions", json={"scenario": too_long})
    assert r.status_code == 422


def test_create_accepts_session_id_at_k8s_label_limit(client):
    """Boundary check: exactly 59 chars must succeed."""
    at_limit = "s" * 59
    r = client.post("/sessions", json={"scenario": "x", "session_id": at_limit})
    assert r.status_code == 201, r.text


def test_batch_creates_n_sessions(client):
    r = client.post("/sessions/batch", json={"scenario": "x", "profile": "small", "count": 3})
    assert r.status_code == 201
    body = r.json()
    assert body["total"] == 3
    assert len(body["sessions"]) == 3
    assert body["backend"] == "local"


def test_batch_rejects_oversize_request(client, monkeypatch):
    # Cap at 2 so we don't have to send a 51-element request to trigger.
    monkeypatch.setattr(cp_app, "SESSION_BATCH_MAX", 2)
    r = client.post("/sessions/batch", json={"scenario": "x", "profile": "small", "count": 5})
    assert r.status_code == 400
    assert "SESSION_BATCH_MAX" in r.json()["detail"]


def test_batch_rejects_zero_count(client):
    r = client.post("/sessions/batch", json={"scenario": "x", "profile": "small", "count": 0})
    # pydantic validator (gt=0) returns 422.
    assert r.status_code == 422


def test_list_returns_summary_and_records(client):
    for _ in range(2):
        client.post("/sessions", json={"scenario": "x", "profile": "small"})
    r = client.get("/sessions")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["by_status"].get("Pending") == 2
    assert len(body["sessions"]) == 2


def test_delete_session(client):
    r = client.post("/sessions", json={"scenario": "x", "profile": "small"})
    sid = r.json()["session_id"]
    r2 = client.delete(f"/sessions/{sid}")
    assert r2.status_code == 200
    assert r2.json() == {"session_id": sid, "status": "deleting"}
    r3 = client.delete(f"/sessions/{sid}")
    assert r3.status_code == 404


def test_get_unknown_session_returns_404(client):
    r = client.get("/sessions/sess-doesnotexist")
    assert r.status_code == 404


# ---- /sessions/batch partial-failure semantics (Codex P1 review feedback) ----


class _FlakyBackend:
    """Backend that succeeds for the first `succeed_n` calls then raises.

    Used to verify that /sessions/batch returns the right HTTP status on
    partial / total failure without depending on a real kube cluster.
    """
    name = "flaky"

    def __init__(self, succeed_n: int, exc: Exception):
        self.succeed_n = succeed_n
        self.exc = exc
        self.calls = 0
        self._records: list[sm.SessionRecord] = []

    def create(self, scenario, profile, session_id=None):
        self.calls += 1
        if self.calls > self.succeed_n:
            raise self.exc
        rec = sm.SessionRecord(
            session_id=f"sess-flaky-{self.calls}",
            scenario=scenario,
            profile=profile,
            status=sm.STATUS_PENDING,
            created_at=time.time(),
            backend=self.name,
        )
        self._records.append(rec)
        return rec

    def get(self, session_id):
        return next((r for r in self._records if r.session_id == session_id), None)

    def list(self):
        return list(self._records)

    def delete(self, session_id):
        return False


def test_batch_returns_207_on_partial_failure(monkeypatch):
    # Two succeed, third raises — should be 207 with two sessions in body.
    backend = _FlakyBackend(succeed_n=2, exc=RuntimeError("kube quota exceeded"))
    monkeypatch.setattr(cp_app, "_session_backend", backend)
    tc = TestClient(cp_app.app)
    r = tc.post(
        "/sessions/batch",
        json={"scenario": "x", "profile": "small", "count": 3},
    )
    assert r.status_code == 207, r.text
    body = r.json()
    assert body["total"] == 2
    assert body["by_status"].get("_error") == 1
    assert len(body["sessions"]) == 2


def test_batch_returns_502_on_total_failure(monkeypatch):
    # First call already raises — zero sessions created → hard 502.
    backend = _FlakyBackend(succeed_n=0, exc=RuntimeError("kube unreachable"))
    monkeypatch.setattr(cp_app, "_session_backend", backend)
    tc = TestClient(cp_app.app)
    r = tc.post(
        "/sessions/batch",
        json={"scenario": "x", "profile": "small", "count": 3},
    )
    assert r.status_code == 502, r.text
    body = r.json()
    assert body["total"] == 0
    assert body["by_status"].get("_error") == 1
    assert body["sessions"] == []


# ---- KubeSessionBackend translates template-read ApiException (Codex P2) ----


class _FakeApiException(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def test_kube_create_wraps_template_read_apiexception():
    """_render_job() runs before the create_namespaced_job try/except — if
    _load_template's ConfigMap GET fails (RBAC / missing CM), the raw
    ApiException must NOT escape; it should be wrapped as RuntimeError so
    the FastAPI handler returns 502 instead of an unhandled 500.
    """
    # Bypass __init__ (which needs a real kubeconfig) and stub just the
    # surface the create() path touches.
    backend = sm.KubeSessionBackend.__new__(sm.KubeSessionBackend)
    fake_client = SimpleNamespace(exceptions=SimpleNamespace(ApiException=_FakeApiException))
    backend._client = fake_client
    backend._namespace = "agents"
    backend._session_image = None
    backend._ttl = 600

    def boom(*a, **kw):
        raise _FakeApiException(status=403, reason="Forbidden")

    backend._load_template = boom  # type: ignore[method-assign]
    backend._batch = SimpleNamespace(create_namespaced_job=lambda **_: None)

    with pytest.raises(RuntimeError, match="failed to create session Job"):
        backend.create(scenario="x", profile="small")
