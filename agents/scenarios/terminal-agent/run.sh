#!/usr/bin/env bash
# Demo scenario: terminal-agent
#
# Invoked by the offload-worker via task_type=shell. Output is captured and
# returned to the caller as stdout; stderr is captured separately. Keep total
# stdout under ~3.5 KB so the result fits inline (the worker pushes anything
# over 4 KB to MinIO, which complicates the demo path).
#
# Set DEMO_QUIET=1 (or pass payload.quiet=true to /api/offload) to suppress the
# [scenario]/[step] narration lines so the transcript shows only real command
# output and the structured result fragment.
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/terminal-bench-reference.md"

narrate "[scenario] terminal-agent"
narrate "[step 1/5] inspect task brief"
if [ -f "$TASK_BRIEF" ]; then
  echo "--- $(basename "$TASK_BRIEF") (first 8 lines) ---"
  sed -n '1,8p' "$TASK_BRIEF"
else
  echo "task-brief: not found at $TASK_BRIEF"
fi

narrate_blank
narrate "[step 2/5] resolve scenario directory"
echo "scenario-dir: $SCENARIO_DIR"
ls -1 "$SCENARIO_DIR"

narrate_blank
narrate "[step 3/5] simulate engineering command batch"
echo "+ uname -srm"
uname -srm
echo "+ date -u +%FT%TZ"
date -u +%FT%TZ
echo "+ pwd"
pwd

narrate_blank
narrate "[step 4/5] emit structured result fragment"
cat <<JSON
{"scenario":"terminal-agent","route":"system-b","status":"ok"}
JSON

narrate_blank
narrate "[step 5/5] summary"
narrate "Terminal Agent execution complete on System B offload worker path."
narrate "Offload route: System A control-plane -> System B worker. Tools used: read, exec, summarize."
