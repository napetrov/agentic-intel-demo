# Reusable Components

Focus: use ready-made tools, not custom platform code.
This document lists what to reuse as-is, what to configure, and what to build minimally.

---

## Use as-is

### OpenClaw
- **What**: agent runtime, tool execution, session model, chat integrations
- **Use for**: session pod runtime, Telegram integration, tool layer, orchestration
- **How to deploy**: install in session pod container image
- **Notes**: handles model calls, tool loops, artifact handling natively

### Kubernetes
- **What**: container orchestration
- **Use for**: session pod lifecycle, execution jobs, worker jobs
- **How to deploy**: already running on both systems
- **Notes**: use standard k8s Jobs for execution and offload workers

### LiteLLM (berriai/litellm)
- **What**: OpenAI-compatible proxy with model routing, fallbacks, aliases
- **Repo**: https://github.com/BerriAI/litellm
- **Use for**: single model endpoint for all agent calls, routing policy
- **Deploy**: `docker pull ghcr.io/berriai/litellm:main-latest`
- **Config**: `configs/model-routing/litellm-config.yaml`
- **Notes**: supports local SLM + cloud backends, retry logic, cost tracking

### ollama (for local SLM — MVP choice)
- **What**: local model server, OpenAI-compatible API
- **Repo**: https://github.com/ollama/ollama
- **Use for**: local SLM on System B
- **Deploy**: `docker pull ollama/ollama` or install binary on System B
- **Models**: `ollama pull qwen2.5:7b-instruct` or `ollama pull llama3.2:3b`
- **API**: `http://system-b:11434/v1` (OpenAI-compatible with `/v1` prefix)
- **Notes**: easiest for CPU-only deployment; no HuggingFace token needed for Qwen2.5

### vLLM (optional upgrade from ollama)
- **What**: high-performance inference server, OpenAI-compatible
- **Repo**: https://github.com/vllm-project/vllm
- **Use for**: replace ollama if throughput/latency matters
- **Notes**: better for GNR CPU with AMX; requires more setup than ollama

### MinIO
- **What**: S3-compatible object storage
- **Repo**: https://github.com/minio/minio
- **Use for**: artifact store, session outputs, job results
- **Deploy**: `docker pull minio/minio`
- **Notes**: one instance on System B, accessible from both systems

### PostgreSQL (or SQLite for MVP)
- **What**: relational DB for session/job metadata
- **Use for**: session registry, job tracking, artifact refs
- **Deploy**: `docker pull postgres:16` or use SQLite file for single-node MVP
- **Notes**: SQLite is fine for demo; swap for Postgres if multi-replica control plane needed

### Terminal Bench
- **What**: terminal/code task harness
- **Use for**: Task 1 terminal agent scenario baseline
- **Notes**: use only if it clearly accelerates Task 1 packaging; otherwise start with a simpler native terminal task and add Terminal Bench after the first working path

### Kubernetes Python client
- **What**: Python SDK for k8s API
- **Repo**: https://github.com/kubernetes-client/python
- **Use for**: control plane service (session manager, job launcher)
- **Install**: `pip install kubernetes`

### FastAPI
- **What**: lightweight Python HTTP framework
- **Use for**: control plane API, offload API on System B
- **Install**: `pip install fastapi uvicorn`

---

## Configure (ready-made but needs setup)

| Component | What to configure |
|-----------|------------------|
| LiteLLM | model routing config, API keys, aliases |
| ollama | model pull, exposed port, resource limits |
| MinIO | bucket creation, access key pair |
| Kubernetes RBAC | ServiceAccount for control plane |
| OpenClaw | agent config, model endpoint, tool enablement |

---

## Build minimally (custom code)

| Component | Why custom | Scope |
|-----------|-----------|-------|
| Control plane API | k8s-specific logic, scale-up semantics | ~300-500 LOC FastAPI |
| Offload API (System B) | job contract, artifact handoff | ~200-300 LOC FastAPI |
| Chat gateway session mapper | chat_user → session_id mapping | ~100 LOC |
| Deploy scripts | system-specific, reproducibility | shell + kubectl manifests |

---

## What NOT to build

- Custom scheduler — use Kubernetes Jobs
- Custom model router — use LiteLLM
- Custom object store — use MinIO
- Custom agent runtime — use OpenClaw
- Custom container registry (optional) — use Docker Hub or GHCR
- Custom auth for demo — k8s Secrets is enough
- Service mesh — not needed for demo
- Custom observability stack — not needed for demo (use `kubectl logs`)

---

## OPEA Enterprise Inference

OPEA project (`opea-project/Enterprise-Inference`) provides:
- inventory-driven deployment pattern for inference infra
- Ansible-based k8s deployment
- Keycloak + APISIX API gateway setup
- model serving deployment automation

For demo MVP:
- **borrow**: inventory config pattern (feature-toggle style deployment config)
- **skip**: Keycloak, APISIX, Ceph, Istio — overkill for demo
- **consider later**: OPEA genai gateway as alternative to LiteLLM if needed

---

## Component version pinning

All deployed components should be version-pinned in `configs/versions.yaml`
to make the demo reproducible. See `docs/reproducibility.md`.
