#!/usr/bin/env bash
# Demo scenario: market-research
# Invoked by the offload-worker via task_type=shell. Output budget ~3.5 KB.
#
# Set DEMO_QUIET=1 (or pass payload.quiet=true to /api/offload) to suppress the
# [scenario]/[step] narration so the transcript shows only the synthetic source
# notes and the structured result fragment.
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/report-task.md"

narrate "[scenario] market-research"
narrate "[step 1/4] read research brief"
if [ -f "$TASK_BRIEF" ]; then
  echo "--- $(basename "$TASK_BRIEF") (first 6 lines) ---"
  sed -n '1,6p' "$TASK_BRIEF"
else
  echo "task-brief: not found at $TASK_BRIEF"
fi

narrate_blank
narrate "[step 2/4] gather synthetic source notes"
cat <<NOTES
[1] pricing pressure increasing
[2] competitor launch window shifted
[3] enterprise demand remains stable
[4] infra cost risk elevated
[5] integration story improving
NOTES

narrate_blank
narrate "[step 3/4] cluster + synthesize (offload to System B)"
echo "+ route: System B (GNR) for retrieval/synthesis"
echo "+ inference: LiteLLM -> SambaNova"
echo "clusters identified: 2"
echo "summary length: short"

narrate_blank
narrate "[step 4/4] result fragment"
cat <<JSON
{"scenario":"market-research","route":"system-b","status":"ok","clusters":2}
JSON
narrate_blank
narrate "Brief ready: top signals, risks, follow-up questions."
