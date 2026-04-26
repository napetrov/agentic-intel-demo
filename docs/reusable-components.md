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
- **Config**: `config/model-routing/litellm-config.yaml`
- **Notes**: supports local SLM + cloud backends, retry logic, cost tracking

### vLLM (canonical local SLM)
- **What**: high-performance inference server, OpenAI-compatible.
- **Repo**: https://github.com/vllm-project/vllm
- **Use for**: local SLM on System B — the canonical path wired into
  `k8s/system-a/litellm.yaml` for Tier 2 bring-up.
- **CI coverage**: not directly validated by repo CI. The
  `tier1-scenario-slice` and `tier2-offload-smoke` jobs exercise the
  control-plane → offload-worker → MinIO path, not vLLM itself. Bring
  vLLM up by hand on a real System B host before relying on it.
- **Deploy**: `scripts/setup-system-b-vllm-local.sh` (kubectl/helm).
  Required inputs the script does **not** default:
  - `CHART_REPO` (`https://github.com/<your-org>/Enterprise-Inference.git`
    or another Helm chart that exposes the same values shape) and
    `CHART_REF` (tag or commit SHA — pinning floating refs is a
    reproducibility bug).
  - `KUBECTL` (e.g. `kubectl --context system-b`) so the install lands
    on the right cluster.
  - HuggingFace token if your model id requires gated download.
  - Any chart-specific Helm values overrides (resources, NodePort,
    `--max-model-len`) — defaults assume 16 CPU / 32Gi / 32768 ctx.
  See `docs/demo-setup.md` Tier 2 step 2.
- **Model**: `Qwen/Qwen3-4B-Instruct-2507` at 32768 ctx, 16 CPU / 32Gi.
  Pinned in `config/versions.yaml`.
- **API**: NodePort 30434, `/v1` is OpenAI-compatible.
- **Notes**: better for GNR CPU with AMX. The earlier ollama path
  (`docs/archive/mvp-plan.md` phases 1–2) used the same NodePort but
  is no longer the supported deploy path.

### ollama (historical alternative — not the canonical path)
- **What**: local model server, OpenAI-compatible API.
- **Repo**: https://github.com/ollama/ollama
- **Status**: was the MVP choice; replaced by vLLM. Kept here only as
  a reference for "what if I want to swap the backend on a host that
  can't run vLLM." `k8s/system-b/ollama.yaml` still parses but is not
  exercised by CI or the operator-first bring-up.

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
| vLLM | helm chart ref, model id, max-model-len, exposed NodePort, resource limits |
| MinIO | bucket creation, access key pair |
| Kubernetes RBAC | ServiceAccount for control plane |
| OpenClaw | agent config, model endpoint, tool enablement |

---

## Build minimally (custom code)

| Component | Why custom | Scope |
|-----------|-----------|-------|
| Control plane API | offload relay + artifact access semantics | ~300-500 LOC FastAPI |
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

All deployed components should be version-pinned in `config/versions.yaml`
to make the demo reproducible. See `docs/reproducibility.md`.
