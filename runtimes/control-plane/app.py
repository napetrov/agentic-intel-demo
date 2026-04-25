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

import boto3
import httpx
from botocore.client import Config as BotoConfig
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

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
PROBE_TIMEOUT_SECONDS = _parse_env_number("PROBE_TIMEOUT_SECONDS", "2.5", float)


_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()

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
    try:
        r = httpx.get(url, timeout=PROBE_TIMEOUT_SECONDS)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        return {"state": "down", "target": url, "detail": str(exc)[:200]}
    return {"state": "ok", "target": url}


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


@app.post("/offload", response_model=OffloadSubmitted)
def submit_offload(req: OffloadRequest) -> OffloadSubmitted:
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    now = time.time()
    with _jobs_lock:
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
    # httpx.HTTPError covers network/timeout/5xx via raise_for_status();
    # ValueError (parent of json.JSONDecodeError) covers a 200 response
    # body that is not valid JSON — e.g. an HTML error page returned by a
    # misbehaving proxy. isinstance check rejects a JSON body that decodes
    # to a list/scalar instead of an object. Either way, mark the job
    # failed instead of leaving it stuck in `running`.
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
        with _jobs_lock:
            _jobs[job_id].update(
                status="error",
                error=f"offload-worker call failed: {exc}",
                completed_at=time.time(),
            )
        raise HTTPException(
            status_code=502, detail=f"offload-worker unreachable: {exc}"
        ) from exc

    worker_status = body.get("status")
    with _jobs_lock:
        entry = _jobs[job_id]
        entry["task_id"] = body.get("task_id")
        entry["completed_at"] = time.time()
        if worker_status == "ok":
            entry["status"] = "completed"
            entry["result"] = body.get("result")
            entry["result_ref"] = body.get("result_key")
        else:
            entry["status"] = "error"
            entry["error"] = body.get("error") or "offload-worker returned error"
        final_status = entry["status"]

    return OffloadSubmitted(
        job_id=job_id,
        status=final_status,
        session_id=req.session_id,
    )


@app.get("/offload/{job_id}", response_model=OffloadStatus)
def get_offload(job_id: str) -> OffloadStatus:
    with _jobs_lock:
        entry = _jobs.get(job_id)
        if not entry:
            raise HTTPException(status_code=404, detail=f"unknown job_id {job_id}")
        return OffloadStatus(**entry)


@app.get("/artifacts/{ref:path}", response_model=ArtifactRef)
def get_artifact(ref: str) -> ArtifactRef:
    if not ref or ref.startswith("/") or ".." in ref:
        raise HTTPException(status_code=400, detail="invalid artifact ref")
    # Only presign refs that this relay actually issued (via POST /offload).
    # Otherwise any caller who can guess an object key turns this into a
    # bucket-wide read proxy. The set of issued refs lives in `_jobs`.
    with _jobs_lock:
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
