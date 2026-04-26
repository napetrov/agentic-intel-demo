#!/usr/bin/env bash
# Tier 2 offload roundtrip smoke test: System A control-plane → System B
# offload-worker → MinIO artifact.
#
# `tier1-scenario-slice` already proves this path locally with docker
# compose. This script does the same against the live k8s clusters:
#
#   1. port-forward the control-plane Service on System A
#   2. POST /offload with task_type=echo
#   3. assert the response includes a result_ref (presigned MinIO URL)
#   4. download the artifact via /artifacts/{ref} (or directly from
#      the presigned URL) and verify the round-trip payload
#
# Read-only on the cluster (port-forward only); never writes to MinIO
# beyond what the worker itself writes for this single task.
#
# Usage:
#   APPLY=1 ./scripts/smoke-test-offload-k8s.sh
#
# Knobs:
#   SYSTEM_A_KUBECTL          (default: "kubectl --context system-a")
#   CONTROL_PLANE_NAMESPACE   (default: platform)
#   CONTROL_PLANE_SVC         (default: control-plane)
#   CONTROL_PLANE_PORT        (default: 8080)
#   OFFLOAD_TIMEOUT_SECONDS   (default: 60)
#
# Exit codes:
#   0  roundtrip succeeded with a verified payload
#   1  any step failed
set -uo pipefail

APPLY="${APPLY:-0}"
SYSTEM_A_KUBECTL="${SYSTEM_A_KUBECTL:-kubectl --context system-a}"
CONTROL_PLANE_NAMESPACE="${CONTROL_PLANE_NAMESPACE:-platform}"
CONTROL_PLANE_SVC="${CONTROL_PLANE_SVC:-control-plane-offload}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-8080}"
OFFLOAD_TIMEOUT_SECONDS="${OFFLOAD_TIMEOUT_SECONDS:-60}"

read -r -a KC <<<"$SYSTEM_A_KUBECTL"

cat <<EOF
[smoke-test-offload-k8s] System A → System B offload roundtrip
  apply:           $APPLY (set APPLY=1 to actually port-forward + curl)
  system-a:        $SYSTEM_A_KUBECTL
  svc:             $CONTROL_PLANE_NAMESPACE/$CONTROL_PLANE_SVC:$CONTROL_PLANE_PORT
  timeout:         ${OFFLOAD_TIMEOUT_SECONDS}s
EOF

if [ "$APPLY" != "1" ]; then
  cat <<'EOF'

Dry-run: with APPLY=1 the live sequence is:
  1. port-forward the control-plane service on System A
  2. POST /offload {task_type:"echo", payload:{hello:"world"}, session_id:"smoke-..."}
  3. expect HTTP 200 with status=completed and a non-empty result_ref
  4. fetch /artifacts/{result_ref} and confirm payload round-trips
EOF
  exit 0
fi

command -v "${KC[0]}" >/dev/null 2>&1 \
  || { echo "[smoke-test-offload-k8s] ${KC[0]} not on PATH" >&2; exit 127; }
command -v curl >/dev/null 2>&1 \
  || { echo "[smoke-test-offload-k8s] curl not on PATH" >&2; exit 127; }

cleanup_pid=""
cleanup() {
  if [ -n "$cleanup_pid" ]; then
    kill "$cleanup_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! "${KC[@]}" -n "$CONTROL_PLANE_NAMESPACE" get svc "$CONTROL_PLANE_SVC" >/dev/null 2>&1; then
  echo "[smoke-test-offload-k8s] svc/$CONTROL_PLANE_SVC missing in ns/$CONTROL_PLANE_NAMESPACE" >&2
  echo "                         apply k8s/system-a/control-plane-offload.yaml first." >&2
  exit 1
fi

LOCAL_PORT="${LOCAL_PORT:-18091}"
"${KC[@]}" -n "$CONTROL_PLANE_NAMESPACE" port-forward "svc/$CONTROL_PLANE_SVC" \
  "$LOCAL_PORT:$CONTROL_PLANE_PORT" >/dev/null 2>&1 &
cleanup_pid="$!"
sleep 2

session_id="smoke-$(date +%s)-$$"
payload="$(printf '{"task_type":"echo","payload":{"hello":"world","session":"%s"},"session_id":"%s"}' "$session_id" "$session_id")"

echo "[1/3] POST /offload (session_id=$session_id)"
response="$(curl -fsS --max-time "$OFFLOAD_TIMEOUT_SECONDS" \
              -H 'content-type: application/json' \
              -d "$payload" \
              "http://127.0.0.1:$LOCAL_PORT/offload" 2>/dev/null || true)"
if [ -z "$response" ]; then
  echo "[smoke-test-offload-k8s] empty response from /offload" >&2
  exit 1
fi

job_id="$(printf '%s' "$response" | python3 -c '
import json, sys
obj = json.loads(sys.stdin.read())
print(obj.get("job_id", ""))
')"
status="$(printf '%s' "$response" | python3 -c '
import json, sys
obj = json.loads(sys.stdin.read())
print(obj.get("status", ""))
')"

if [ -z "$job_id" ] || [ "$status" != "completed" ]; then
  echo "[smoke-test-offload-k8s] /offload did not return completed job (status=$status, job_id=$job_id)" >&2
  printf '%s\n' "$response" >&2
  exit 1
fi
echo "  [ok] job_id=$job_id status=$status"

echo "[2/3] GET /offload/$job_id"
status_body="$(curl -fsS --max-time 10 "http://127.0.0.1:$LOCAL_PORT/offload/$job_id" 2>/dev/null || true)"
result_ref="$(printf '%s' "$status_body" | python3 -c '
import json, sys
obj = json.loads(sys.stdin.read() or "{}")
print(obj.get("result_ref", ""))
')"
if [ -z "$result_ref" ]; then
  echo "[smoke-test-offload-k8s] no result_ref returned for job_id=$job_id" >&2
  printf '%s\n' "$status_body" >&2
  exit 1
fi
echo "  [ok] result_ref present"

echo "[3/3] GET /artifacts/$result_ref"
art_body="$(curl -fsS --max-time 15 "http://127.0.0.1:$LOCAL_PORT/artifacts/$result_ref" 2>/dev/null || true)"
if printf '%s' "$art_body" | grep -q "\"hello\".*\"world\""; then
  echo "  [ok] artifact contains the round-trip payload"
else
  echo "[smoke-test-offload-k8s] artifact body did not contain the expected payload" >&2
  printf '%s\n' "$art_body" >&2
  exit 1
fi

echo
echo "[smoke-test-offload-k8s] roundtrip OK (System A → System B → MinIO → System A)"
