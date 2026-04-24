#!/usr/bin/env bash
# Demo scenario: terminal-agent
#
# Invoked by the offload-worker via task_type=shell. Output is captured and
# returned to the caller as stdout; stderr is captured separately. Keep total
# stdout under ~3.5 KB so the result fits inline (the worker pushes anything
# over 4 KB to MinIO, which complicates the demo path).
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_BRIEF="$SCENARIO_DIR/terminal-bench-reference.md"

echo "[scenario] terminal-agent"
echo "[step 1/5] inspect task brief"
if [ -f "$TASK_BRIEF" ]; then
  echo "--- $(basename "$TASK_BRIEF") (first 8 lines) ---"
  sed -n '1,8p' "$TASK_BRIEF"
else
  echo "task-brief: not found at $TASK_BRIEF"
fi

echo
echo "[step 2/5] resolve scenario directory"
echo "scenario-dir: $SCENARIO_DIR"
ls -1 "$SCENARIO_DIR"

echo
echo "[step 3/5] simulate engineering command batch"
echo "+ uname -srm"
uname -srm
echo "+ date -u +%FT%TZ"
date -u +%FT%TZ
echo "+ pwd"
pwd

echo
echo "[step 4/5] emit structured result fragment"
cat <<JSON
{"scenario":"terminal-agent","route":"system-a","status":"ok"}
JSON

echo
echo "[step 5/5] summary"
echo "Terminal Agent execution complete on System A (CWF) primary path."
echo "Inference route: LiteLLM -> SambaNova. Tools used: read, exec, summarize."
