#!/usr/bin/env bash
# Create the operator-managed instance Secret from environment variables.
#
# This is the canonical path for materializing
# k8s/shared/intel-demo-operator-secrets.yaml.template into a real Secret
# in the cluster. It is operator-first: the Secret is referenced by
# OpenClawInstance.spec.envFromSecrets in
# examples/openclawinstance-intel-demo.yaml.
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
#   ./scripts/create-operator-secrets.sh         # dry-run, prints rendered manifest
#
# Idempotent: uses `kubectl apply` so re-running updates the existing Secret.
set -euo pipefail

SECRET_NAME="${SECRET_NAME:-intel-demo-operator-secrets}"
SECRET_NAMESPACE="${SECRET_NAMESPACE:-default}"
APPLY="${APPLY:-0}"
KUBECTL="${KUBECTL:-kubectl}"

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
# `kubectl create secret --dry-run=client -o yaml`.
command -v "$KUBECTL" >/dev/null 2>&1 \
  || { echo "[create-operator-secrets] $KUBECTL not found" >&2; exit 127; }

# Build manifest via kubectl --dry-run so values are base64-encoded by kubectl
# rather than spliced into stringData on disk. The rendered manifest never
# touches the working tree.
render() {
  "$KUBECTL" create secret generic "$SECRET_NAME" \
    --namespace="$SECRET_NAMESPACE" \
    --from-literal=TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
    --from-literal=AWS_BEARER_TOKEN_BEDROCK="$AWS_BEARER_TOKEN_BEDROCK" \
    --from-literal=SAMBANOVA_API_KEY="$SAMBANOVA_API_KEY" \
    --from-literal=MINIO_ACCESS_KEY="$MINIO_ACCESS_KEY" \
    --from-literal=MINIO_SECRET_KEY="$MINIO_SECRET_KEY" \
    --dry-run=client \
    -o yaml
}

if [ "$APPLY" = "1" ]; then
  render | "$KUBECTL" apply -f -
  echo "[create-operator-secrets] applied $SECRET_NAME in namespace $SECRET_NAMESPACE"
else
  echo "[create-operator-secrets] dry-run (set APPLY=1 to actually apply):"
  render
fi
