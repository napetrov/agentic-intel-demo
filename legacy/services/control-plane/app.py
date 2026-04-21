import os
import re
from copy import deepcopy
from typing import Any
from uuid import uuid4

import yaml
from fastapi import Depends, FastAPI, Header, HTTPException
from kubernetes import client, config
from kubernetes.client.rest import ApiException
from pydantic import BaseModel, Field, field_validator

app = FastAPI(title="demo-control-plane")

AGENTS_NAMESPACE = os.getenv("AGENTS_NAMESPACE", "agents")
SESSION_TEMPLATE_CONFIGMAP = os.getenv("SESSION_TEMPLATE_CONFIGMAP", "session-pod-template")
CONTROL_PLANE_TOKEN = os.getenv("CONTROL_PLANE_TOKEN", "")
K8S_LABEL_VALUE_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$")


def require_bearer(authorization: str | None = Header(default=None)) -> None:
    if not CONTROL_PLANE_TOKEN:
        raise HTTPException(status_code=500, detail="control plane token not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if token != CONTROL_PLANE_TOKEN:
        raise HTTPException(status_code=403, detail="invalid bearer token")


def load_kube() -> None:
    try:
        config.load_incluster_config()
    except Exception:
        kubeconfig = os.getenv("KUBECONFIG")
        if kubeconfig:
            config.load_kube_config(config_file=kubeconfig)
        else:
            config.load_kube_config()


load_kube()
core_api = client.CoreV1Api()


class SessionCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=63)
    agent_profile: str = Field(default="default", min_length=1, max_length=63)

    @field_validator("user_id", "agent_profile")
    @classmethod
    def validate_k8s_label_value(cls, value: str) -> str:
        if not K8S_LABEL_VALUE_RE.fullmatch(value):
            raise ValueError(
                "must match Kubernetes label value constraints: 1-63 chars, alnum plus ._- , and start/end with alnum"
            )
        return value


def read_pod_template() -> dict[str, Any]:
    cm = core_api.read_namespaced_config_map(SESSION_TEMPLATE_CONFIGMAP, AGENTS_NAMESPACE)
    if not cm.data or "pod.yaml" not in cm.data:
        raise HTTPException(status_code=500, detail="session pod template missing pod.yaml")
    return yaml.safe_load(cm.data["pod.yaml"])


def build_session_pod(session_id: str, payload: SessionCreate) -> dict[str, Any]:
    pod = deepcopy(read_pod_template())
    metadata = pod.setdefault("metadata", {})
    spec = pod.setdefault("spec", {})
    metadata["name"] = f"session-{session_id}"
    labels = metadata.setdefault("labels", {})
    labels.update(
        {
            "session_id": session_id,
            "user_id": payload.user_id,
            "agent_profile": payload.agent_profile,
        }
    )
    spec["restartPolicy"] = "Always"
    return pod


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sessions", dependencies=[Depends(require_bearer)])
def create_session(payload: SessionCreate):
    session_id = f"sess-{uuid4().hex[:12]}"
    pod_manifest = build_session_pod(session_id, payload)
    try:
        core_api.create_namespaced_pod(namespace=AGENTS_NAMESPACE, body=pod_manifest)
    except ApiException as exc:
        raise HTTPException(status_code=exc.status or 500, detail=exc.body)
    return {
        "session_id": session_id,
        "user_id": payload.user_id,
        "agent_profile": payload.agent_profile,
        "status": "created",
        "pod_name": pod_manifest["metadata"]["name"],
    }


@app.get("/sessions/{session_id}", dependencies=[Depends(require_bearer)])
def get_session(session_id: str):
    pod_name = f"session-{session_id}"
    try:
        pod = core_api.read_namespaced_pod(name=pod_name, namespace=AGENTS_NAMESPACE)
    except ApiException as exc:
        if exc.status == 404:
            raise HTTPException(status_code=404, detail="session not found")
        raise HTTPException(status_code=exc.status or 500, detail=exc.body)
    return {
        "session_id": session_id,
        "pod_name": pod.metadata.name,
        "phase": pod.status.phase,
        "pod_ip": pod.status.pod_ip,
        "host_ip": pod.status.host_ip,
    }


@app.delete("/sessions/{session_id}", dependencies=[Depends(require_bearer)])
def delete_session(session_id: str):
    pod_name = f"session-{session_id}"
    try:
        core_api.delete_namespaced_pod(name=pod_name, namespace=AGENTS_NAMESPACE)
    except ApiException as exc:
        if exc.status == 404:
            return {"deleted": False, "session_id": session_id}
        raise HTTPException(status_code=exc.status or 500, detail=exc.body)
    return {"deleted": True, "session_id": session_id, "pod_name": pod_name}
