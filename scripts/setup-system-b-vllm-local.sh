#!/usr/bin/env bash
# Bring up vLLM serving Qwen3-4B on the *current* kube context, without
# SSHing into a fixed host.
#
# This is the kubectl-only counterpart to scripts/archive/setup-system-b-vllm.sh,
# which assumes ssh access to the `onedal-build` host plus a local helm
# checkout of Enterprise-Inference. That path is not portable. This
# script targets the kube-context the operator picks up via
#   kubectl --context system-b ...
# (or whatever `KUBECTL` is set to), and pulls the helm chart from a
# git repo you own — no SSH required.
#
# Usage:
#   APPLY=1 \
#     CHART_REPO=https://github.com/<your-org>/Enterprise-Inference.git \
#     CHART_REF=<tag|sha> \
#     ./scripts/setup-system-b-vllm-local.sh
#
#   APPLY=0 ./scripts/setup-system-b-vllm-local.sh   # dry-run, prints commands
#
# CHART_PATH inside the checkout defaults to core/helm-charts/vllm to
# match the upstream Enterprise-Inference layout. Override with
# CHART_PATH=path/to/chart for forks.
set -euo pipefail

CHART_REPO="${CHART_REPO:-}"
CHART_REF="${CHART_REF:-main}"
CHART_PATH="${CHART_PATH:-core/helm-charts/vllm}"
RELEASE_NAME="${RELEASE_NAME:-vllm-qwen-3-4b-cpu}"
NAMESPACE="${NAMESPACE:-default}"
MODEL_ID="${MODEL_ID:-Qwen/Qwen3-4B-Instruct-2507}"
CPU="${CPU:-16}"
MEMORY="${MEMORY:-32Gi}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-32768}"
MAX_BATCHED_TOKENS="${MAX_BATCHED_TOKENS:-1024}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-64}"
KV_CACHE_SPACE="${KV_CACHE_SPACE:-8}"
SERVICE_TYPE="${SERVICE_TYPE:-NodePort}"
NODE_PORT="${NODE_PORT:-30434}"
APPLY="${APPLY:-0}"
KUBECTL="${KUBECTL:-kubectl}"
HELM="${HELM:-helm}"

if [ -z "$CHART_REPO" ] || [[ "$CHART_REPO" == *"<your-org>"* ]]; then
  cat >&2 <<EOF
[setup-system-b-vllm-local] CHART_REPO is required.

  The vLLM helm chart this script installs lives in an upstream fork
  the demo doesn't redistribute (the same gap as the openclaw-operator
  ref). Tracked as gap #7 in docs/internal/operator-gap-analysis.md.

  Two ways forward:

  1. Pin a fork you maintain:
       APPLY=1 \\
         CHART_REPO=https://github.com/<your-org>/Enterprise-Inference.git \\
         CHART_REF=<tag-or-sha> \\
         ./scripts/setup-system-b-vllm-local.sh

     CHART_PATH defaults to core/helm-charts/vllm to match the
     upstream Enterprise-Inference layout. Override per fork.

  2. Skip the chart and apply the static manifest instead:
       kubectl --context system-b apply -f k8s/system-b/vllm.yaml

     The static path doesn't accept the chart's full knob set (just
     model id, context length, and resources via env) and currently
     references the CUDA-first vllm/vllm-openai:latest image — swap
     to a CPU-tuned image (or a pinned tag you trust) before
     promoting past dry-run. See the YAML's header for caveats.
EOF
  exit 64
fi

read -r -a KUBECTL_CMD <<<"$KUBECTL"

cat <<EOF
[setup-system-b-vllm-local] Configuration:
  chart repo:   $CHART_REPO
  chart ref:    $CHART_REF
  chart path:   $CHART_PATH
  release:      $RELEASE_NAME
  namespace:    $NAMESPACE
  model:        $MODEL_ID
  cpu/memory:   $CPU CPU / $MEMORY
  context:      $MAX_MODEL_LEN tokens
  service:      $SERVICE_TYPE on nodePort $NODE_PORT
  apply:        $APPLY (set APPLY=1 to actually run helm/kubectl)
EOF

if [ "$APPLY" = "1" ]; then
  for cmd in "$HELM" git "${KUBECTL_CMD[0]}"; do
    command -v "$cmd" >/dev/null 2>&1 \
      || { echo "[setup-system-b-vllm-local] $cmd not found" >&2; exit 127; }
  done
fi

WORKDIR="$(mktemp -d -t vllm-chart-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

