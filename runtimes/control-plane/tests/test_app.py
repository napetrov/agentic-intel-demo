"""Unit tests for the control-plane offload relay.

No real network/MinIO — the offload-worker is replaced with a stubbed
httpx transport, and boto3 is only exercised via the artifact path with
a fake endpoint (we only assert the presigned URL shape, not that it
resolves).
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

os.environ.setdefault("OFFLOAD_WORKER_URL", "http://offload-worker.test")
os.environ.setdefault("MINIO_ENDPOINT", "http://minio.test:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "minioadmin")
os.environ.setdefault("MINIO_SECRET_KEY", "minioadmin")
os.environ.setdefault("MINIO_BUCKET", "demo-artifacts")

import httpx
import pytest
from fastapi.testclient import TestClient

# Load this module under a unique name so `sys.modules["app"]` can't be
# polluted by runtimes/offload-worker/app.py if the two test suites ever
# share a process (e.g. via `pytest runtimes/` from the repo root).
# The module must be registered in sys.modules BEFORE exec_module so
# pydantic/FastAPI can resolve forward refs on the request/response
# models during `TypeAdapter` build.
_APP_PATH = Path(__file__).resolve().parent.parent / "app.py"
_spec = importlib.util.spec_from_file_location("control_plane_app", _APP_PATH)
assert _spec is not None and _spec.loader is not None
cp_app = importlib.util.module_from_spec(_spec)
sys.modules["control_plane_app"] = cp_app
_spec.loader.exec_module(cp_app)


@pytest.fixture
def client(monkeypatch):
    # Replace httpx.post with one driven by a MockTransport so no real
    # network is touched. We rebuild a client per-call to mirror app.py.
    def _factory(handler):
        transport = httpx.MockTransport(handler)

        def fake_post(url, *, json=None, timeout=None):
            with httpx.Client(transport=transport) as c:
                return c.post(url, json=json, timeout=timeout)

        monkeypatch.setattr(cp_app.httpx, "post", fake_post)
        return TestClient(cp_app.app)

    return _factory


def test_health():
    tc = TestClient(cp_app.app)
    r = tc.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_ready_returns_200_when_upstream_healthy(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        return httpx.Response(200, json={"status": "ok"})

    transport = httpx.MockTransport(handler)

    def fake_get(url, *, timeout=None):
        with httpx.Client(transport=transport) as c:
            return c.get(url, timeout=timeout)

    monkeypatch.setattr(cp_app.httpx, "get", fake_get)
    tc = TestClient(cp_app.app)
    r = tc.get("/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready"}


def test_ready_returns_503_when_upstream_unreachable(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=request)

    transport = httpx.MockTransport(handler)

    def fake_get(url, *, timeout=None):
        with httpx.Client(transport=transport) as c:
            return c.get(url, timeout=timeout)

    monkeypatch.setattr(cp_app.httpx, "get", fake_get)
    tc = TestClient(cp_app.app)
    r = tc.get("/ready")
    assert r.status_code == 503


def test_offload_echo_roundtrip(client):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/run"
        return httpx.Response(
            200,
            json={
                "task_id": "task-abc123",
                "status": "ok",
                "result": {"echo": {"hello": "world"}},
                "result_key": None,
            },
        )

    tc = client(handler)
    r = tc.post(
        "/offload",
        json={
            "task_type": "echo",
            "payload": {"hello": "world"},
            "session_id": "sess-1",
        },
    )
    assert r.status_code == 200
    submitted = r.json()
    assert submitted["status"] == "completed"
    assert submitted["session_id"] == "sess-1"
    job_id = submitted["job_id"]

    r2 = tc.get(f"/offload/{job_id}")
    assert r2.status_code == 200
    status = r2.json()
    assert status["status"] == "completed"
    assert status["task_id"] == "task-abc123"
    assert status["result"] == {"echo": {"hello": "world"}}
    assert status["result_ref"] is None
    assert status["error"] is None


def test_offload_returns_result_key_for_large_result(client):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "task_id": "task-def456",
                "status": "ok",
                "result": None,
                "result_key": "offload/sess-2/task-def456.json",
            },
        )

    tc = client(handler)
    r = tc.post(
        "/offload",
        json={"task_type": "pandas_describe", "payload": {"data": []}, "session_id": "sess-2"},
    )
    job_id = r.json()["job_id"]
    status = tc.get(f"/offload/{job_id}").json()
    assert status["status"] == "completed"
    assert status["result_ref"] == "offload/sess-2/task-def456.json"
    assert status["result"] is None


def test_offload_worker_error_bubbles_up_as_job_error(client):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "task_id": "task-xyz",
                "status": "error",
                "error": "Traceback: ValueError: boom",
            },
        )

    tc = client(handler)
    r = tc.post("/offload", json={"task_type": "echo", "payload": {}})
    assert r.status_code == 200
    assert r.json()["status"] == "error"
    status = tc.get(f"/offload/{r.json()['job_id']}").json()
    assert status["status"] == "error"
    assert "boom" in status["error"]


def test_offload_worker_unreachable_returns_502(client):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=request)

    tc = client(handler)
    r = tc.post("/offload", json={"task_type": "echo", "payload": {}})
    assert r.status_code == 502
    # Job was created before the call failed; status should reflect error.
    # We can't get the job_id from the 502 body, but we can verify the
    # registry accepts a GET (even without id) returns 404 shape.
    r404 = tc.get("/offload/does-not-exist")
    assert r404.status_code == 404


def test_offload_worker_returns_non_json_body_marks_job_error(client, monkeypatch):
    # Upstream returns 200 with an HTML error page (e.g. a misbehaving
    # proxy). We should return 502 AND mark the job as error, not leave
    # it stuck in `running` in the in-memory registry.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>gateway error</html>",
                              headers={"content-type": "text/html"})

    tc = client(handler)
    # Snapshot registry before.
    before_ids = set(cp_app._jobs.keys())
    r = tc.post("/offload", json={"task_type": "echo", "payload": {}})
    assert r.status_code == 502
    after_ids = set(cp_app._jobs.keys())
    new_ids = after_ids - before_ids
    assert new_ids, "expected a new job registry entry even on failure"
    entry = cp_app._jobs[next(iter(new_ids))]
    assert entry["status"] == "error"
    assert entry["completed_at"] is not None
    assert "offload-worker call failed" in (entry["error"] or "")


def test_unknown_job_id_returns_404():
    tc = TestClient(cp_app.app)
    r = tc.get("/offload/job-does-not-exist")
    assert r.status_code == 404


def test_artifact_presign_returns_url():
    # Seed a job whose result_ref matches the artifact we will request,
    # mirroring the real flow (POST /offload returns result_ref, client
    # calls GET /artifacts/{ref}). Without the seed the endpoint 404s —
    # unknown refs aren't minted into presigned URLs.
    ref = "offload/sess-1/task-abc.json"
    with cp_app._jobs_lock:
        cp_app._jobs["job-seeded"] = {
            "job_id": "job-seeded",
            "status": "completed",
            "session_id": "sess-1",
            "task_id": "task-abc",
            "result": None,
            "result_ref": ref,
            "error": None,
            "submitted_at": 0.0,
            "completed_at": 0.0,
        }
    try:
        tc = TestClient(cp_app.app)
        r = tc.get(f"/artifacts/{ref}")
        assert r.status_code == 200
        body = r.json()
        assert body["ref"] == ref
        assert body["url"].startswith("http://minio.test:9000/demo-artifacts/")
        assert body["expires_in"] > 0
    finally:
        with cp_app._jobs_lock:
            cp_app._jobs.pop("job-seeded", None)


def test_artifact_presign_rejects_unknown_ref():
    tc = TestClient(cp_app.app)
    r = tc.get("/artifacts/offload/sess-unknown/task-never-issued.json")
    assert r.status_code == 404


def test_artifact_ref_rejects_path_traversal():
    # HTTP clients normalize `/artifacts/../x` to `/x` before the request
    # is issued, so the traversal can only arrive via a handler call that
    # bypasses URL normalization. Exercise the check directly.
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        cp_app.get_artifact("foo/../bar")
    assert exc.value.status_code == 400


def test_artifact_ref_rejects_leading_slash():
    tc = TestClient(cp_app.app)
    # FastAPI collapses repeated leading slashes; test via absolute ref.
    r = tc.get("/artifacts//absolute/key")
    assert r.status_code == 400


def test_probe_unknown_name_404s():
    tc = TestClient(cp_app.app)
    r = tc.get("/probe/does-not-exist")
    assert r.status_code == 404


def test_probe_unconfigured_target_returns_unconfigured(monkeypatch):
    monkeypatch.setitem(cp_app.PROBE_TARGETS, "litellm", "")
    tc = TestClient(cp_app.app)
    r = tc.get("/probe/litellm")
    assert r.status_code == 200
    assert r.json() == {"state": "unconfigured"}


def test_probe_configured_ok(monkeypatch):
    # Point the openclaw probe at a stub target and stub httpx.get to
    # answer 200; the probe must return state=ok with the resolved URL.
    monkeypatch.setitem(cp_app.PROBE_TARGETS, "openclaw", "http://stub.local")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        return httpx.Response(200, json={"status": "ok"})

    transport = httpx.MockTransport(handler)

    def fake_get(url, *, timeout=None):
        with httpx.Client(transport=transport) as c:
            return c.get(url, timeout=timeout)

    monkeypatch.setattr(cp_app.httpx, "get", fake_get)
    tc = TestClient(cp_app.app)
    r = tc.get("/probe/openclaw")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "ok"
    assert body["target"].endswith("/health")


def test_probe_configured_down_when_unreachable(monkeypatch):
    # Configured target that refuses connections must surface as state=down,
    # not a 500. The UI relies on the 200 envelope.
    monkeypatch.setitem(cp_app.PROBE_TARGETS, "openclaw", "http://stub.local")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    transport = httpx.MockTransport(handler)

    def fake_get(url, *, timeout=None):
        with httpx.Client(transport=transport) as c:
            return c.get(url, timeout=timeout)

    monkeypatch.setattr(cp_app.httpx, "get", fake_get)
    tc = TestClient(cp_app.app)
    r = tc.get("/probe/openclaw")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "down"
    assert "target" in body
    # detail must not leak the raw exception text or any embedded URL —
    # only the exception class name is acceptable on the wire.
    assert body["detail"] == "ConnectError"


def test_probe_response_strips_credentials_and_query():
    # Operators sometimes embed credentials or tokens in env-configured
    # URLs; the probe response must surface only scheme://host[:port]/path,
    # never userinfo or query params.
    safe = cp_app._safe_probe_target(
        "http://user:secret@internal.example:8080/v1/models?api_key=abc#frag"
    )
    assert safe == "http://internal.example:8080/v1/models"
    assert "user" not in safe
    assert "secret" not in safe
    assert "api_key" not in safe
