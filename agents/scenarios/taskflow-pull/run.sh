#!/usr/bin/env bash
# Demo scenario: taskflow-pull
# Pulls one task from a TaskFlow API (or shipped fixture) and runs the bounded
# action declared on it. Reference: https://github.com/preethivenkatesh/taskflow-api
set -euo pipefail

SCENARIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib.sh
. "$SCENARIO_DIR/../_lib.sh"
TASK_BRIEF="$SCENARIO_DIR/task-brief.md"
FIXTURE="$SCENARIO_DIR/fixtures/tasks.json"
TMP_SOURCE="$(mktemp -t taskflow-source.XXXXXX.json)"
TMP_PICKED="$(mktemp -t taskflow-picked.XXXXXX.json)"
trap 'rm -f "$TMP_SOURCE" "$TMP_PICKED"' EXIT

narrate "[scenario] taskflow-pull"
narrate "Starting TaskFlow scenario pull"
narrate "Flow: 1. resolve source 2. fetch tasks 3. select by rules 4. execute action 5. validate 6. summarize"
narrate "Scenario contract: route=local_standard; system owner=System A; pull-only"

narrate_blank
narrate "[step 1/6] resolve TaskFlow source"
SOURCE_KIND="fixture"
SOURCE_REF="$FIXTURE"
if [ -n "${TASKFLOW_API_URL:-}" ]; then
  echo "+ curl -fsS --max-time 5 \"${TASKFLOW_API_URL%/}/tasks\""
  if curl -fsS --max-time 5 "${TASKFLOW_API_URL%/}/tasks" -o "$TMP_SOURCE" 2>/dev/null; then
    SOURCE_KIND="api"
    SOURCE_REF="${TASKFLOW_API_URL%/}/tasks"
  else
    echo "fallback: TASKFLOW_API_URL unreachable, using shipped fixture"
  fi
fi
if [ "$SOURCE_KIND" = "fixture" ]; then
  cp "$FIXTURE" "$TMP_SOURCE"
fi
echo "source_kind: $SOURCE_KIND"
echo "source_ref:  $SOURCE_REF"

narrate_blank
narrate "[step 2/6] inspect bounded task brief and fetch tasks"
echo "+ sed -n '1,12p' task-brief.md"
sed -n '1,12p' "$TASK_BRIEF"
echo "+ python3 count tasks"
python3 - "$TMP_SOURCE" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
tasks = doc.get("tasks") if isinstance(doc, dict) else doc
if not isinstance(tasks, list):
    raise SystemExit("source did not contain a tasks list")
print(f"task_count: {len(tasks)}")
PY

narrate_blank
narrate "[step 3/6] apply selection rules and pick a task"
python3 - "$TMP_SOURCE" "$TMP_PICKED" <<'PY'
import json, sys
from datetime import date
doc = json.load(open(sys.argv[1]))
tasks = doc.get("tasks") if isinstance(doc, dict) else doc
PRIO = {"high": 0, "medium": 1, "low": 2}
STATUS_RANK = {"overdue": 0, "open": 1}
def required(t):
    return all(k in t for k in ("id", "title", "priority", "status"))
def parse_due(t):
    try:
        return date.fromisoformat(t.get("due_date", "9999-12-31"))
    except Exception:
        return date(9999, 12, 31)
candidates = [t for t in tasks if required(t) and t.get("status") in STATUS_RANK]
if not candidates:
    raise SystemExit("no eligible task")
candidates.sort(key=lambda t: (
    STATUS_RANK[t["status"]],
    PRIO.get(t["priority"], 99),
    parse_due(t),
))
picked = candidates[0]
with open(sys.argv[2], "w") as fh:
    json.dump(picked, fh)
print("picked: {id} | {priority} | {status} | {due} | {title}".format(
    id=picked["id"], priority=picked["priority"], status=picked["status"],
    due=picked.get("due_date", "-"), title=picked["title"],
))
PY
PICKED_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$TMP_PICKED")"
PICKED_ACTION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("demo_action","audit"))' "$TMP_PICKED")"

narrate_blank
narrate "[step 4/6] render and execute the bounded action"
ARTIFACT="/tmp/taskflow-${PICKED_ID}.md"
echo "action: $PICKED_ACTION"
echo "artifact: $ARTIFACT"
python3 - "$TMP_PICKED" "$ARTIFACT" "$SOURCE_KIND" "$SOURCE_REF" <<'PY'
import json, sys
from pathlib import Path
task = json.load(open(sys.argv[1]))
out = Path(sys.argv[2])
src_kind = sys.argv[3]
src_ref = sys.argv[4]
action = task.get("demo_action", "audit")
header = [
    f"# TaskFlow demo artifact — task {task['id']}",
    "",
    f"- source_kind: {src_kind}",
    f"- source_ref:  {src_ref}",
    f"- action:      {action}",
    f"- title:       {task['title']}",
    f"- priority:    {task['priority']}",
    f"- status:      {task['status']}",
    f"- due_date:    {task.get('due_date','-')}",
    f"- assignee:    {task.get('assignee','-')}",
    "",
]
if action == "escalate":
    body = [
        "## Escalation notice",
        "",
        f"Task {task['id']} is {task['status']} with priority {task['priority']}.",
        f"Per business rules, escalating to assignee `{task.get('assignee','-')}`.",
        "Next action: notify owner and re-evaluate due date.",
    ]
elif action == "summarize":
    body = [
        "## Analyst summary",
        "",
        f"- objective: progress task {task['id']} ({task['title']})",
        f"- state:     {task['status']} / {task['priority']}",
        f"- evidence:  {task.get('comments_count', 0)} comments on record",
        "- blocker:   none reported",
        "- next step: schedule follow-up",
    ]
else:
    body = [
        "## Audit checklist",
        "",
        "- [x] task fetched from TaskFlow source",
        "- [x] selection rules applied",
        "- [x] bounded action rendered",
        f"- [ ] follow-up scheduled with `{task.get('assignee','-')}`",
    ]
out.write_text("\n".join(header + body) + "\n")
print(f"wrote {out}")
PY

narrate_blank
narrate "[step 5/6] validate artifact"
echo "+ test -s $ARTIFACT"
test -s "$ARTIFACT"
echo "+ grep -q \"task ${PICKED_ID}\" $ARTIFACT"
grep -q "task ${PICKED_ID}" "$ARTIFACT"
echo "+ tail -n 20 $ARTIFACT"
tail -n 20 "$ARTIFACT"

narrate_blank
narrate "[step 6/6] summarize evidence"
cat <<JSON
{"scenario":"taskflow-pull","route":"local_standard","system_owner":"System A","source_kind":"$SOURCE_KIND","source_ref":"$SOURCE_REF","task_id":$PICKED_ID,"action":"$PICKED_ACTION","status":"ok","artifact":"$ARTIFACT"}
JSON
