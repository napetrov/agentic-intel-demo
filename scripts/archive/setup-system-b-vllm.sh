#!/usr/bin/env bash
# ARCHIVED — historical SSH-into-`onedal-build` vLLM bring-up.
# The canonical replacement is scripts/setup-system-b-vllm-local.sh, which
# operates against the current kube context via kubectl/helm without SSH.
# This file is kept for reference only; do not use for new bring-ups.
set -euo pipefail

SYSTEM_B_HOST="${SYSTEM_B_HOST:-system-b}"
CHART_PATH="${CHART_PATH:-/home/ubuntu/Enterprise-Inference/core/helm-charts/vllm}"
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

# Local expansion of ${RELEASE_NAME}/${MODEL_ID}/${CPU}/etc. is intentional —
# they come from this caller's env, not the remote shell.
# shellcheck disable=SC2087
ssh -o BatchMode=yes "$SYSTEM_B_HOST" bash <<EOF
set -euo pipefail

cat > /tmp/${RELEASE_NAME}-values.yaml <<VALUES
LLM_MODEL_ID: ${MODEL_ID}
cpu: ${CPU}
memory: ${MEMORY}
tensor_parallel_size: "1"
pipeline_parallel_size: "1"
max_model_len: ${MAX_MODEL_LEN}
service:
  type: ${SERVICE_TYPE}
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
    [
      "--block-size",
      "128",
      "--dtype",
      "bfloat16",
      "--max-model-len",
      "${MAX_MODEL_LEN}",
      "--distributed_executor_backend",
      "mp",
      "--enable_chunked_prefill",
      "--enforce-eager",
      "--max-num-batched-tokens",
      "${MAX_BATCHED_TOKENS}",
      "--max-num-seqs",
      "${MAX_NUM_SEQS}"
    ]
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
      [
        "--block-size",
        "128",
        "--dtype",
        "bfloat16",
        "--max-model-len",
        "${MAX_MODEL_LEN}",
        "--distributed_executor_backend",
        "mp",
        "--enable_chunked_prefill",
        "--enforce-eager",
        "--max-num-batched-tokens",
        "${MAX_BATCHED_TOKENS}",
        "--max-num-seqs",
        "${MAX_NUM_SEQS}",
        "--enable-auto-tool-choice",
        "--tool-call-parser", "hermes"
      ]
VALUES

helm uninstall -n ${NAMESPACE} ${RELEASE_NAME} 2>/dev/null || true
helm install -n ${NAMESPACE} ${RELEASE_NAME} ${CHART_PATH} -f /tmp/${RELEASE_NAME}-values.yaml
kubectl -n ${NAMESPACE} rollout status deploy/${RELEASE_NAME} --timeout=1800s
kubectl -n ${NAMESPACE} get deploy,pod,svc,pvc
EOF
