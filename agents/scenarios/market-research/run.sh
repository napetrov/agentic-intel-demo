#!/usr/bin/env bash
# Demo scenario: market-research
#
# System A frames the request and emits the final report; System B owns the
# analytics step. The aggregation uses pandas (groupby/pivot, weighted mean)
# against a TSV of signals, and the report's recommendation is derived from
# the computed ranking — change the TSV and the conclusion changes.
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/report-task.md"
INPUT_TSV="/tmp/market-notes.tsv"
RANKING_JSON="/tmp/market-ranking.json"
REPORT="/tmp/market-research-analyst-note.md"

narrate "[scenario] market-research"
narrate "Starting market research demo"
narrate "Flow: 1. frame the question 2. prepare structured analysis inputs 3. offload analysis to System B 4. collect findings 5. return a concise report"
narrate "Scenario contract: route=offload_system_b; System A owns interaction/routing/result delivery; System B owns analytics execution"

narrate_blank
narrate "[step 1/5] frame the question"
echo "+ sed -n '1,12p' report-task.md"
sed -n '1,12p' "$TASK_BRIEF"
echo "question: Which SMB segment should be targeted first for an AI meeting-notes product?"
echo "dimensions: budget urgency, integration fit, pricing pressure, workflow pain, data sensitivity"

narrate_blank
narrate "[step 2/5] prepare structured analysis inputs"
cat > "$INPUT_TSV" <<'DATA'
segment	signal	score	weight
sales-led SMB	budget urgency	8	1.0
sales-led SMB	integration fit	7	1.0
sales-led SMB	workflow pain	6	0.8
sales-led SMB	data sensitivity	4	0.6
agency SMB	pricing pressure	5	1.0
agency SMB	integration fit	6	0.8
agency SMB	workflow pain	5	0.8
agency SMB	data sensitivity	3	0.6
professional services	workflow pain	8	1.0
professional services	budget urgency	6	0.8
professional services	integration fit	7	1.0
professional services	data sensitivity	6	0.6
healthcare SMB	workflow pain	7	1.0
healthcare SMB	data sensitivity	9	1.0
healthcare SMB	integration fit	4	0.8
healthcare SMB	budget urgency	5	0.6
DATA
echo "+ wc -l $INPUT_TSV"
wc -l "$INPUT_TSV"

narrate_blank
narrate "[step 3/5] offload analysis to System B"
echo "+ python3 (pandas) groupby + weighted-mean ranking → $RANKING_JSON"
python3 - "$INPUT_TSV" "$RANKING_JSON" <<'PY'
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

src = Path(sys.argv[1])
out = Path(sys.argv[2])

df = pd.read_csv(src, sep="\t")
# Penalize the data-sensitivity signal: high values flag risk, not opportunity.
df["score_signed"] = np.where(
    df["signal"] == "data sensitivity",
    10 - df["score"],
    df["score"],
)
df["weighted_contribution"] = df["score_signed"] * df["weight"]

# True weighted mean: sum(score_signed * weight) / sum(weight). The previous
# version divided by row count, which biased segments with more rows even
# when their per-signal weights were lower.
agg = (
    df.groupby("segment")
      .agg(
          weighted_sum=("weighted_contribution", "sum"),
          total_weight=("weight", "sum"),
          evidence_points=("score", "size"),
      )
      .reset_index()
)
agg["weighted_mean"] = agg["weighted_sum"] / agg["total_weight"]

ranking = (
    agg[["segment", "weighted_mean", "evidence_points", "total_weight"]]
      .sort_values("weighted_mean", ascending=False, kind="mergesort")
      .reset_index(drop=True)
)

pivot = (
    df.pivot_table(index="segment", columns="signal", values="score", aggfunc="mean")
      .round(2)
      .fillna("-")
)

print("Per-segment ranking (System B output)")
print(ranking.round(3).to_string(index=False))

ranking["weighted_mean"] = ranking["weighted_mean"].round(3)
out.write_text(json.dumps({
    "ranking": ranking.to_dict(orient="records"),
    "pivot":   pivot.reset_index().to_dict(orient="records"),
}, indent=2))
PY
echo "+ test -s $RANKING_JSON"
test -s "$RANKING_JSON"

narrate_blank
narrate "[step 4/5] synthesize the analyst note"
echo "+ python3 render report from ranking → $REPORT"
python3 - "$RANKING_JSON" "$REPORT" <<'PY'
import json
import sys
from pathlib import Path

ranking = json.loads(Path(sys.argv[1]).read_text())["ranking"]
out = Path(sys.argv[2])

top = ranking[0]
runner_up = ranking[1]
last = ranking[-1]

doc = [
    "# Compact analyst note",
    "",
    "## Scope",
    "Pick the first SMB segment for an AI meeting-notes product.",
    "",
    "## Evaluation dimensions",
    "- budget urgency",
    "- integration fit",
    "- pricing pressure",
    "- workflow pain",
    "- data sensitivity (penalized: high score = risk, not opportunity)",
    "",
    "## Findings by segment",
]
for r in ranking:
    doc.append(
        f"- {r['segment']}: weighted_mean={r['weighted_mean']:.2f} "
        f"evidence={r['evidence_points']} weight_sum={r['total_weight']:.1f}"
    )

doc += [
    "",
    "## Synthesized conclusion",
    f"Lead segment: **{top['segment']}** (weighted mean {top['weighted_mean']:.2f}, "
    f"{top['evidence_points']} evidence points). Runner-up: "
    f"{runner_up['segment']} ({runner_up['weighted_mean']:.2f}). "
    f"Lowest fit: {last['segment']} ({last['weighted_mean']:.2f}).",
    "",
    "## Next recommended action",
    f"Run a 2-week pilot with {top['segment']} teams; prepare a "
    f"compliance-oriented follow-up brief for {runner_up['segment']} "
    "to capture the secondary opportunity.",
    "",
    "Why this route — System A framed the request and assembled this report; "
    "System B (pandas groupby + weighted-mean pivot) produced the ranking.",
]
out.write_text("\n".join(doc) + "\n")
print(f"wrote {out}")
print(f"top segment = {top['segment']}")
PY
echo "+ sed -n '/Synthesized conclusion/,$ p' $REPORT"
sed -n '/Synthesized conclusion/,$ p' "$REPORT"

narrate_blank
narrate "[step 5/5] return structured result"
TOP_SEGMENT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ranking"][0]["segment"])' "$RANKING_JSON")
SEGMENT_COUNT=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["ranking"]))' "$RANKING_JSON")
echo "+ test -s $REPORT"
test -s "$REPORT"
echo "+ grep -q 'Synthesized conclusion' $REPORT"
grep -q 'Synthesized conclusion' "$REPORT"
cat <<JSON
{"scenario":"market-research","route":"offload_system_b","system_a":"routing+delivery","system_b":"analytics aggregation","status":"ok","segments_ranked":$SEGMENT_COUNT,"top_segment":"$TOP_SEGMENT","report":"$REPORT","ranking":"$RANKING_JSON"}
JSON
