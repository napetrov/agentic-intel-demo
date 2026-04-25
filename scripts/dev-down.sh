#!/usr/bin/env bash
# Tear down processes started by scripts/dev-up.sh.
#
# Reads PIDs from .dev-up/pids/*.pid (or $DEV_UP_STATE_DIR/pids if overridden)
# and signals each with TERM, then KILL on stragglers. Removes pid files for
# processes that successfully exited.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${DEV_UP_STATE_DIR:-$REPO_ROOT/.dev-up}"
PID_DIR="$STATE_DIR/pids"

if [ ! -d "$PID_DIR" ]; then
  echo "[dev-down] nothing to do (no pid dir at $PID_DIR)"
  exit 0
fi

shopt -s nullglob
pidfiles=("$PID_DIR"/*.pid)
if [ ${#pidfiles[@]} -eq 0 ]; then
  echo "[dev-down] nothing to do (no pid files)"
  exit 0
fi

# First pass: TERM. Wait briefly for graceful shutdown.
for pf in "${pidfiles[@]}"; do
  pid="$(cat "$pf" 2>/dev/null || true)"
  name="$(basename "$pf" .pid)"
  if [ -z "$pid" ]; then
    rm -f "$pf"; continue
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "[dev-down] TERM $name (pid $pid)"
    kill -TERM "$pid" 2>/dev/null || true
  else
    rm -f "$pf"
  fi
done

# Give services up to ~5s to clean up before escalating.
for _ in 1 2 3 4 5; do
  alive=0
  for pf in "${pidfiles[@]}"; do
    pid="$(cat "$pf" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then alive=1; fi
  done
  [ "$alive" -eq 0 ] && break
  sleep 1
done

# Second pass: KILL anything still alive.
for pf in "${pidfiles[@]}"; do
  pid="$(cat "$pf" 2>/dev/null || true)"
  name="$(basename "$pf" .pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[dev-down] KILL $name (pid $pid)"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pf"
done

echo "[dev-down] stopped"
