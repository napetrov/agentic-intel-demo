#!/usr/bin/env bash
# Demo scenario: terminal-agent
#
# Implements the `repo-structure-audit-and-fixup` reference task against the
# scenario tree that's actually mounted into the worker. Every line in the
# audit artifact is derived from the live filesystem walk — no hardcoded
# verdicts — so the validation grep at the end is a real check, not a tautology.
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_ROOT="$(cd "$SCENARIO_DIR/.." && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/terminal-bench-reference.md"
ARTIFACT="/tmp/terminal-agent-scenario-audit.md"
INVENTORY="/tmp/terminal-agent-inventory.tsv"

narrate_header "terminal-agent" "Starting isolated engineering demo" "local_standard"

narrate_blank
narrate "[step 1/5] prepare isolated engineering workspace"
echo "+ pwd"
pwd
echo "+ uname -srm && id -un"
uname -srm
id -un

narrate_blank
narrate "[step 2/5] inspect the task brief"
echo "+ grep -nE '^### (Name|Objective)' terminal-bench-reference.md"
grep -nE '^### (Name|Objective)' "$TASK_BRIEF"
echo "+ sed -n '20,28p' terminal-bench-reference.md"
sed -n '20,28p' "$TASK_BRIEF"

narrate_blank
narrate "[step 3/5] walk the mounted scenario tree"
echo "+ find $SCENARIOS_ROOT -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort"
find "$SCENARIOS_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort

# Derive a per-scenario inventory: name, file count, run.sh line count,
# whether _lib.sh is sourced, whether a JSON result fragment is emitted, and
# the md5 of run.sh. Every column comes from real file inspection, so a
# tampered or stub scenario will show up directly in the artifact.
echo "+ python3 build inventory $INVENTORY"
python3 - "$SCENARIOS_ROOT" "$INVENTORY" <<'PY'
import hashlib
import re
import sys
from pathlib import Path

# Match an actual source statement (`.` or `source` at line start with
# optional whitespace) referencing _lib.sh — not the `# shellcheck
# source=../_lib.sh` directive that every scenario already carries as a
# comment, which would otherwise make a substring check tautological.
SOURCE_RE = re.compile(r"^\s*(?:\.|source)\s+\S*_lib\.sh", re.MULTILINE)

root = Path(sys.argv[1])
out = Path(sys.argv[2])
rows = ["name\tfiles\trun_sh_lines\tsources_lib\temits_json\trun_sh_md5"]
for entry in sorted(root.iterdir()):
    if not entry.is_dir():
        continue
    run_sh = entry / "run.sh"
    if not run_sh.exists():
        rows.append(f"{entry.name}\t{sum(1 for _ in entry.iterdir())}\tMISSING\tno\tno\t-")
        continue
    text = run_sh.read_text()
    line_count = text.count("\n")
    sources_lib = "yes" if SOURCE_RE.search(text) else "no"
    emits_json = "yes" if f'"scenario":"{entry.name}"' in text else "no"
    digest = hashlib.md5(text.encode()).hexdigest()[:12]
    file_count = sum(1 for _ in entry.rglob("*") if _.is_file())
    rows.append(
        f"{entry.name}\t{file_count}\t{line_count}\t{sources_lib}\t{emits_json}\t{digest}"
    )
out.write_text("\n".join(rows) + "\n")
print(f"wrote {out} ({len(rows) - 1} scenarios)")
PY
echo "+ cat $INVENTORY (tsv → aligned)"
python3 -c '
import sys
from pathlib import Path
rows = [r.split("\t") for r in Path(sys.argv[1]).read_text().splitlines() if r]
widths = [max(len(r[c]) for r in rows) for c in range(len(rows[0]))]
for r in rows:
    print("  ".join(c.ljust(w) for c, w in zip(r, widths)))
' "$INVENTORY"

