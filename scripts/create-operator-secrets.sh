#!/usr/bin/env bash
# Create every Secret the demo expects, from environment variables.
#
# This script is the canonical materialization path for the secrets the
# operator-first demo depends on. It writes (idempotent kubectl apply):
#
#   1. intel-demo-operator-secrets   (default ns)   — referenced by
#      OpenClawInstance.spec.envFromSecrets in
#      examples/openclawinstance-intel-demo.yaml.
#   2. litellm-secrets               (inference ns) — referenced by
#      k8s/system-a/litellm.yaml via secretKeyRef.
#   3. session-pod-artifact-creds    (agents ns)    — referenced by the
#      session-pod-template ConfigMap (MinIO/S3 creds for the agent pod).
#   4. telegram-bot                  (agents ns)    — referenced by the
#      session-pod-template ConfigMap (TELEGRAM_BOT_TOKEN).
#   5. minio-creds                   (system-b ns)  — referenced by
#      k8s/system-b/minio.yaml and offload-worker.yaml via envFrom/secretKeyRef.
#
# Usage:
#   APPLY=1 \
#   TELEGRAM_BOT_TOKEN=... \
#   AWS_BEARER_TOKEN_BEDROCK=... \
#   SAMBANOVA_API_KEY=... \
#   MINIO_ACCESS_KEY=... \
#   MINIO_SECRET_KEY=... \
#     ./scripts/create-operator-secrets.sh
#
#   ./scripts/create-operator-secrets.sh         # dry-run, prints rendered manifests
#
# Two-cluster note: by default every Secret is created in the current
# kube context. For two-cluster deploys, run twice with KUBECTL=
# "kubectl --context system-a" / "kubectl --context system-b" — set
# SCOPE=system-a to skip the system-b-namespaced Secrets, SCOPE=system-b
# to only create the system-b ones, or SCOPE=all (default) for single-
# cluster bring-up.
set -euo pipefail

SECRET_NAME="${SECRET_NAME:-intel-demo-operator-secrets}"
SECRET_NAMESPACE="${SECRET_NAMESPACE:-default}"
LITELLM_SECRET_NAME="${LITELLM_SECRET_NAME:-litellm-secrets}"
LITELLM_SECRET_NAMESPACE="${LITELLM_SECRET_NAMESPACE:-inference}"
SESSION_POD_SECRET_NAME="${SESSION_POD_SECRET_NAME:-session-pod-artifact-creds}"
SESSION_POD_SECRET_NAMESPACE="${SESSION_POD_SECRET_NAMESPACE:-agents}"
TELEGRAM_SECRET_NAME="${TELEGRAM_SECRET_NAME:-telegram-bot}"
TELEGRAM_SECRET_NAMESPACE="${TELEGRAM_SECRET_NAMESPACE:-agents}"
MINIO_SECRET_NAME="${MINIO_SECRET_NAME:-minio-creds}"
MINIO_SECRET_NAMESPACE="${MINIO_SECRET_NAMESPACE:-system-b}"
SCOPE="${SCOPE:-all}"
APPLY="${APPLY:-0}"
# KUBECTL can be set to "kubectl --context system-a" for two-cluster deploys.
KUBECTL="${KUBECTL:-kubectl}"

case "$SCOPE" in
  all|system-a|system-b) ;;
  *) echo "[create-operator-secrets] unknown SCOPE=$SCOPE (use all|system-a|system-b)" >&2; exit 64 ;;
esac

REQUIRED_KEYS=(
  TELEGRAM_BOT_TOKEN
  AWS_BEARER_TOKEN_BEDROCK
  SAMBANOVA_API_KEY
  MINIO_ACCESS_KEY
  MINIO_SECRET_KEY
)

missing=()
for key in "${REQUIRED_KEYS[@]}"; do
  if [ -z "${!key:-}" ]; then
    missing+=("$key")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "[create-operator-secrets] missing required env vars:" >&2
  for key in "${missing[@]}"; do
    echo "  - $key" >&2
  done
  echo "" >&2
  echo "Set them in your shell, or export from a secrets manager, then re-run:" >&2
  echo "  APPLY=1 ./scripts/create-operator-secrets.sh" >&2
  exit 64
fi

# kubectl is required even in dry-run because the rendering uses
# `kubectl create secret --dry-run=client -o yaml`. Word-split KUBECTL
# in case the caller passed "kubectl --context X".
read -r -a KUBECTL_CMD <<<"$KUBECTL"
command -v "${KUBECTL_CMD[0]}" >/dev/null 2>&1 \
  || { echo "[create-operator-secrets] ${KUBECTL_CMD[0]} not found" >&2; exit 127; }

# render <name> <namespace> <key=value>...
render() {
  local name="$1" namespace="$2"; shift 2
  local args=()
  for kv in "$@"; do
    args+=("--from-literal=$kv")
  done
  "${KUBECTL_CMD[@]}" create secret generic "$name" \
    --namespace="$namespace" \
    "${args[@]}" \
    --dry-run=client \
    -o yaml
}

emit() {
  local label="$1" name="$2" namespace="$3"; shift 3
  if [ "$APPLY" = "1" ]; then
    render "$name" "$namespace" "$@" | "${KUBECTL_CMD[@]}" apply -f -
    echo "[create-operator-secrets] applied $label ($name in $namespace)"
  else
    echo "---"
    echo "# [$label] $name in $namespace"
    render "$name" "$namespace" "$@"
  fi
}

[ "$APPLY" = "1" ] || echo "[create-operator-secrets] dry-run (set APPLY=1 to actually apply):"

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; then
  emit "operator instance secrets" \
    "$SECRET_NAME" "$SECRET_NAMESPACE" \
    "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN" \
    "AWS_BEARER_TOKEN_BEDROCK=$AWS_BEARER_TOKEN_BEDROCK" \
    "SAMBANOVA_API_KEY=$SAMBANOVA_API_KEY" \
    "MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY" \
    "MINIO_SECRET_KEY=$MINIO_SECRET_KEY"

  emit "litellm secrets" \
    "$LITELLM_SECRET_NAME" "$LITELLM_SECRET_NAMESPACE" \
    "AWS_BEARER_TOKEN_BEDROCK=$AWS_BEARER_TOKEN_BEDROCK" \
    "SAMBANOVA_API_KEY=$SAMBANOVA_API_KEY"

  emit "session-pod artifact creds" \
    "$SESSION_POD_SECRET_NAME" "$SESSION_POD_SECRET_NAMESPACE" \
    "AWS_ACCESS_KEY_ID=$MINIO_ACCESS_KEY" \
    "AWS_SECRET_ACCESS_KEY=$MINIO_SECRET_KEY"

  emit "telegram bot token" \
    "$TELEGRAM_SECRET_NAME" "$TELEGRAM_SECRET_NAMESPACE" \
    "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
fi

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-b" ]; then
  emit "minio root creds" \
    "$MINIO_SECRET_NAME" "$MINIO_SECRET_NAMESPACE" \
    "MINIO_ROOT_USER=$MINIO_ACCESS_KEY" \
    "MINIO_ROOT_PASSWORD=$MINIO_SECRET_KEY"
fi
