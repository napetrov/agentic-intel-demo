#!/usr/bin/env bash
# Demo scenario: market-research
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/report-task.md"
REPORT="/tmp/market-research-analyst-note.md"

narrate "[scenario] market-research"
narrate "Starting market research demo"
narrate "Flow: 1. frame the question 2. prepare structured analysis inputs 3. offload analysis to System B 4. collect findings 5. return a concise report"
narrate "Scenario contract: route=offload_system_b; System A owns interaction/routing/result delivery; System B owns analytics execution"
sleep 0.7

narrate_blank
narrate "[step 1/5] frame the question"
echo "+ sed -n '1,44p' report-task.md"
sed -n '1,44p' "$TASK_BRIEF"
echo "question: Which SMB segment should be targeted first for an AI meeting-notes product?"
sleep 0.7

narrate_blank
narrate "[step 2/5] prepare structured analysis inputs"
cat > /tmp/market-notes.tsv <<'DATA'
segment	signal	score
sales-led SMB	budget urgency	8
sales-led SMB	integration fit	7
agency SMB	pricing pressure	5
professional services	workflow pain	8
professional services	data sensitivity	6
DATA
echo "+ cat /tmp/market-notes.tsv"
cat /tmp/market-notes.tsv
sleep 0.7

narrate_blank
narrate "[step 3/5] offload analysis to System B"
echo "+ python3 aggregate segment scores"
python3 - <<'PY'
import csv, statistics
from collections import defaultdict
rows=list(csv.DictReader(open('/tmp/market-notes.tsv'), delimiter='\t'))
by=defaultdict(list)
for r in rows:
    by[r['segment']].append(int(r['score']))
for seg, scores in sorted(by.items(), key=lambda kv: statistics.mean(kv[1]), reverse=True):
    print(f'{seg}: mean_score={statistics.mean(scores):.1f} evidence_points={len(scores)}')
PY
sleep 0.7

narrate_blank
narrate "[step 4/5] collect findings"
cat > "$REPORT" <<'REPORT'
# Compact analyst note

Objective: pick the first SMB segment for an AI meeting-notes product.

Approach: compare segments across urgency, integration fit, pricing pressure, workflow pain, and data-sensitivity risk. System A framed the request and result; System B performed the structured scoring aggregation.

Findings:
- Professional services: strongest workflow pain signal, but data-sensitivity objections require trust/compliance messaging.
- Sales-led SMB: strong budget urgency and integration fit; fastest path for a focused GTM pilot.
- Agency SMB: pricing pressure is higher, so defer unless packaging is simplified.

Evidence: structured notes scored 5 signals across 3 segments; top mean score was sales-led/professional-services tier depending on risk weighting.

Recommended next step: run a 2-week pilot with sales-led SMB teams, while preparing a compliance-oriented follow-up for professional services.
REPORT
sed -n '1,80p' "$REPORT"
sleep 0.7

narrate_blank
narrate "[step 5/5] return structured result"
cat <<JSON
{"scenario":"market-research","route":"offload_system_b","system_a":"routing+delivery","system_b":"analytics aggregation","status":"ok","report":"$REPORT"}
JSON
