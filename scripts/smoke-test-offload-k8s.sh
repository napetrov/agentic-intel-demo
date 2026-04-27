#!/usr/bin/env bash
# Tier 2 offload roundtrip smoke test: System A control-plane → System B
# offload-worker → mounted scenario script.
#
# `tier1-scenario-slice` already proves the generic offload contract locally
# with docker compose. This script targets the live k8s clusters and checks
# the production demo chain, not only health probes:
#
#   1. port-forward the control-plane Service on System A
#   2. POST /offload with task_type=shell and scenario=terminal-agent
#   3. GET /offload/{job_id}
#   4. assert status=completed, exit_code=0, and stdout contains the
#      scenario marker emitted by /scenarios/terminal-agent/run.sh
#
# Read-only on the cluster (port-forward only); the selected scenario script
# decides whether to write artifacts.
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
#   SCENARIO                  (default: terminal-agent)
#   CONTROL_PLANE_API_PREFIX  (default: empty; set to /api when targeting web-demo)
#
# Exit codes:
#   0  live shell scenario completed with a verified marker
#   1  any step failed
set -uo pipefail

APPLY="${APPLY:-0}"
SYSTEM_A_KUBECTL="${SYSTEM_A_KUBECTL:-kubectl --context system-a}"
CONTROL_PLANE_NAMESPACE="${CONTROL_PLANE_NAMESPACE:-platform}"
CONTROL_PLANE_SVC="${CONTROL_PLANE_SVC:-control-plane-offload}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-8080}"
OFFLOAD_TIMEOUT_SECONDS="${OFFLOAD_TIMEOUT_SECONDS:-60}"
CONTROL_PLANE_API_PREFIX="${CONTROL_PLANE_API_PREFIX:-}"

read -r -a KC <<<"$SYSTEM_A_KUBECTL"

cat <<EOF
[smoke-test-offload-k8s] System A → System B offload roundtrip
  apply:           $APPLY (set APPLY=1 to actually port-forward + curl)
  system-a:        $SYSTEM_A_KUBECTL
  svc:             $CONTROL_PLANE_NAMESPACE/$CONTROL_PLANE_SVC:$CONTROL_PLANE_PORT
  timeout:         ${OFFLOAD_TIMEOUT_SECONDS}s
EOF

if [ "$APPLY" != "1" ]; then
  cat <<EOF

Dry-run: with APPLY=1 the live sequence is:
  1. port-forward the control-plane service on System A
  2. POST /offload with task_type=shell, scenario=${SCENARIO:-terminal-agent}
  3. GET /offload/{job_id}
  4. verify status=completed, exit_code=0, and stdout contains
     [scenario] ${SCENARIO:-terminal-agent}
EOF
  exit 0
fi

command -v "${KC[0]}" >/dev/null 2>&1 \
  || { echo "[smoke-test-offload-k8s] ${KC[0]} not on PATH" >&2; exit 127; }
command -v curl >/dev/null 2>&1 \
  || { echo "[smoke-test-offload-k8s] curl not on PATH" >&2; exit 127; }
command -v python3 >/dev/null 2>&1 \
  || { echo "[smoke-test-offload-k8s] python3 not on PATH (used to parse offload/artifacts JSON)" >&2; exit 127; }

cleanup_pid=""
cleanup() {
  if [ -n "$cleanup_pid" ]; then
    kill "$cleanup_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# wait_pf_http <pid> <url> [tries=20]
#   Probe a backgrounded port-forward without the `sleep 2 && curl`
#   race. Returns 0 only while $pid is alive AND the URL answers 2xx.
wait_pf_http() {
  local pid="$1" url="$2" tries="${3:-20}"
  local i=0
  while [ "$i" -lt "$tries" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i+1))
    sleep 0.5
  done
  return 1
}

if ! "${KC[@]}" -n "$CONTROL_PLANE_NAMESPACE" get svc "$CONTROL_PLANE_SVC" >/dev/null 2>&1; then
  echo "[smoke-test-offload-k8s] svc/$CONTROL_PLANE_SVC missing in ns/$CONTROL_PLANE_NAMESPACE" >&2
  echo "                         apply k8s/system-a/control-plane-offload.yaml first." >&2
  exit 1
