#!/usr/bin/env bash
# Bring up the full local demo without Docker.
#
# Why this exists: docker-compose up requires reachable container registries,
# and any sandbox / restricted network where quay.io and docker.io aren't
# reachable can't run that path. PyPI is usually still reachable — so we run
# the four runtimes (moto S3, agent-stub, offload-worker, control-plane) and
# a tiny FastAPI proxy that mimics web-demo/nginx.conf, all directly out of
# a Python venv.
#
# Layout:
#   moto_server          127.0.0.1:9000   (S3-compatible substitute for MinIO)
#   agent-stub           127.0.0.1:8001
#   offload-worker       127.0.0.1:8002
#   control-plane        127.0.0.1:8090
#   web-demo proxy       127.0.0.1:8080   (open this in a browser)
#
# State lives under .dev-up/ at the repo root: pids, logs, the venv.
# Tear down with scripts/dev-down.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${DEV_UP_STATE_DIR:-$REPO_ROOT/.dev-up}"
VENV_DIR="${DEV_UP_VENV_DIR:-$STATE_DIR/venv}"
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/pids"

PYTHON_BIN="${PYTHON_BIN:-python3}"

MOTO_PORT="${MOTO_PORT:-9000}"
AGENT_STUB_PORT="${AGENT_STUB_PORT:-8001}"
OFFLOAD_WORKER_PORT="${OFFLOAD_WORKER_PORT:-8002}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-8090}"
WEB_DEMO_PORT="${WEB_DEMO_PORT:-8080}"

# Demo creds. Match the docker-compose defaults so artifacts written here are
# readable by the same boto3 config as the compose path.
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minio}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minio-dummy-secret-1234}"
MINIO_BUCKET="${MINIO_BUCKET:-demo-artifacts}"

mkdir -p "$STATE_DIR" "$LOG_DIR" "$PID_DIR"

log() { printf '[dev-up] %s\n' "$*"; }
warn() { printf '[dev-up] %s\n' "$*" >&2; }

# --- venv & deps ----------------------------------------------------------

if [ ! -x "$VENV_DIR/bin/python" ]; then
  log "creating venv at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --quiet --upgrade pip
fi

# Reuse the runtime requirements files so versions match the docker-compose
# images. moto[server] is dev-only (S3-compatible substitute for MinIO).
log "installing python deps"
"$VENV_DIR/bin/pip" install --quiet \
  -r "$REPO_ROOT/runtimes/agent-stub/requirements.txt" \
  -r "$REPO_ROOT/runtimes/control-plane/requirements.txt" \
  -r "$REPO_ROOT/runtimes/offload-worker/requirements.txt" \
  'moto[server]==5.1.4'

# --- helpers --------------------------------------------------------------

PY="$VENV_DIR/bin/python"
UVICORN="$VENV_DIR/bin/uvicorn"
MOTO="$VENV_DIR/bin/moto_server"

start_bg() {
  # start_bg <name> <log-file> <pid-file> -- <argv...>
  local name="$1" logf="$2" pidf="$3"; shift 3
  if [ "$1" = "--" ]; then shift; fi
  if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then
    warn "$name already running (pid $(cat "$pidf")); skipping"
    return 0
  fi
  log "starting $name -> $logf"
  ( "$@" >"$logf" 2>&1 & echo $! >"$pidf" )
  sleep 1
  if ! kill -0 "$(cat "$pidf")" 2>/dev/null; then
    warn "$name failed to start; tail of log:"
    tail -n 20 "$logf" >&2 || true
    return 1
  fi
}

wait_http_ok() {
  # wait_http_ok <url> <retries> <label>
  local url="$1" retries="$2" label="$3"
  local i
  for i in $(seq 1 "$retries"); do
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      log "$label ready ($url)"
      return 0
    fi
    sleep 1
  done
  warn "$label not ready after ${retries}s ($url)"
  return 1
}

# --- moto (S3) ------------------------------------------------------------

start_bg "moto-server" "$LOG_DIR/moto.log" "$PID_DIR/moto.pid" -- \
  "$MOTO" -H 127.0.0.1 -p "$MOTO_PORT"

wait_http_ok "http://127.0.0.1:$MOTO_PORT/" 30 "moto"

