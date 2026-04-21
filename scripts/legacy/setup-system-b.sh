#!/usr/bin/env bash
set -euo pipefail

SYSTEM_B_IP="${SYSTEM_B_IP:-}"
KUBECONFIG_B="${KUBECONFIG_B:-$HOME/.kube/system-b.yaml}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [ -z "$SYSTEM_B_IP" ]; then
  echo "[setup-system-b] SYSTEM_B_IP is required" >&2
  exit 1
fi
if [ -z "$MINIO_ROOT_USER" ] || [ -z "$MINIO_ROOT_PASSWORD" ]; then
  echo "[setup-system-b] MINIO_ROOT_USER and MINIO_ROOT_PASSWORD are required" >&2
  exit 1
fi

export MINIO_ROOT_USER MINIO_ROOT_PASSWORD
envsubst < "$REPO_ROOT/k8s/system-b/minio.yaml" > "$TMP_DIR/minio.yaml"

kubectl --kubeconfig "$KUBECONFIG_B" apply -f "$REPO_ROOT/k8s/system-b/ollama.yaml"
kubectl --kubeconfig "$KUBECONFIG_B" apply -f "$TMP_DIR/minio.yaml"

kubectl --kubeconfig "$KUBECONFIG_B" rollout status deploy/ollama -n system-b --timeout=600s
kubectl --kubeconfig "$KUBECONFIG_B" rollout status deploy/minio -n system-b --timeout=600s
kubectl --kubeconfig "$KUBECONFIG_B" exec -n system-b deploy/ollama -- ollama pull qwen2.5:7b-instruct

echo "[setup-system-b] services deployed"
echo "[setup-system-b] verify from reachable host:"
echo "  curl http://$SYSTEM_B_IP:30434/api/tags"
echo "  curl http://$SYSTEM_B_IP:30900/minio/health/live"
echo "[setup-system-b] creating bucket demo-artifacts"
"$REPO_ROOT/scripts/create-minio-bucket.sh"
