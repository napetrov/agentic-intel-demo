#!/usr/bin/env bash
# Demo scenario: large-build-test
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/build-task.md"
LOG="/tmp/large-build-test.log"

narrate "[scenario] large-build-test"
narrate "Starting large build/test demo"
narrate "Flow: 1. inspect target repo/task 2. select large execution profile 3. run environment checks 4. execute build/test sequence 5. collect logs and summarize outcome"
narrate "Scenario contract: route=local_large; System A large-profile framing; no System B offload unless policy changes"
sleep 0.7

narrate_blank
narrate "[step 1/5] inspect target repo/task"
echo "+ sed -n '1,44p' build-task.md"
sed -n '1,44p' "$TASK_BRIEF"
echo "+ find scenario files"
find "$SCENARIO_DIR" -maxdepth 1 -type f -printf '%f\n' | sort
sleep 0.7

narrate_blank
narrate "[step 2/5] select large execution profile"
echo "profile: large"
echo "requested resources: 16 vCPU / 32Gi request, 32 vCPU / 64Gi limit"
echo "placement: System A large-profile session pod"
sleep 0.7

narrate_blank
narrate "[step 3/5] run environment checks"
{
  echo "+ uname -srm"
  uname -srm
  echo "+ bash --version | head -1"
  bash --version | head -1
  echo "+ python3 --version"
  python3 --version
} | tee "$LOG"
sleep 0.7

narrate_blank
narrate "[step 4/5] execute build/test sequence"
{
  echo "+ bash -n run.sh"
  bash -n "$SCENARIO_DIR/run.sh"
  echo "+ python3 compile-check for task metadata"
  python3 - <<'PY'
from pathlib import Path
brief = Path('build-task.md').read_text()
required = ['large execution profile', 'run preflight checks', 'run build and/or test commands', 'summarize outcome']
missing = [item for item in required if item not in brief]
if missing:
    raise SystemExit(f'missing required phrases: {missing}')
print('metadata checks passed: required build/test sections present')
PY
} | tee -a "$LOG"
sleep 0.7

narrate_blank
narrate "[step 5/5] collect logs and summarize outcome"
echo "+ grep -q 'metadata checks passed' $LOG"
grep -q 'metadata checks passed' "$LOG"
echo "build/test status: PASS"
echo "log: $LOG"
cat <<JSON
{"scenario":"large-build-test","route":"local_large","system_owner":"System A","profile":"large","status":"ok","log":"$LOG"}
JSON