log "creating bucket $MINIO_BUCKET"
"$PY" - <<PY
import boto3
from botocore.exceptions import ClientError
s3 = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:$MOTO_PORT",
    aws_access_key_id="$MINIO_ROOT_USER",
    aws_secret_access_key="$MINIO_ROOT_PASSWORD",
    region_name="us-east-1",
)
try:
    s3.create_bucket(Bucket="$MINIO_BUCKET")
except ClientError as exc:
    code = exc.response.get("Error", {}).get("Code", "")
    if code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
        raise
PY

# --- agent-stub -----------------------------------------------------------

(
  cd "$REPO_ROOT/runtimes/agent-stub"
  AGENT_WORKSPACE_DIR="$REPO_ROOT/demo-workspace" \
    nohup "$UVICORN" app:app --host 127.0.0.1 --port "$AGENT_STUB_PORT" \
    >"$LOG_DIR/agent-stub.log" 2>&1 &
  echo $! >"$PID_DIR/agent-stub.pid"
)
wait_http_ok "http://127.0.0.1:$AGENT_STUB_PORT/health" 20 "agent-stub"

# --- offload-worker -------------------------------------------------------

(
  cd "$REPO_ROOT/runtimes/offload-worker"
  MINIO_ENDPOINT="http://127.0.0.1:$MOTO_PORT" \
    MINIO_ACCESS_KEY="$MINIO_ROOT_USER" \
    MINIO_SECRET_KEY="$MINIO_ROOT_PASSWORD" \
    MINIO_BUCKET="$MINIO_BUCKET" \
    SCENARIO_SCRIPTS_DIR="$REPO_ROOT/agents/scenarios" \
    OPENCLAW_GATEWAY_URL="http://127.0.0.1:$AGENT_STUB_PORT" \
    OPENCLAW_GATEWAY_TOKEN="" \
    DEBUG_TASK_ERRORS="${DEBUG_TASK_ERRORS:-1}" \
    nohup "$UVICORN" app:app --host 127.0.0.1 --port "$OFFLOAD_WORKER_PORT" \
    >"$LOG_DIR/offload-worker.log" 2>&1 &
  echo $! >"$PID_DIR/offload-worker.pid"
)
wait_http_ok "http://127.0.0.1:$OFFLOAD_WORKER_PORT/health" 20 "offload-worker"

# --- control-plane --------------------------------------------------------

(
  cd "$REPO_ROOT/runtimes/control-plane"
  OFFLOAD_WORKER_URL="http://127.0.0.1:$OFFLOAD_WORKER_PORT" \
    OFFLOAD_TIMEOUT_SECONDS=120 \
    MINIO_ENDPOINT="http://127.0.0.1:$MOTO_PORT" \
    MINIO_ACCESS_KEY="$MINIO_ROOT_USER" \
    MINIO_SECRET_KEY="$MINIO_ROOT_PASSWORD" \
    MINIO_BUCKET="$MINIO_BUCKET" \
    OPENCLAW_GATEWAY_URL="${OPENCLAW_GATEWAY_URL:-http://127.0.0.1:$AGENT_STUB_PORT}" \
    LITELLM_BASE_URL="${LITELLM_BASE_URL:-}" \
    SAMBANOVA_PROBE_URL="${SAMBANOVA_PROBE_URL:-}" \
    nohup "$UVICORN" app:app --host 127.0.0.1 --port "$CONTROL_PLANE_PORT" \
    >"$LOG_DIR/control-plane.log" 2>&1 &
  echo $! >"$PID_DIR/control-plane.pid"
)
wait_http_ok "http://127.0.0.1:$CONTROL_PLANE_PORT/ready" 20 "control-plane"

# --- web demo proxy -------------------------------------------------------

(
  cd "$REPO_ROOT/scripts"
  WEB_DEMO_DIR="$REPO_ROOT/web-demo" \
    CONTROL_PLANE_URL="http://127.0.0.1:$CONTROL_PLANE_PORT" \
    nohup "$UVICORN" dev_web_proxy:app --host 127.0.0.1 --port "$WEB_DEMO_PORT" \
    >"$LOG_DIR/web-demo.log" 2>&1 &
  echo $! >"$PID_DIR/web-demo.pid"
)
wait_http_ok "http://127.0.0.1:$WEB_DEMO_PORT/api/ready" 20 "web-demo proxy"

log ""
log "demo is up"
log "  open  http://127.0.0.1:$WEB_DEMO_PORT"
log "  logs  $LOG_DIR/"
log "  stop  scripts/dev-down.sh"