fi

LOCAL_PORT="${LOCAL_PORT:-18091}"
"${KC[@]}" -n "$CONTROL_PLANE_NAMESPACE" port-forward "svc/$CONTROL_PLANE_SVC" \
  "$LOCAL_PORT:$CONTROL_PLANE_PORT" >/dev/null 2>&1 &
cleanup_pid="$!"
if ! wait_pf_http "$cleanup_pid" "http://127.0.0.1:$LOCAL_PORT${CONTROL_PLANE_API_PREFIX}/health"; then
  echo "[smoke-test-offload-k8s] port-forward to svc/$CONTROL_PLANE_SVC did not become ready" >&2
  echo "                         (process dead, port already bound, or /health unreachable)" >&2
  exit 1
fi

session_id="smoke-$(date +%s)-$$"
scenario="${SCENARIO:-terminal-agent}"
api_prefix="$CONTROL_PLANE_API_PREFIX"

payload="$(SCENARIO="$scenario" SESSION_ID="$session_id" python3 -c '
import json, os
print(json.dumps({
    "task_type": "shell",
    "payload": {
        "scenario": os.environ["SCENARIO"],
        "timeout_seconds": 60,
    },
    "session_id": os.environ["SESSION_ID"],
}))
')"

echo "[1/2] POST ${api_prefix}/offload (task_type=shell, scenario=$scenario, session_id=$session_id)"
response="$(curl -fsS --max-time "$OFFLOAD_TIMEOUT_SECONDS" \
              -H 'content-type: application/json' \
              -d "$payload" \
              "http://127.0.0.1:$LOCAL_PORT${api_prefix}/offload" 2>/dev/null || true)"
if [ -z "$response" ]; then
  echo "[smoke-test-offload-k8s] empty response from ${api_prefix}/offload" >&2
  exit 1
fi

job_id="$(RESPONSE="$response" python3 -c '
import json, os
obj = json.loads(os.environ.get("RESPONSE") or "{}")
print(obj.get("job_id", ""))
')"
status="$(RESPONSE="$response" python3 -c '
import json, os
obj = json.loads(os.environ.get("RESPONSE") or "{}")
print(obj.get("status", ""))
')"

if [ -z "$job_id" ] || [ "$status" != "completed" ]; then
  echo "[smoke-test-offload-k8s] /offload did not return completed job (status=$status, job_id=$job_id)" >&2
  printf '%s\n' "$response" >&2
  exit 1
fi

echo "[2/2] GET ${api_prefix}/offload/$job_id  (expect exit_code=0 and scenario marker)"
status_body="$(curl -fsS --max-time 10 "http://127.0.0.1:$LOCAL_PORT${api_prefix}/offload/$job_id" 2>/dev/null || true)"
ok=$(SCENARIO="$scenario" STATUS_BODY="$status_body" python3 -c '
import json, os, sys
try:
    obj = json.loads(os.environ.get("STATUS_BODY") or "{}")
except Exception:
    sys.exit(2)
result = obj.get("result") if isinstance(obj, dict) else None
if not isinstance(result, dict):
    print("no")
    sys.exit(0)
stdout = result.get("stdout") or ""
scenario = os.environ["SCENARIO"]
print("yes" if result.get("exit_code") == 0 and f"[scenario] {scenario}" in stdout else "no")
' || echo "no")
if [ "$ok" != "yes" ]; then
  echo "[smoke-test-offload-k8s] shell scenario did not complete with expected marker" >&2
  printf '%s\n' "$status_body" >&2
  exit 1
fi

echo
printf '%s\n' "$status_body" | python3 -c '
import json, os, sys
obj = json.load(sys.stdin)
res = obj.get("result") or {}
stdout = res.get("stdout", "")
print(stdout[:1200])
'
echo "[smoke-test-offload-k8s] live shell offload OK (System A control-plane → System B offload-worker → /scenarios/$scenario/run.sh)"
