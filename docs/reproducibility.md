# Reproducibility Guide

Everything needed to redeploy the demo from scratch on a fresh environment.
This document is the checklist that makes the demo reproducible.

---

## Principle
Anyone with:
- access to System A and System B
- the secrets listed in this document
- this repository

should be able to run the deploy script and get a working demo.

---

## Prerequisites

### Tools required on the deploy workstation
```
k3s        >= 1.30
kubectl    >= 1.28
docker     >= 24
python3    >= 3.12
pip
aws CLI    >= 2 (for MinIO artifact tests)
```

### Access required
- kubeconfig for System A cluster
- kubeconfig for System B cluster (or same if single cluster)
- Telegram bot token
- Cloud model API key (OpenAI / Anthropic / AWS Bedrock)
- OpenClaw auth/license secret if required by runtime

---

## Secrets to provision

### k8s Secrets — System A namespace `agents`

```bash
kubectl create secret generic litellm-api-keys -n inference \
  --from-literal=OPENAI_API_KEY=... \
  --from-literal=ANTHROPIC_API_KEY=...

kubectl create secret generic minio-credentials -n agents \
  --from-literal=MINIO_ACCESS_KEY=... \
  --from-literal=MINIO_SECRET_KEY=...

kubectl create secret generic telegram-bot -n agents \
  --from-literal=TELEGRAM_BOT_TOKEN=...

kubectl create secret generic openclaw-auth -n agents \
  --from-literal=OPENCLAW_AUTH_TOKEN=...
```

### k8s Secrets — System B namespace `system-b`

```bash
kubectl create secret generic minio-credentials -n system-b \
  --from-literal=MINIO_ACCESS_KEY=... \
  --from-literal=MINIO_SECRET_KEY=...

kubectl create secret generic system-b-kubeconfig -n platform \
  --from-file=kubeconfig=/path/to/system-b-kubeconfig
```

---

## Environment config files to fill in

Before running the deploy script, fill in:

### `configs/env/system-a.yaml`
```yaml
cluster_name: system-a
control_plane_url: https://api.system-a.example.com
namespaces:
  agents: agents
  inference: inference
  platform: platform
litellm_endpoint: http://litellm.inference.svc.cluster.local:4000
minio_endpoint: http://system-b-minio:9000  # reachable from System A pods
artifact_bucket: demo-artifacts
```

### `configs/env/system-b.yaml`
```yaml
cluster_name: system-b
control_plane_url: https://api.system-b.example.com
namespaces:
  services: system-b
ollama_endpoint: http://ollama.system-b.svc.cluster.local:11434
minio_endpoint: http://minio.system-b.svc.cluster.local:9000
minio_nodeport: 30900  # externally accessible for System A
offload_api_endpoint: http://offload-api.system-b.svc.cluster.local:8080
```

---

## Component versions

All component versions are pinned in `configs/versions.yaml`:

```yaml
components:
  k3s: "v1.30.x"
  ollama: "0.6.x"
  litellm: "1.x"
  minio: "RELEASE.2025-04-03T14-56-28Z"
  python_base: "3.12-slim"
  node_base: "22-slim"

models:
  local_slm: "qwen2.5:7b-instruct"
  # alternative: "llama3.2:3b"
```

---

## Deploy steps (in order)

```bash
# 0. Clone repo and configure env
git clone <repo>
cd agentic-intel-demo
cp configs/env/system-a.yaml.template configs/env/system-a.yaml
cp configs/env/system-b.yaml.template configs/env/system-b.yaml
# fill in system-a.yaml and system-b.yaml

# 0.5 Install k3s and export kubeconfigs
# See docs/port-map.md and docs/single-node-validation.md

# 1. Create namespaces
kubectl --context system-a apply -f k8s/system-a/namespaces.yaml
kubectl --context system-b apply -f k8s/system-b/namespaces.yaml

# 2. Provision secrets (see above)

# 3. Deploy MinIO on System B
kubectl --context system-b apply -f k8s/system-b/minio.yaml
# verify:
./scripts/check-minio.sh

# 4. Deploy ollama on System B
kubectl --context system-b apply -f k8s/system-b/ollama.yaml
# pull model:
./scripts/pull-models.sh
# verify:
./scripts/check-ollama.sh

# 5. Deploy LiteLLM on System A
kubectl --context system-a apply -f k8s/system-a/litellm.yaml
# verify:
./scripts/check-litellm.sh

# 6. Deploy control plane on System A
kubectl --context system-a apply -f k8s/system-a/rbac.yaml
kubectl --context system-a apply -f k8s/system-a/control-plane.yaml
# verify:
./scripts/check-control-plane.sh

# 7. Deploy offload API on System B
kubectl --context system-b apply -f k8s/system-b/offload-api.yaml
# verify:
./scripts/check-offload-api.sh

# 8. Build and distribute images
# choose one path: GHCR / Docker Hub / local registry / ctr import

# 9. Test end-to-end session launch
./scripts/smoke-test-session.sh
```

---

## Verification scripts

Each component has a check script in `scripts/`:

| Script | What it checks |
|--------|----------------|
| `check-minio.sh` | write/read artifact to MinIO from a test pod |
| `check-ollama.sh` | curl ollama `/api/tags`, verify model is present |
| `check-litellm.sh` | curl `/v1/chat/completions` via LiteLLM with `default` model |
| `check-control-plane.sh` | `POST /sessions`, verify pod created |
| `check-offload-api.sh` | `POST /jobs` with test payload, verify job runs |
| `smoke-test-session.sh` | full Task 1 flow via Telegram or API, including session creation and response validation |

---

## What to commit vs what to exclude from git

### Commit
- All YAML manifests
- Config templates (`.yaml.template`)
- Deploy scripts
- Verification scripts
- Version pins (`configs/versions.yaml`)
- Documentation

### Never commit
- Actual secrets
- Kubeconfigs
- `.env` files with credentials
- Model weights

### `.gitignore` additions
```
configs/env/system-a.yaml
configs/env/system-b.yaml
*.env
kubeconfig*
```

---

## Recovery / reset

To reset the demo environment without touching infrastructure:

```bash
# delete all session pods
kubectl --context system-a delete pods -n agents -l role=session-pod

# delete all offload jobs
kubectl --context system-b delete jobs -n system-b -l role=offload-worker

# clear artifact bucket
aws s3 rm s3://demo-artifacts/ --recursive --endpoint-url http://system-b-minio:9000

# restart control plane
kubectl --context system-a rollout restart deploy/control-plane -n platform

# if needed, recreate secrets after reset
# reset script may optionally delete and require reapply of secrets
```
