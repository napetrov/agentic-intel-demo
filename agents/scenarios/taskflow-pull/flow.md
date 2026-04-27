# Guided Scenario Flow — TaskFlow Pull

## Demo intent

Show that demo work units can be sourced from an external task system
(TaskFlow API) instead of being hardcoded in this repo. The orchestrator pulls
the open task list, selects one by business rules, and runs it as a bounded
local engineering task on System A.

## Required opening

Start with:
`Starting TaskFlow scenario pull`

Then state the flow briefly:
1. resolve TaskFlow source (live API or shipped fixture)
2. fetch the open task list
3. select one task by priority/due-date business rules
4. render the task brief and execute the bounded action
5. validate output and summarize evidence

## Scenario contract

- route: `local_standard`
- system owner: System A
- TaskFlow source order: env `TASKFLOW_API_URL` -> shipped fixture under
  `agents/scenarios/taskflow-pull/fixtures/tasks.json`
- never push back to the TaskFlow API in the demo path; pull-only
- pick exactly one task per run; do not batch

## Selection rules

Match the TaskFlow business rules referenced in the upstream
`docs/business-rules.md`:
- prefer status `overdue` over `open`
- within the same status, pick the highest `priority` (`high` > `medium` > `low`)
- tie-break by oldest `due_date`
- skip tasks with `status: done` or `status: cancelled`

## Minimum evidence to show

Include:
- TaskFlow source line (URL or fixture path)
- raw task count and selection summary (id, title, priority, status, due_date)
- bounded execution evidence (real shell or python output for the picked task)
- explicit validation check (grep / test / parsed JSON field)
- final structured result line

## Failure handling

- if `TASKFLOW_API_URL` is set but unreachable: fall back to fixture, log the
  fallback line, continue
- if neither source has any selectable task: stop, report `no eligible task`
  with the inspected source, suggest checking fixture or API
- if the selected task lacks required fields (id, title, priority, status):
  skip it and pick the next; if all candidates are malformed, fail loudly
