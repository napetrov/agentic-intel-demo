#!/usr/bin/env bash
set -euo pipefail

SYSTEM_A_IP="${SYSTEM_A_IP:-127.0.0.1}"
SYSTEM_B_IP="${SYSTEM_B_IP:-}"
SYSTEM_B_OLLAMA_ENDPOINT="${SYSTEM_B_OLLAMA_ENDPOINT:-http://$SYSTEM_B_IP:30434}"
SYSTEM_B_MINIO_ENDPOINT="${SYSTEM_B_MINIO_ENDPOINT:-http://$SYSTEM_B_IP:30900}"
KUBECONFIG_A="${KUBECONFIG_A:-$HOME/.kube/system-a.yaml}"
CONTROL_PLANE_TOKEN="${CONTROL_PLANE_TOKEN:-}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[setup-system-a] $name is required" >&2
    exit 1
  fi
}

require_env SYSTEM_B_IP
require_env CONTROL_PLANE_TOKEN
require_env MINIO_ACCESS_KEY
require_env MINIO_SECRET_KEY
require_env TELEGRAM_BOT_TOKEN

render() {
  local src="$1"
  local dst="$2"
  envsubst < "$src" > "$dst"
  if grep -q 'CHANGE_ME_' "$dst"; then
    echo "[setup-system-a] unresolved CHANGE_ME_ placeholder remains in $dst" >&2
    exit 1
  fi
}

export SYSTEM_B_OLLAMA_ENDPOINT SYSTEM_B_MINIO_ENDPOINT CONTROL_PLANE_TOKEN MINIO_ACCESS_KEY MINIO_SECRET_KEY TELEGRAM_BOT_TOKEN

echo "[setup-system-a] kubeconfig: $KUBECONFIG_A"
echo "[setup-system-a] using System A IP: $SYSTEM_A_IP"
echo "[setup-system-a] using System B IP: $SYSTEM_B_IP"

render "$REPO_ROOT/k8s/system-a/litellm.yaml" "$TMP_DIR/litellm.yaml"
render "$REPO_ROOT/k8s/system-a/control-plane.yaml" "$TMP_DIR/control-plane.yaml"
render "$REPO_ROOT/k8s/system-a/session-pod-template.yaml" "$TMP_DIR/session-pod-template.yaml"

kubectl --kubeconfig "$KUBECONFIG_A" apply -f "$REPO_ROOT/k8s/system-a/rbac.yaml"
kubectl --kubeconfig "$KUBECONFIG_A" apply -f "$TMP_DIR/litellm.yaml"
kubectl --kubeconfig "$KUBECONFIG_A" apply -f "$TMP_DIR/control-plane.yaml"
kubectl --kubeconfig "$KUBECONFIG_A" apply -f "$TMP_DIR/session-pod-template.yaml"

kubectl --kubeconfig "$KUBECONFIG_A" rollout status deploy/litellm -n inference --timeout=600s
kubectl --kubeconfig "$KUBECONFIG_A" rollout status deploy/control-plane -n platform --timeout=600s

echo "[setup-system-a] manifests applied"
echo "[setup-system-a] verify from reachable host:"
echo "  curl http://$SYSTEM_A_IP:31400/health/liveliness"
echo "  curl http://$SYSTEM_A_IP:31000/health"
echo "[setup-system-a] note: expected images in cluster: demo-session-pod:dev and demo-control-plane:dev"
