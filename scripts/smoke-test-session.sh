#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_A="${KUBECONFIG_A:-$HOME/.kube/system-a.yaml}"
SYSTEM_A_IP="${SYSTEM_A_IP:-127.0.0.1}"
SYSTEM_B_IP="${SYSTEM_B_IP:-}"
CONTROL_PLANE_TOKEN="${CONTROL_PLANE_TOKEN:-}"
TEST_USER_ID="${TEST_USER_ID:-smoke-user}"
TEST_AGENT_PROFILE="${TEST_AGENT_PROFILE:-default}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[smoke-test] $name is required" >&2
    exit 1
  fi
}

require_env SYSTEM_B_IP
require_env CONTROL_PLANE_TOKEN

echo "[smoke-test] checking LiteLLM"
curl -fsS "http://$SYSTEM_A_IP:31400/health/liveliness" >/dev/null

echo "[smoke-test] checking control-plane health"
curl -fsS "http://$SYSTEM_A_IP:31000/health" >/dev/null

echo "[smoke-test] checking System B ollama reachability"
curl -fsS "http://$SYSTEM_B_IP:30434/api/tags" | grep -q 'qwen2.5:7b-instruct'

echo "[smoke-test] checking System B minio reachability"
curl -fsS "http://$SYSTEM_B_IP:30900/minio/health/live" >/dev/null

echo "[smoke-test] checking session template and creds exist"
kubectl --kubeconfig "$KUBECONFIG_A" get configmap session-pod-template -n agents >/dev/null
kubectl --kubeconfig "$KUBECONFIG_A" get secret session-pod-artifact-creds -n agents >/dev/null
kubectl --kubeconfig "$KUBECONFIG_A" get secret telegram-bot -n agents >/dev/null

echo "[smoke-test] creating session pod via control-plane"
create_response="$({
  curl -fsS -X POST \
    -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"user_id\":\"$TEST_USER_ID\",\"agent_profile\":\"$TEST_AGENT_PROFILE\"}" \
    "http://$SYSTEM_A_IP:31000/sessions"
} )"
session_id="$(printf '%s' "$create_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])')"
pod_name="session-$session_id"
cleanup() {
  curl -fsS -X DELETE \
    -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
    "http://$SYSTEM_A_IP:31000/sessions/$session_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[smoke-test] waiting for $pod_name to reach Running"
deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
while true; do
  phase="$(kubectl --kubeconfig "$KUBECONFIG_A" get pod "$pod_name" -n agents -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  if [ "$phase" = "Running" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "[smoke-test] pod did not reach Running in time" >&2
    kubectl --kubeconfig "$KUBECONFIG_A" describe pod "$pod_name" -n agents >&2 || true
    exit 1
  fi
  sleep 2
done

echo "[smoke-test] verifying control-plane GET /sessions/$session_id"
curl -fsS \
  -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
  "http://$SYSTEM_A_IP:31000/sessions/$session_id" | grep -q '"phase":"Running"'

echo "[smoke-test] deleting session pod via control-plane"
curl -fsS -X DELETE \
  -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
  "http://$SYSTEM_A_IP:31000/sessions/$session_id" >/dev/null

for _ in $(seq 1 30); do
  if ! kubectl --kubeconfig "$KUBECONFIG_A" get pod "$pod_name" -n agents >/dev/null 2>&1; then
    trap - EXIT
    echo "[smoke-test] done"
    exit 0
  fi
  sleep 2
done

echo "[smoke-test] pod still exists after delete" >&2
exit 1