narrate_blank
narrate "[step 4/5] derive audit artifact from inventory"
echo "+ python3 render audit $ARTIFACT"
python3 - "$INVENTORY" "$ARTIFACT" "$SCENARIOS_ROOT" <<'PY'
import sys
from pathlib import Path

inv_path = Path(sys.argv[1])
out = Path(sys.argv[2])
root = Path(sys.argv[3])

lines = inv_path.read_text().splitlines()
header, *rows = lines
parsed = []
for r in rows:
    cols = r.split("\t")
    parsed.append(dict(zip(header.split("\t"), cols)))

problems = []
for s in parsed:
    if s["run_sh_lines"] == "MISSING":
        problems.append(f"{s['name']}: run.sh missing")
        continue
    if s["sources_lib"] != "yes":
        problems.append(f"{s['name']}: run.sh does not source ../_lib.sh")
    if s["emits_json"] != "yes":
        problems.append(f"{s['name']}: run.sh does not emit a structured JSON result")

# Probe paths the reference task asks about. The worker only mounts the
# scenarios tree, so these will normally not be reachable — record that
# fact instead of fabricating a walk.
def probe(label, candidates):
    for c in candidates:
        if c.exists():
            files = sorted(p.name for p in c.iterdir())
            return label, str(c), files
    return label, None, None

repo_root = root.parent.parent
task_label, task_root, task_files = probe(
    "task families",
    [root.parent / "tasks", repo_root / "agents" / "tasks"],
)
config_label, config_root, config_files = probe(
    "config",
    [repo_root / "config", Path("/config")],
)

verdict = "PASS" if not problems else "FAIL"

doc = ["# Scenario audit — repo-structure-audit-and-fixup", ""]
doc.append(f"Scenarios root: {root}")
doc.append(f"Scenarios discovered: {len(parsed)}")
doc.append("")
doc.append("Guided scenarios found")
for s in parsed:
    doc.append(
        f"- {s['name']}: files={s['files']} run.sh_lines={s['run_sh_lines']} "
        f"lib={s['sources_lib']} json={s['emits_json']} md5={s['run_sh_md5']}"
    )
doc.append("")
doc.append("Reusable task families found")
if task_root:
    for f in task_files:
        doc.append(f"- {f} (under {task_root})")
else:
    doc.append("- not in scope at this mount: agents/tasks not reachable from worker")
doc.append("")
doc.append("Config files found")
if config_root:
    for f in config_files:
        doc.append(f"- {f} (under {config_root})")
else:
    doc.append("- not in scope at this mount: config/ not reachable from worker")
doc.append("")
doc.append("Mismatches or missing references")
if problems:
    for p in problems:
        doc.append(f"- {p}")
else:
    doc.append("- none — every scenario has run.sh, sources _lib.sh, and emits a JSON result")
doc.append("")
doc.append(f"Final summary: {verdict} — derived from {len(parsed)} scenarios in {root}.")

out.write_text("\n".join(doc) + "\n")
print(f"wrote {out}")
if verdict != "PASS":
    raise SystemExit(f"audit failed: {len(problems)} problem(s)")
PY

narrate_blank
narrate "[step 5/5] validate the result"
echo "+ test -s $ARTIFACT && grep -q 'Guided scenarios found' && grep -q 'Final summary: PASS'"
test -s "$ARTIFACT"
grep -q 'Guided scenarios found' "$ARTIFACT"
grep -q 'Final summary: PASS' "$ARTIFACT"
echo "+ tail -n 12 $ARTIFACT"
tail -n 12 "$ARTIFACT"

SCENARIO_COUNT=$(grep -c '^- .*: files=' "$ARTIFACT" || echo 0)
narrate_footer "terminal-agent: PASS · ${SCENARIO_COUNT} scenarios audited · artifact=$ARTIFACT"
cat <<JSON
{"scenario":"terminal-agent","route":"local_standard","system_owner":"System A","status":"ok","scenarios_audited":$SCENARIO_COUNT,"artifact":"$ARTIFACT","inventory":"$INVENTORY"}
JSON
