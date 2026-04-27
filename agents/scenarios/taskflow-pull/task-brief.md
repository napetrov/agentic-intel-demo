# TaskFlow Pull — Bounded Task Brief

## Objective

Demonstrate the full pull-and-run loop end-to-end:
fetch a TaskFlow task -> select -> render -> execute -> validate -> summarize.

The agent never invents a task. The task always comes from a TaskFlow source
(live API or shipped fixture).

## Required step sequence

1. resolve source: read `TASKFLOW_API_URL`; if unset or unreachable, use
   `agents/scenarios/taskflow-pull/fixtures/tasks.json`
2. load the task list as JSON; report total count
3. apply selection rules from `flow.md` and announce the picked task in one
   line: `picked: <id> | <priority> | <status> | <due_date> | <title>`
4. render the bounded action for that task. The action is one of:
   - `audit`: write a Markdown audit artifact with task fields and a checklist
   - `escalate`: emit a structured "escalation notice" line referencing the
     overdue policy
   - `summarize`: produce a 5-line analyst-style summary
   The action is chosen from `task.demo_action` in the source JSON. If absent,
   default to `audit`.
5. write the artifact under `/tmp/taskflow-<id>.<ext>`
6. validate: at minimum `test -s` on the artifact and one `grep` on a known
   field (the task id)
7. emit a single-line JSON result fragment with `scenario`, `route`,
   `task_id`, `action`, `status`, `artifact`

## Preferred evidence

Use real commands such as:
- `python3 -c "import json,sys; ..."` to parse the source
- `curl -fsS` to hit the live API when `TASKFLOW_API_URL` is set
- `grep`, `test -s` for validation
- `cat` of the artifact tail (last 20 lines) before the JSON result

## Not acceptable

- inventing a task that is not in the source
- skipping the selection-rules log line
- declaring success without a validation command
- emitting the JSON result without writing the artifact first
