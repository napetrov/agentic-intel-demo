"""
Static + /api proxy for the web demo, used by scripts/dev-up.sh when Docker
isn't available.

The docker-compose path serves the same routes via nginx (web-demo/nginx.conf);
this file mirrors them in pure Python so a `git clone` + venv setup can run
the demo end-to-end without a container runtime. If you change one, change
the other — they share the same /api/* contract used by web-demo/app.js.
"""
from __future__ import annotations

import os
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

# Defaults assume the layout produced by scripts/dev-up.sh.
WEB_DIR = Path(
    os.environ.get(
        "WEB_DEMO_DIR",
        str(Path(__file__).resolve().parent.parent / "web-demo"),
    )
)
CONTROL_PLANE = (
    os.environ.get("WEB_DEMO_CONTROL_PLANE_URL")
    or os.environ.get("CONTROL_PLANE_URL")
    or "http://127.0.0.1:8090"
).rstrip("/")

app = FastAPI(title="dev-web-proxy")

# Read timeout matches the nginx config's /api/offload (`proxy_read_timeout 120s`)
# so a long-running shell scenario doesn't get cut off by the proxy.
_client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=5.0, read=125.0, write=10.0, pool=5.0),
)


async def _forward(method: str, target: str, body: bytes | None = None) -> Response:
    headers = {"content-type": "application/json"} if body else None
    try:
        upstream = await _client.request(method, target, content=body, headers=headers)
    except httpx.HTTPError as exc:
        return JSONResponse({"error": f"upstream unreachable: {exc}"}, status_code=502)
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


@app.get("/api/health")
async def api_health() -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/health")


@app.get("/api/ready")
async def api_ready() -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/ready")


@app.post("/api/offload")
async def api_offload(request: Request) -> Response:
    body = await request.body()
    return await _forward("POST", f"{CONTROL_PLANE}/offload", body=body)


@app.get("/api/offload/{job_id}")
async def api_offload_get(job_id: str) -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/offload/{job_id}")


@app.get("/api/artifacts/{ref:path}")
async def api_artifact(ref: str) -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/artifacts/{ref}")


@app.get("/api/probe/{name}")
async def api_probe(name: str) -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/probe/{name}")


# Sessions API — multi-agent fan-out. Mirrors the routes in nginx.conf so
# the dev-up path serves the same /api contract as the docker-compose path.
@app.get("/api/sessions/profiles")
async def api_sessions_profiles() -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/sessions/profiles")


@app.post("/api/sessions")
async def api_sessions_create(request: Request) -> Response:
    body = await request.body()
    return await _forward("POST", f"{CONTROL_PLANE}/sessions", body=body)


@app.post("/api/sessions/batch")
async def api_sessions_batch(request: Request) -> Response:
    body = await request.body()
    return await _forward("POST", f"{CONTROL_PLANE}/sessions/batch", body=body)


@app.get("/api/sessions")
async def api_sessions_list() -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/sessions")


@app.get("/api/sessions/{session_id}")
async def api_sessions_get(session_id: str) -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/sessions/{session_id}")


@app.delete("/api/sessions/{session_id}")
async def api_sessions_delete(session_id: str) -> Response:
    return await _forward("DELETE", f"{CONTROL_PLANE}/sessions/{session_id}")


# Agents API — long-lived agent registry (read-only in v1). Same routes
# as nginx.conf so dev-up and docker-compose serve the same /api contract.
@app.get("/api/agents/kinds")
async def api_agents_kinds() -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/agents/kinds")


@app.get("/api/agents/systems")
async def api_agents_systems() -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/agents/systems")


@app.get("/api/agents")
async def api_agents_list() -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/agents")


@app.get("/api/agents/{agent_id}")
async def api_agents_get(agent_id: str) -> Response:
    return await _forward("GET", f"{CONTROL_PLANE}/agents/{agent_id}")


# Static last so /api/* wins. html=True makes "/" serve index.html.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="static")
