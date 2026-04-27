#!/usr/bin/env bash
# Fan out N concurrent sessions against the control plane via /sessions/batch.
#
# Usage:
#   scripts/load-simulate.sh                      # 5 small terminal-agent sessions
#   scripts/load-simulate.sh -c 20                # 20 sessions
#   scripts/load-simulate.sh -s market-research -p medium -c 10
#   CONTROL_PLANE_URL=http://localhost:8090 scripts/load-simulate.sh
#
# Why this exists: the web UI's "Spawn N sessions" panel does the same
# thing, but a CLI is useful for two cases:
#   1. Demo recordings — you can show the system handling load from a
#      terminal split next to the web UI.
#   2. Soak testing — pair with a `watch -n 1 'curl /api/sessions | jq ...'`
#      loop to watch the kube backend's HPA react.
#
# The script is intentionally single-call: it submits one batch and prints
# the response. To produce sustained load, wrap it in a shell loop.

set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:8090}"
SCENARIO="terminal-agent"
PROFILE="small"
COUNT=5
TARGET_SYSTEM=""
WATCH=0
WATCH_INTERVAL=2

usage() {
  cat <<EOF
Usage: $0 [-s scenario] [-p profile] [-c count] [-t target] [-w] [-i interval]

Options:
  -s SCENARIO    Scenario name (default: terminal-agent)
  -p PROFILE     Pod profile: small | medium | large (default: small)
  -c COUNT       Sessions to spawn in this batch (default: 5)
  -t TARGET      Target system: system_a | system_b (default: scenario default)
  -w             After spawn, watch /sessions every -i seconds until all terminal
  -i SECONDS     Watch interval in seconds (default: 2)

Env:
  CONTROL_PLANE_URL  Base URL of the control plane (default: http://localhost:8090)
EOF
}

while getopts ":s:p:c:t:wi:h" opt; do
  case "$opt" in
    s) SCENARIO="$OPTARG" ;;
    p) PROFILE="$OPTARG" ;;
    c) COUNT="$OPTARG" ;;
    t) TARGET_SYSTEM="$OPTARG" ;;
    w) WATCH=1 ;;
    i) WATCH_INTERVAL="$OPTARG" ;;
    h) usage; exit 0 ;;
    \?) echo "unknown option -$OPTARG" >&2; usage; exit 2 ;;
    :)  echo "option -$OPTARG requires a value" >&2; usage; exit 2 ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "load-simulate.sh requires 'curl' on PATH" >&2
  exit 2
fi

# jq is optional for the one-shot path (the response is just printed),
# but watch mode needs to compute the pending count to know when to
# exit. Rather than reimplement JSON-parsing in shell, require jq
# explicitly when -w is used so the failure mode is loud instead of
# "the loop never terminates".
HAVE_JQ=0
if command -v jq >/dev/null 2>&1; then HAVE_JQ=1; fi
if [ "$WATCH" = 1 ] && [ "$HAVE_JQ" != 1 ]; then
  echo "load-simulate.sh: -w (watch mode) requires 'jq' on PATH" >&2
  exit 2
fi

# Only include target_system in the JSON when the operator passed -t.
# Omitting the key lets the server record null = "use scenario default",
# which is a different semantic from explicitly picking system_a.
if [ -n "$TARGET_SYSTEM" ]; then
  payload=$(printf '{"scenario":"%s","profile":"%s","count":%d,"target_system":"%s"}' \
    "$SCENARIO" "$PROFILE" "$COUNT" "$TARGET_SYSTEM")
else
  payload=$(printf '{"scenario":"%s","profile":"%s","count":%d}' "$SCENARIO" "$PROFILE" "$COUNT")
fi
echo "[load-simulate] POST $CONTROL_PLANE_URL/sessions/batch  body=$payload"

response=$(curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -d "$payload" \
  "$CONTROL_PLANE_URL/sessions/batch")

if [ "$HAVE_JQ" = 1 ]; then
  echo "$response" | jq '{backend, total, by_status, ids: [.sessions[].session_id]}'
else
  echo "$response"
fi

if [ "$WATCH" = 0 ]; then
  exit 0
fi

echo "[load-simulate] watching /sessions every ${WATCH_INTERVAL}s (Ctrl-C to stop)"
while true; do
  list=$(curl -fsS "$CONTROL_PLANE_URL/sessions" || true)
  if [ -z "$list" ]; then
    echo "[load-simulate] /sessions unreachable; retrying"
    sleep "$WATCH_INTERVAL"
    continue
  fi
  if [ "$HAVE_JQ" = 1 ]; then
    summary=$(printf '%s' "$list" | jq -c '{backend, total, by_status}')
    pending=$(printf '%s' "$list" | jq '[.sessions[] | select(.status=="Pending" or .status=="Running")] | length')
    printf '[%s] %s\n' "$(date +%H:%M:%S)" "$summary"
    if [ "$pending" -eq 0 ]; then
      echo "[load-simulate] all sessions terminal — exiting watch"
      exit 0
    fi
  else
    echo "$list"
  fi
  sleep "$WATCH_INTERVAL"
done
