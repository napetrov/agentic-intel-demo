#!/usr/bin/env bash
# Demo scenario: large-build-test
#
# Materializes a small Python data-pipeline project under /tmp, then runs a
# real build/test sequence against it: py_compile across every module, the
# stdlib unittest runner against the project's test package, and a sklearn
# model build + holdout validation. Every step prints the actual command
# transcript and exits non-zero on real failure, so the result panel reflects
# work that was performed rather than narrated.
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/build-task.md"
PROJECT_DIR="/tmp/large-build-demo"
LOG="/tmp/large-build-test.log"
MODEL_PATH="/tmp/large-build-demo-model.pkl"

: > "$LOG"
rm -rf "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/pipeline" "$PROJECT_DIR/tests"

narrate_header "large-build-test" "Starting large build/test demo" "local_large"

narrate_blank
narrate "[step 1/6] inspect target repo/task"
echo "+ pwd"
pwd
echo "+ sed -n '1,12p' build-task.md"
sed -n '1,12p' "$TASK_BRIEF"
echo "+ ls -1 ."
ls -1 .

narrate_blank
narrate "[step 2/6] select large execution profile"
echo "profile: large"
echo "requested resources: 16 vCPU / 32Gi request, 32 vCPU / 64Gi limit"
echo "placement: System A large-profile session pod"
echo "rationale: build+test workload exceeds the standard session-pod budget"

narrate_blank
narrate "[step 3/6] run environment checks"
{
  echo "+ uname -srm"
  uname -srm
  echo "+ bash --version | head -1"
  bash --version | head -1
  echo "+ python3 --version"
  python3 --version
  echo "+ python3 -c 'import sys, sklearn, numpy, pandas; print(...)'"
  python3 -c 'import sys, sklearn, numpy, pandas; print(f"python={sys.version.split()[0]} sklearn={sklearn.__version__} numpy={numpy.__version__} pandas={pandas.__version__}")'
} | tee -a "$LOG"

narrate_blank
narrate "[step 4/6] materialize project under $PROJECT_DIR"
cat > "$PROJECT_DIR/pipeline/__init__.py" <<'PY'
from .features import FeatureBuilder
from .scoring import score_segments
PY

cat > "$PROJECT_DIR/pipeline/features.py" <<'PY'
"""Tiny deterministic feature builder used by the demo build/test."""
from dataclasses import dataclass
from statistics import mean


@dataclass(frozen=True)
class Row:
    segment: str
    signal: str
    score: int


class FeatureBuilder:
    def __init__(self, rows):
        if not rows:
            raise ValueError("rows must be non-empty")
        self._rows = [Row(**r) if isinstance(r, dict) else r for r in rows]

    def segments(self):
        return sorted({r.segment for r in self._rows})

    def mean_score(self, segment):
        scores = [r.score for r in self._rows if r.segment == segment]
        if not scores:
            raise KeyError(segment)
        return mean(scores)

    def evidence_count(self, segment):
        return sum(1 for r in self._rows if r.segment == segment)
PY

cat > "$PROJECT_DIR/pipeline/scoring.py" <<'PY'
"""Pure-python ranker on top of FeatureBuilder."""
from .features import FeatureBuilder


def score_segments(rows):
    fb = FeatureBuilder(rows)
    ranked = []
    for seg in fb.segments():
        ranked.append({
            "segment": seg,
            "mean_score": round(fb.mean_score(seg), 3),
            "evidence": fb.evidence_count(seg),
        })
    ranked.sort(key=lambda r: (-r["mean_score"], -r["evidence"], r["segment"]))
    return ranked
PY

cat > "$PROJECT_DIR/tests/__init__.py" <<'PY'
PY

cat > "$PROJECT_DIR/tests/test_features.py" <<'PY'
import unittest
from pipeline.features import FeatureBuilder


class FeatureBuilderTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"segment": "a", "signal": "x", "score": 4},
            {"segment": "a", "signal": "y", "score": 6},
            {"segment": "b", "signal": "x", "score": 9},
        ]

    def test_segments_sorted(self):
        self.assertEqual(FeatureBuilder(self.rows).segments(), ["a", "b"])

    def test_mean_score(self):
        self.assertAlmostEqual(FeatureBuilder(self.rows).mean_score("a"), 5.0)

    def test_evidence_count(self):
        self.assertEqual(FeatureBuilder(self.rows).evidence_count("a"), 2)

    def test_unknown_segment_raises(self):
        with self.assertRaises(KeyError):
            FeatureBuilder(self.rows).mean_score("missing")

    def test_empty_rows_rejected(self):
        with self.assertRaises(ValueError):
            FeatureBuilder([])
PY

