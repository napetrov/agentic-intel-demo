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
  2. POST /offload with a >4KB echo payload (forces MinIO storage)
  3. GET /offload/{job_id}; expect a non-empty result_ref
  4. GET /artifacts/{result_ref} → presigned URL → fetch URL → verify the
     marker round-trips through MinIO
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

# Build a payload large enough to force the offload-worker to store the
# result in MinIO instead of returning it inline. The worker's threshold
# is 4 KB on the JSON-encoded result (runtimes/offload-worker/app.py).
# A ~6 KB ASCII filler comfortably crosses that boundary regardless of
# JSON-encoding overhead, while staying small enough not to slow the
# smoke test.
filler="$(printf 'x%.0s' $(seq 1 6144))"
marker="smoke-marker-$session_id"
payload="$(python3 -c '
import json, os, sys
print(json.dumps({
    "task_type": "echo",
    "payload": {
        "marker": os.environ["MARKER"],
        "filler": os.environ["FILLER"],
        "session": os.environ["SESSION_ID"],
    },
    "session_id": os.environ["SESSION_ID"],
}))
' MARKER="$marker" FILLER="$filler" SESSION_ID="$session_id")"

echo "[1/4] POST /offload (session_id=$session_id, payload≈${#payload}B → forces MinIO storage)"
response="$(curl -fsS --max-time "$OFFLOAD_TIMEOUT_SECONDS" \
              -H 'content-type: application/json' \
              -d "$payload" \
              "http://127.0.0.1:$LOCAL_PORT/offload" 2>/dev/null || true)"
if [ -z "$response" ]; then
  echo "[smoke-test-offload-k8s] empty response from /offload" >&2
  exit 1
fi

job_id="$(RESPONSE="$response" python3 -c '
import json, os, sys
obj = json.loads(os.environ.get("RESPONSE") or "{}")
print(obj.get("job_id", ""))
')"
status="$(RESPONSE="$response" python3 -c '
import json, os, sys
obj = json.loads(os.environ.get("RESPONSE") or "{}")
print(obj.get("status", ""))
')"

if [ -z "$job_id" ] || [ "$status" != "completed" ]; then
  echo "[smoke-test-offload-k8s] /offload did not return completed job (status=$status, job_id=$job_id)" >&2
  printf '%s\n' "$response" >&2
  exit 1
fi
echo "  [ok] job_id=$job_id status=$status"

echo "[2/4] GET /offload/$job_id  (expect non-empty result_ref because payload >4KB)"
status_body="$(curl -fsS --max-time 10 "http://127.0.0.1:$LOCAL_PORT/offload/$job_id" 2>/dev/null || true)"
result_ref="$(STATUS_BODY="$status_body" python3 -c '
import json, os, sys
obj = json.loads(os.environ.get("STATUS_BODY") or "{}")
print(obj.get("result_ref") or "")
')"
if [ -z "$result_ref" ]; then
  echo "[smoke-test-offload-k8s] no result_ref returned for job_id=$job_id." >&2
  echo "                         The worker only stores results >4KB in MinIO; check that the test" >&2
  echo "                         payload size made it to System B intact." >&2
  printf '%s\n' "$status_body" >&2
  exit 1
fi
echo "  [ok] result_ref=$result_ref"

# /artifacts/{ref} on the control-plane returns ArtifactRef
# (ref/url/expires_in), not the artifact body. Parse the presigned URL
# out of that envelope, then GET the URL itself to read the actual
# JSON the offload-worker stored in MinIO.
echo "[3/4] GET /artifacts/$result_ref  (returns presigned URL)"
art_envelope="$(curl -fsS --max-time 15 "http://127.0.0.1:$LOCAL_PORT/artifacts/$result_ref" 2>/dev/null || true)"
presigned_url="$(ART_ENVELOPE="$art_envelope" python3 -c '
import json, os, sys
obj = json.loads(os.environ.get("ART_ENVELOPE") or "{}")
print(obj.get("url") or "")
')"
if [ -z "$presigned_url" ]; then
  echo "[smoke-test-offload-k8s] /artifacts response had no presigned url" >&2
  printf '%s\n' "$art_envelope" >&2
  exit 1
fi
echo "  [ok] presigned URL issued"

echo "[4/4] GET <presigned URL>  (fetches MinIO object)"
art_body="$(curl -fsS --max-time 30 "$presigned_url" 2>/dev/null || true)"
if [ -z "$art_body" ]; then
  echo "[smoke-test-offload-k8s] presigned URL returned empty body" >&2
  exit 1
fi

# Confirm the artifact actually carries OUR payload (not some other
# session's). The worker wraps echo input as {"echo": <payload>}, so
# our marker should appear inside that.
ok=$(MARKER="$marker" ART_BODY="$art_body" python3 -c '
import json, os, sys
try:
    obj = json.loads(os.environ.get("ART_BODY") or "{}")
except Exception:
    sys.exit(2)
echoed = obj.get("echo", {}) if isinstance(obj, dict) else {}
print("yes" if echoed.get("marker") == os.environ["MARKER"] else "no")
' || echo "no")
if [ "$ok" = "yes" ]; then
  echo "  [ok] artifact body contains our session marker"
else
  echo "[smoke-test-offload-k8s] artifact body did not contain marker=$marker" >&2
  printf '%s\n' "$art_body" >&2
  exit 1
fi

echo
echo "[smoke-test-offload-k8s] roundtrip OK (System A → System B → MinIO → System A)"
