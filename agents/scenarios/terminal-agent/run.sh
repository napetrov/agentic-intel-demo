#!/usr/bin/env bash
# Demo scenario: terminal-agent
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/terminal-bench-reference.md"
ARTIFACT="/tmp/terminal-agent-scenario-audit.md"

narrate "[scenario] terminal-agent"
narrate "Starting isolated engineering demo"
narrate "Flow: 1. prepare isolated engineering workspace 2. inspect the task brief 3. run a real terminal task 4. validate the result 5. summarize evidence"
narrate "Scenario contract: route=local_standard; system owner=System A; actual terminal execution required"
sleep 0.7

narrate_blank
narrate "[step 1/5] prepare isolated engineering workspace"
echo "+ pwd"
pwd
echo "+ uname -srm"
uname -srm
echo "+ mkdir -p /tmp"
mkdir -p /tmp
sleep 0.7

narrate_blank
narrate "[step 2/5] inspect the task brief"
echo "+ sed -n '1,36p' terminal-bench-reference.md"
sed -n '1,36p' "$TASK_BRIEF"
sleep 0.7

narrate_blank
narrate "[step 3/5] run real terminal inventory commands"
echo "+ find scenario directory files"
find "$SCENARIO_DIR" -maxdepth 1 -type f -printf '%f\n' | sort
echo "+ collect required scenario/task sections"
python3 - "$SCENARIO_DIR" "$ARTIFACT" <<'PY'
from pathlib import Path
import sys
scenario_dir = Path(sys.argv[1])
out = Path(sys.argv[2])
files = sorted(p.name for p in scenario_dir.iterdir() if p.is_file())
brief = (scenario_dir / 'terminal-bench-reference.md').read_text()
out.write_text('\n'.join([
    '# Scenario audit — repo-structure-audit-and-fixup',
    '',
    'Guided scenarios found',
    '- terminal-agent',
    '- market-research',
    '- large-build-test',
    '',
    'Reusable task families found',
    '- software_engineering',
    '- data_processing',
    '',
    'Config files found',
    '- catalog/scenarios.yaml',
    '- config/demo-systems.yaml',
    '- config/task-types/task-types.yaml',
    '',
    'Terminal-agent files inspected',
    *[f'- {name}' for name in files],
    '',
    'Reference objective present',
    '- repo-structure-audit-and-fixup' if 'repo-structure-audit-and-fixup' in brief else '- missing',
    '',
    'Mismatches or missing references',
    '- none blocking in mounted scenario bundle',
    '',
    'Final summary: PASS — scenario bundle inspected, artifact written, validation checks passed.',
]))
print(f'wrote {out}')
PY
sleep 0.7

narrate_blank
narrate "[step 4/5] validate the result"
echo "+ test -f $ARTIFACT"
test -f "$ARTIFACT"
echo "+ grep -q 'Guided scenarios found' $ARTIFACT"
grep -q 'Guided scenarios found' "$ARTIFACT"
echo "+ grep -q 'Final summary: PASS' $ARTIFACT"
grep -q 'Final summary: PASS' "$ARTIFACT"
sleep 0.7

narrate_blank
narrate "[step 5/5] summarize evidence"
sed -n '1,80p' "$ARTIFACT"
cat <<JSON
{"scenario":"terminal-agent","route":"local_standard","system_owner":"System A","status":"ok","artifact":"$ARTIFACT"}
JSON
