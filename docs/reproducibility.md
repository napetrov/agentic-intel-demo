# Reproducibility Guide

Everything needed to redeploy the demo from scratch on a fresh environment.
This document is the checklist that makes the demo reproducible.

---

## Principle
Anyone with:
- access to System A and System B
- the secrets listed in this document
- this repository

should be able to install `openclaw-operator`, apply one `OpenClawInstance`, and get a working demo.

Use the operator install and runbook docs in the main `docs/` directory as the primary checklist to the first proven green instance.

---

## Prerequisites

### Tools required on the deploy workstation
```
k3s        >= 1.31
kubectl    >= 1.28
helm       >= 3.13   (for the vLLM bring-up)
docker     >= 24
git        any
python3    >= 3.12
pip
aws CLI    >= 2 (for MinIO artifact tests)
```

### Access required
- kubeconfig for System A cluster
- kubeconfig for System B cluster (or same if single cluster)
- a host environment that actually has `kubectl` installed for the target cluster workflow
- Telegram bot token
- Cloud model API key (OpenAI / Anthropic / AWS Bedrock)
- OpenClaw auth/license secret if required by runtime

---

## Values to fill in (deploy checklist)

Before bringing up Tier 2, gather every value below into your shell or a
secrets manager. The right column is the source of truth for "where this
value lives in the repo" — every Tier 2 manifest reads from one of these.

| Variable | Where it lands | How to obtain |
|----------|---------------|---------------|
| `OPENCLAW_OPERATOR_REF` | `scripts/install-openclaw-operator.sh` | tag/SHA from `https://github.com/openclaw-rocks/openclaw-operator` releases — leaving `main` is reproducibly unstable |
| `OPENCLAW_OPERATOR_IMAGE` | `examples/openclawinstance-intel-demo.yaml` `spec.image` | upstream operator publishes runtime images at `ghcr.io/openclaw-rocks/openclaw:<tag>` — pin a tag, not `latest` |
| `TELEGRAM_BOT_TOKEN` | `intel-demo-operator-secrets`, `telegram-bot` (created by `scripts/create-operator-secrets.sh`) | BotFather → `/newbot` |
| `TELEGRAM_ALLOWED_FROM` | `examples/openclawinstance-intel-demo.yaml`, `session-pod-template.yaml` env | Telegram numeric user id (e.g. via `@userinfobot`) |
| `AWS_BEARER_TOKEN_BEDROCK` | `intel-demo-operator-secrets`, `litellm-secrets` | AWS Bedrock console → "Bedrock API keys" → generate bearer token |
| `AWS_REGION` | `litellm.yaml`, `session-pod-template.yaml` env | the region of your Bedrock inference profile (e.g. `us-east-2`) |
| `BEDROCK_MODEL_ID` | `session-pod-template.yaml` env | e.g. `us.anthropic.claude-sonnet-4-6` (must match an enabled Bedrock model) |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `examples/openclawinstance-intel-demo.yaml`, `session-pod-template.yaml` env | the inference-profile ARN created in your Bedrock account |
| `SAMBANOVA_API_KEY` | `intel-demo-operator-secrets`, `litellm-secrets` | SambaNova Cloud account → API keys |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | `intel-demo-operator-secrets`, `minio-creds`, `session-pod-artifact-creds` | choose any (these create the MinIO root user) |
| `SYSTEM_B_VLLM_ENDPOINT` | `k8s/system-a/litellm.yaml` ConfigMap | `http://<system-b-node-ip>:30434/v1` after `setup-system-b-vllm-local.sh` |
| `system_b_node_ip` | `config/env/system-b.yaml` (template) | `kubectl --context system-b get nodes -o wide` (use `INTERNAL-IP`) |

The two-step materialization is:

1. Export every variable listed above into your shell (or `source` from
   a `.env` you keep out of git).
2. Run `APPLY=1 ./scripts/create-operator-secrets.sh` once per cluster
   context (`KUBECTL="kubectl --context system-a" SCOPE=system-a` and
   `KUBECTL="kubectl --context system-b" SCOPE=system-b`). The script
   uses `kubectl create secret --dry-run=client -o yaml | kubectl apply
   -f -` so plaintext values never land on disk.

---

## Secrets to provision

The canonical materialization path is `scripts/create-operator-secrets.sh`,
which writes every Secret the demo expects in one shot:

| Secret | Namespace | Used by |
|--------|-----------|---------|
| `intel-demo-operator-secrets` | `default` | `OpenClawInstance.spec.envFromSecrets` (`examples/openclawinstance-intel-demo.yaml`) |
| `litellm-secrets` | `inference` | `k8s/system-a/litellm.yaml` (Bedrock + SambaNova keys) |
| `session-pod-artifact-creds` | `agents` | `session-pod-template` (MinIO/S3 creds for the agent pod) |
| `telegram-bot` | `agents` | `session-pod-template` (`TELEGRAM_BOT_TOKEN`) |
| `bedrock-creds` | `agents` | `session-pod-template` (`AWS_BEARER_TOKEN_BEDROCK`); separate from the `default`-ns copy because `secretKeyRef` can't cross namespaces |
| `minio-creds` | `system-b` | `k8s/system-b/minio.yaml` + `offload-worker.yaml` |

The script's required-env-var set is `SCOPE`-aware: `system-a` (or `all`)
needs the full Telegram/Bedrock/SambaNova/MinIO set; `system-b` needs
only `MINIO_ACCESS_KEY` + `MINIO_SECRET_KEY`. It also pre-creates the
destination namespaces (idempotent) so applying on a clean cluster
doesn't fail with `namespaces "..." not found`.