run() {
  echo "+ $*"
  if [ "$APPLY" = "1" ]; then
    "$@"
  fi
}

run git clone --depth 1 --branch "$CHART_REF" "$CHART_REPO" "$WORKDIR/src" \
  || run git clone "$CHART_REPO" "$WORKDIR/src"
if [ "$APPLY" = "1" ] && [ -d "$WORKDIR/src" ]; then
  run git -C "$WORKDIR/src" checkout "$CHART_REF"
fi

CHART_FULL="$WORKDIR/src/$CHART_PATH"
if [ "$APPLY" = "1" ] && [ ! -d "$CHART_FULL" ]; then
  echo "[setup-system-b-vllm-local] chart not found at $CHART_FULL" >&2
  echo "                            adjust CHART_PATH for this CHART_REF." >&2
  exit 2
fi

VALUES_FILE="$WORKDIR/${RELEASE_NAME}-values.yaml"
cat > "$VALUES_FILE" <<VALUES
LLM_MODEL_ID: ${MODEL_ID}
cpu: ${CPU}
memory: ${MEMORY}
tensor_parallel_size: "1"
pipeline_parallel_size: "1"
max_model_len: ${MAX_MODEL_LEN}
service:
  type: ${SERVICE_TYPE}
  nodePort: ${NODE_PORT}
pvc:
  enabled: true
defaultModelConfigs:
  configMapValues:
    VLLM_CPU_KVCACHE_SPACE: "${KV_CACHE_SPACE}"
    VLLM_RPC_TIMEOUT: "100000"
    VLLM_ALLOW_LONG_MAX_MODEL_LEN: "1"
    VLLM_ENGINE_ITERATION_TIMEOUT_S: "120"
    VLLM_CPU_NUM_OF_RESERVED_CPU: "0"
    VLLM_CPU_SGL_KERNEL: "1"
    HF_HUB_DISABLE_XET: "1"
  extraCmdArgs:
    - "--block-size"
    - "128"
    - "--dtype"
    - "bfloat16"
    - "--max-model-len"
    - "${MAX_MODEL_LEN}"
    - "--distributed_executor_backend"
    - "mp"
    - "--enable_chunked_prefill"
    - "--enforce-eager"
    - "--max-num-batched-tokens"
    - "${MAX_BATCHED_TOKENS}"
    - "--max-num-seqs"
    - "${MAX_NUM_SEQS}"
modelConfigs:
  "${MODEL_ID}":
    configMapValues:
      VLLM_CPU_KVCACHE_SPACE: "${KV_CACHE_SPACE}"
      VLLM_RPC_TIMEOUT: "100000"
      VLLM_ALLOW_LONG_MAX_MODEL_LEN: "1"
      VLLM_ENGINE_ITERATION_TIMEOUT_S: "120"
      VLLM_CPU_NUM_OF_RESERVED_CPU: "0"
      VLLM_CPU_SGL_KERNEL: "1"
      HF_HUB_DISABLE_XET: "1"
    extraCmdArgs:
      - "--block-size"
      - "128"
      - "--dtype"
      - "bfloat16"
      - "--max-model-len"
      - "${MAX_MODEL_LEN}"
      - "--distributed_executor_backend"
      - "mp"
      - "--enable_chunked_prefill"
      - "--enforce-eager"
      - "--max-num-batched-tokens"
      - "${MAX_BATCHED_TOKENS}"
      - "--max-num-seqs"
      - "${MAX_NUM_SEQS}"
      - "--enable-auto-tool-choice"
      - "--tool-call-parser"
      - "hermes"
VALUES

echo "+ rendered helm values:"
echo "  $VALUES_FILE"

run "$HELM" uninstall -n "$NAMESPACE" "$RELEASE_NAME" \
  || true
run "$HELM" install -n "$NAMESPACE" "$RELEASE_NAME" "$CHART_FULL" \
  -f "$VALUES_FILE"
run "${KUBECTL_CMD[@]}" -n "$NAMESPACE" rollout status \
  "deploy/$RELEASE_NAME" --timeout=1800s
run "${KUBECTL_CMD[@]}" -n "$NAMESPACE" get deploy,pod,svc,pvc

cat <<EOF

[setup-system-b-vllm-local] done.
Verify with:
  ./scripts/check-system-b-vllm.sh
Reachable from System A as:
  http://<system-b-node-ip>:${NODE_PORT}/v1
Wire that URL into k8s/system-a/litellm.yaml as SYSTEM_B_VLLM_ENDPOINT.
EOF
