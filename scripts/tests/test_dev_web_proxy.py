"""Unit tests for scripts/dev_web_proxy.py.

The proxy is a thin pass-through: each /api/* route forwards to the same
path on the configured control-plane and copies the upstream's status code
+ body. We exercise the routing table with httpx.MockTransport so no
network is touched.

Loaded by file path because `scripts/` isn't a package; the module is
registered in sys.modules so FastAPI's TestClient can resolve it.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PROXY_PATH = REPO_ROOT / "scripts" / "dev_web_proxy.py"

# Point WEB_DEMO_DIR at the real web-demo dir so the StaticFiles mount
# resolves at import time. Set CONTROL_PLANE_URL to a sentinel so the
# tests can assert the proxy uses it (rather than the production
# default).
os.environ["WEB_DEMO_DIR"] = str(REPO_ROOT / "web-demo")
os.environ["CONTROL_PLANE_URL"] = "http://control-plane.test"

_spec = importlib.util.spec_from_file_location("dev_web_proxy_under_test", PROXY_PATH)
assert _spec is not None and _spec.loader is not None
proxy = importlib.util.module_from_spec(_spec)
sys.modules["dev_web_proxy_under_test"] = proxy
_spec.loader.exec_module(proxy)

# fastapi.testclient must be imported AFTER the proxy module is loaded
# (StaticFiles mount needs to see WEB_DEMO_DIR first).
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def proxy_with_upstream(monkeypatch):
    """Replace the proxy's shared httpx.AsyncClient with one driven by a
    user-supplied MockTransport handler. Returns a TestClient bound to
    the proxy's FastAPI app."""

    def factory(handler):
        transport = httpx.MockTransport(handler)
        client = httpx.AsyncClient(transport=transport, timeout=5.0)
        monkeypatch.setattr(proxy, "_client", client)
        return TestClient(proxy.app)

    return factory


# --- happy paths ----------------------------------------------------------


def test_health_forwards(proxy_with_upstream):
    def handler(req: httpx.Request) -> httpx.Response:
        assert str(req.url) == "http://control-plane.test/health"
        return httpx.Response(200, json={"status": "ok"})

    tc = proxy_with_upstream(handler)
    r = tc.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_ready_forwards(proxy_with_upstream):
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/ready"
        return httpx.Response(200, json={"status": "ready"})

    tc = proxy_with_upstream(handler)
    r = tc.get("/api/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready"}


def test_offload_post_body_forwarded(proxy_with_upstream):
    seen: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["path"] = req.url.path
        seen["body"] = req.read()
        return httpx.Response(200, json={"job_id": "job-1", "status": "completed"})

    tc = proxy_with_upstream(handler)
    payload = b'{"task_type":"echo","payload":{"x":1}}'
    r = tc.post(
        "/api/offload",
        content=payload,
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 200
    assert seen["path"] == "/offload"
    # The proxy must forward the request body byte-for-byte; control-plane
    # validates pydantic shapes, the proxy must not mutate.
    assert seen["body"] == payload


def test_offload_get_substitutes_job_id(proxy_with_upstream):
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/offload/job-deadbeef"
        return httpx.Response(200, json={"job_id": "job-deadbeef", "status": "completed"})

    tc = proxy_with_upstream(handler)
    r = tc.get("/api/offload/job-deadbeef")
    assert r.status_code == 200
    assert r.json()["job_id"] == "job-deadbeef"


def test_artifact_path_passes_slashes(proxy_with_upstream):
    # The artifact ref uses `offload/<session>/<task>.json`; the proxy
    # must keep the embedded slashes when forwarding.
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/artifacts/offload/sess-1/task-1.json"
        return httpx.Response(
            200, json={"ref": "offload/sess-1/task-1.json", "url": "https://x", "expires_in": 60}
        )

    tc = proxy_with_upstream(handler)
    r = tc.get("/api/artifacts/offload/sess-1/task-1.json")
    assert r.status_code == 200


def test_probe_forwards(proxy_with_upstream):
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/probe/openclaw"
        return httpx.Response(200, json={"state": "ok", "target": "openclaw"})

    tc = proxy_with_upstream(handler)
    r = tc.get("/api/probe/openclaw")
    assert r.status_code == 200
    assert r.json()["state"] == "ok"


# --- failure modes --------------------------------------------------------


def test_upstream_unreachable_returns_502(proxy_with_upstream):
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=req)

    tc = proxy_with_upstream(handler)
    r = tc.get("/api/health")
    assert r.status_code == 502
    assert "upstream unreachable" in r.json()["error"]


def test_non_2xx_status_propagated(proxy_with_upstream):
    # Control-plane returns 404 for unknown jobs; the proxy must mirror
    # that status code rather than coercing it to 200 or 502.
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "unknown job_id"})

    tc = proxy_with_upstream(handler)
    r = tc.get("/api/offload/job-missing")
    assert r.status_code == 404
    assert r.json() == {"detail": "unknown job_id"}


# --- static file serving --------------------------------------------------


def test_root_serves_index(proxy_with_upstream):
    # /api/* and / share the same FastAPI app; the static mount must keep
    # serving index.html from web-demo/ even when /api routes are wired.
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    tc = proxy_with_upstream(handler)
    r = tc.get("/")
    assert r.status_code == 200
    assert "<html" in r.text.lower()


def test_static_asset_under_root(proxy_with_upstream):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    tc = proxy_with_upstream(handler)
    r = tc.get("/app.js")
    assert r.status_code == 200
    assert "data-health" in r.text