```bash
# Single cluster
APPLY=1 \
  TELEGRAM_BOT_TOKEN=... \
  AWS_BEARER_TOKEN_BEDROCK=... \
  SAMBANOVA_API_KEY=... \
  MINIO_ACCESS_KEY=... \
  MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh

# Two clusters
APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
  TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... SAMBANOVA_API_KEY=... \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh

APPLY=1 SCOPE=system-b KUBECTL="kubectl --context system-b" \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh
```

The script uses `kubectl create secret --dry-run=client -o yaml |
kubectl apply -f -`, so plaintext values never land on disk.

---

## Environment config files to fill in

Before running the deploy script, fill in:

### `config/env/system-a.yaml`
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

### `config/env/system-b.yaml`
```yaml
cluster_name: system-b
control_plane_url: https://api.system-b.example.com
namespaces:
  services: system-b
vllm_endpoint: http://<system-b-node-ip>:30434/v1   # OpenAI-compatible
minio_endpoint: http://minio.system-b.svc.cluster.local:9000
minio_nodeport: 30900  # externally accessible for System A
offload_api_endpoint: http://offload-api.system-b.svc.cluster.local:8080
```

---

## Component versions

All component versions are pinned in `config/versions.yaml` (vLLM-canonical
path; the older ollama-based pins were removed when the demo pivoted to
vLLM/Qwen3-4B).

---

## Deploy steps (in order)

```bash
# 0. Clone repo and configure env
git clone <repo>
cd agentic-intel-demo
cp config/env/system-a.yaml.template config/env/system-a.yaml   # if present
cp config/env/system-b.yaml.template config/env/system-b.yaml   # if present
# fill in system-a.yaml and system-b.yaml

# 0.5 Install k3s and export kubeconfigs
# See docs/port-map.md and docs/single-node-validation.md

# 1. Bring up System B model backend + storage
APPLY=1 \
  CHART_REPO=https://github.com/<your-org>/Enterprise-Inference.git \
  CHART_REF=<tag|sha> \
  KUBECTL="kubectl --context system-b" \
  ./scripts/setup-system-b-vllm-local.sh
APPLY=1 SCOPE=system-b KUBECTL="kubectl --context system-b" \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh
kubectl --context system-b apply -f k8s/system-b/minio.yaml
# Create the artifact bucket against the published MinIO NodePort 30900.
# Without this, offload uploads fail on a fresh System B.
SYSTEM_B_IP=<system-b-node-ip> \
  MINIO_ROOT_USER="$MINIO_ACCESS_KEY" \
  MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
  ./scripts/create-minio-bucket.sh
kubectl --context system-b apply -f k8s/system-b/offload-worker.yaml

# 2. Provision System A secrets (operator instance + LiteLLM + agent pod)
APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
  TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... SAMBANOVA_API_KEY=... \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh

# 3. Inference proxy on System A
SYSTEM_B_VLLM_ENDPOINT=http://<system-b-node-ip>:30434/v1 \
  AWS_REGION=us-east-2 \
  envsubst < k8s/system-a/litellm.yaml \
  | kubectl --context system-a apply -f -

# 4. Install openclaw-operator (pin the ref!)
APPLY=1 OPENCLAW_OPERATOR_REF=<tag|sha> ./scripts/install-openclaw-operator.sh

# 5. Apply one OpenClawInstance.
#    The example file ships a concrete spec — the only ${VAR} token in
#    it is ${TELEGRAM_BOT_TOKEN} inside the embedded openclaw.json,
#    which the OpenClaw runtime expands from intel-demo-operator-secrets
#    at session-pod boot (not envsubst at apply time). Edit the YAML in
#    place if you need different region / Bedrock ARN / allow-from
#    values.
kubectl --context system-a apply -f examples/openclawinstance-intel-demo.yaml

# 6. Verify operator-managed lifecycle
APPLY=1 ./scripts/smoke-test-operator-instance.sh
```

---

## Verification scripts

Current operator-first checks in `scripts/`:

| Script | What it checks |
|--------|----------------|
| `check-operator-prereqs.sh` | operator prerequisites, CRD/controller/log commands |
| `smoke-test-operator-instance.sh` | lifecycle verification checklist for `OpenClawInstance` |
| `setup-system-b-vllm-local.sh` | kubectl/helm vLLM bring-up for the current context (no SSH) |
| `load-offload-worker-image.sh` | build + load the offload-worker image into k3s/k3d when GHCR is unreachable |
| `check-system-b-vllm.sh` | verify the running vLLM service and its context length |

Legacy component checks may still exist in the repo, but they are not the canonical instance-management path.

---

## What to commit vs what to exclude from git

### Commit
- All YAML manifests
- Config templates (`.yaml.template`)
- Deploy scripts
- Verification scripts
- Version pins (`config/versions.yaml`)
- Documentation

### Never commit
- Actual secrets
- Kubeconfigs
- `.env` files with credentials
- Model weights

### `.gitignore` additions
```
config/env/system-a.yaml
config/env/system-b.yaml
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

## Operator-specific recovery note

If using the OpenClaw operator path, do not assume `kubectl apply -k` of the whole bundle is safe for large CRDs.

The CRD `openclawinstances.openclaw.rocks` may fail with `metadata.annotations: Too long`.

For operator recovery:
- apply the CRD separately
- prefer server-side apply or create/replace for the CRD
- then apply the controller manifests
- then create the `OpenClawInstance`

See `docs/operator-runbook.md`.
