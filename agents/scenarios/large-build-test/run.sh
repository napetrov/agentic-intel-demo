#!/usr/bin/env bash
# Demo scenario: large-build-test
# Invoked by the offload-worker via task_type=shell. Output budget ~3.5 KB.
#
# Set DEMO_QUIET=1 (or pass payload.quiet=true to /api/offload) to suppress the
# [scenario]/[step] narration so the transcript shows only the routing /
# shard / result lines.
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/build-task.md"

narrate "[scenario] large-build-test"
narrate "[step 1/5] inspect heavy-profile brief"
if [ -f "$TASK_BRIEF" ]; then
  echo "--- $(basename "$TASK_BRIEF") (first 6 lines) ---"
  sed -n '1,6p' "$TASK_BRIEF"
else
  echo "task-brief: not found at $TASK_BRIEF"
fi

narrate_blank
narrate "[step 2/5] reserve queue slot"
echo "primary lane: system-a"
echo "fallback lane: system-b"
echo "inference routes: SambaNova,SLM-on-GNR"

narrate_blank
narrate "[step 3/5] split build/test plan"
echo "+ compile lane: System A"
echo "+ test-shard offload: System B"

narrate_blank
narrate "[step 4/5] run shards (simulated)"
echo "shard 1/3 ok"
echo "shard 2/3 ok"
echo "shard 3/3 ok"

narrate_blank
narrate "[step 5/5] result fragment"
cat <<JSON
{"scenario":"large-build-test","route":"system-a+system-b","status":"ok","passed":128,"failed":0}
JSON
narrate_blank
narrate "Build/test complete. Primary on System A; offload path System B exercised."
