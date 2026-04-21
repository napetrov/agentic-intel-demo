# Terminal Agent Demo — Reference Task Spec

## Purpose

This scenario should not be a vague "terminal demo". It should execute a bounded task in the style of a Terminal Bench task: clear objective, explicit files/commands, and a verifiable success condition.

## Reference task shape

Use a task shaped like this:

- the agent is placed in a repository or working directory
- it is given a specific engineering objective
- it must inspect the workspace using terminal commands
- it must produce or modify a concrete artifact
- it must validate the result with an explicit check

## Demo reference task

### Name
`repo-structure-audit-and-fixup`

### Objective
Inspect the current repository and produce a structured scenario/task inventory for the demo, validating that guided scenario files, task-family files, and config references are internally consistent.

### Problem to solve
The demo repo has evolved quickly, so the terminal task should prove that the agent can use shell tools to inspect the repo, locate scenario/task definitions, detect mismatches, and produce a concrete audit artifact rather than just narrating.

### Inputs
- current repository checkout
- `agents/`
- `catalog/`
- `config/`
- relevant docs such as `docs/repo-layout.md`

### Expected actions
1. inspect the repo structure with shell commands
2. enumerate scenario files under `agents/scenarios/`
3. enumerate reusable task-family files under `agents/tasks/`
4. compare those to scenario definitions in `catalog/scenarios.yaml`
5. compare key config/document references to the current layout
6. write a concrete audit artifact under a temp or artifact path
7. validate the artifact contains the expected sections

### Suggested command pattern
Use real terminal commands such as:
- `pwd`
- `find agents -maxdepth 3 -type f | sort`
- `find config -maxdepth 3 -type f | sort`
- `sed -n '1,220p' catalog/scenarios.yaml`
- `grep -RIn "agents/scenarios\|agents/tasks\|config/" docs catalog agents`
- `python3 ...` to generate a structured inventory file
- `grep` or `python3` assertions to validate output

## Concrete success artifact

Create a file such as:
- `artifacts/demo-terminal/scenario-audit.md`
or
- `/tmp/<session>/scenario-audit.md`

The artifact should contain at minimum:
- guided scenarios found
- reusable task families found
- config files found
- mismatches or missing references
- final pass/fail summary

## Success condition

The task is successful only if:
- real shell commands were run
- the audit artifact was written
- the artifact includes all required sections
- a validation command confirms the artifact exists and contains expected headings

## Validation examples

At least one validation step should run, for example:
- `test -f artifacts/demo-terminal/scenario-audit.md`
- `grep -q "Guided scenarios found" artifacts/demo-terminal/scenario-audit.md`
- `grep -q "Final summary" artifacts/demo-terminal/scenario-audit.md`

## Acceptable fallback task

If the repo does not support the audit task cleanly, use a controlled fallback task:

### Fallback name
`structured-file-transform-check`

### Fallback objective
Generate a structured report from a set of repo files using shell/Python, then validate the report with explicit checks.

### Fallback success condition
A report file is created and validated with at least two terminal checks.