cat > "$PROJECT_DIR/tests/test_scoring.py" <<'PY'
import unittest
from pipeline.scoring import score_segments


class ScoreSegmentsTests(unittest.TestCase):
    def test_ranking_stable_and_descending(self):
        rows = [
            {"segment": "low", "signal": "s", "score": 2},
            {"segment": "low", "signal": "s", "score": 4},
            {"segment": "high", "signal": "s", "score": 9},
            {"segment": "high", "signal": "s", "score": 7},
        ]
        ranked = score_segments(rows)
        self.assertEqual([r["segment"] for r in ranked], ["high", "low"])
        self.assertGreater(ranked[0]["mean_score"], ranked[1]["mean_score"])
        self.assertEqual(ranked[0]["evidence"], 2)
PY

echo "+ find $PROJECT_DIR -name '*.py' -printf '%P  %s bytes\n' | sort"
find "$PROJECT_DIR" -name '*.py' -printf '%P  %s bytes\n' | sort

narrate_blank
narrate "[step 5/6] build and test"
{
  echo "+ python3 -m compileall -q $PROJECT_DIR"
  python3 -m compileall -q "$PROJECT_DIR"
  echo "compile: ok"
} | tee -a "$LOG"

# Real unittest run. `python3 -m unittest` writes its summary to stderr; we
# redirect to stdout so the demo log captures it. A failing test will exit
# non-zero and `set -e` will fail the scenario, which is exactly what the
# build-task.md requires ("name the failing step precisely").
{
  echo "+ python3 -m unittest discover -s tests -t . (cwd=$PROJECT_DIR)"
  TEST_START=$(date +%s%N)
  ( cd "$PROJECT_DIR" && python3 -m unittest discover -s tests -t . ) 2>&1
  TEST_END=$(date +%s%N)
  echo "test wall-clock: $(( (TEST_END - TEST_START) / 1000000 )) ms"
} | tee -a "$LOG"

# Real sklearn build: train, persist, reload, validate accuracy on a holdout.
{
  echo "+ python3 -c 'train+validate sklearn classifier'"
  python3 - "$MODEL_PATH" <<'PY'
import json, pickle, sys, time
import numpy as np
from sklearn.datasets import make_classification
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

model_path = sys.argv[1]
X, y = make_classification(
    n_samples=2000,
    n_features=20,
    n_informative=14,
    n_redundant=2,
    n_repeated=0,
    class_sep=1.6,
    random_state=42,
)
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=42)

t0 = time.perf_counter()
clf = LogisticRegression(max_iter=400).fit(X_tr, y_tr)
train_ms = (time.perf_counter() - t0) * 1000

with open(model_path, "wb") as fh:
    pickle.dump(clf, fh)
with open(model_path, "rb") as fh:
    reloaded = pickle.load(fh)
acc = accuracy_score(y_te, reloaded.predict(X_te))

print(json.dumps({
    "samples_train": int(len(y_tr)),
    "samples_holdout": int(len(y_te)),
    "train_ms": round(train_ms, 1),
    "holdout_accuracy": round(float(acc), 4),
    "model_path": model_path,
}))
if acc < 0.80:
    raise SystemExit(f"holdout accuracy below threshold: {acc:.4f}")
PY
} | tee -a "$LOG"

narrate_blank
narrate "[step 6/6] collect logs and summarize outcome"
echo "+ test -s $MODEL_PATH && stat -c '%s bytes' $MODEL_PATH"
test -s "$MODEL_PATH"
MODEL_BYTES=$(stat -c '%s' "$MODEL_PATH")
echo "model size: $MODEL_BYTES bytes"
TESTS_RUN=$(grep -oE 'Ran [0-9]+ tests' "$LOG" | tail -1 | awk '{print $2}')
VERDICT=$(grep -E '^(OK|FAILED)' "$LOG" | tail -1 || echo "missing")
HOLDOUT=$(grep -oE '"holdout_accuracy": [0-9.]+' "$LOG" | tail -1 | awk -F': ' '{print $2}')
echo "unittest verdict: $VERDICT (tests_run=$TESTS_RUN)"
echo "build/test status: PASS"
echo "log: $LOG"
TESTS_RUN=${TESTS_RUN:-0}
narrate_footer "large-build-test: PASS · tests=$TESTS_RUN · verdict=$VERDICT · model_bytes=$MODEL_BYTES"
cat <<JSON
{"scenario":"large-build-test","route":"local_large","system_owner":"System A","profile":"large","status":"ok","tests_run":$TESTS_RUN,"verdict":"$VERDICT","holdout_accuracy":${HOLDOUT:-null},"model_bytes":$MODEL_BYTES,"log":"$LOG"}
JSON
