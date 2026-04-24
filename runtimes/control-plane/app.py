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

OFFLOAD_WORKER_URL = os.environ.get(
    "OFFLOAD_WORKER_URL", "http://offload-worker.system-b.svc.cluster.local:8080"
).rstrip("/")
OFFLOAD_TIMEOUT_SECONDS = float(os.environ.get("OFFLOAD_TIMEOUT_SECONDS", "60"))
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "demo-artifacts")
PRESIGN_EXPIRES_SECONDS = int(os.environ.get("PRESIGN_EXPIRES_SECONDS", "900"))


_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _s3_client():
    if not MINIO_ENDPOINT:
        raise HTTPException(status_code=503, detail="MINIO_ENDPOINT not configured")
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        region_name="us-east-1",
        config=BotoConfig(signature_version="s3v4"),
    )


class OffloadRequest(BaseModel):
    task_type: str = Field(min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None
    timeout_seconds: Optional[float] = None


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
    return {"status": "ok"}


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

    timeout = req.timeout_seconds if req.timeout_seconds else OFFLOAD_TIMEOUT_SECONDS
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
    except httpx.HTTPError as exc:
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

    return OffloadSubmitted(
        job_id=job_id,
        status=_jobs[job_id]["status"],
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
