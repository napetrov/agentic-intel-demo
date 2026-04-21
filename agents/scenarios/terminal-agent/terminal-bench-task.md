# Terminal Agent Demo Task — Terminal Bench Style

## Objective

Execute a specific bounded terminal task that resembles a Terminal Bench flow rather than a synthetic chat-only answer.

## Reference task

Use `agents/scenarios/terminal-agent/terminal-bench-reference.md` as the concrete reference task spec.

The preferred default task is `repo-structure-audit-and-fixup`.

## Preferred task pattern

Choose one bounded task from this order of preference:

### Option A — Real repo task
- inspect the current repo
- start with the reference task `repo-structure-audit-and-fixup` unless a better equally bounded repo task is explicitly available
- find a safe read-only or minimally invasive engineering task
- examples: validate config references, render a file inventory, verify a documented command path, generate a structured audit artifact

### Option B — Controlled terminal bench task
If the repo does not contain a clean runnable target, run a controlled terminal task such as:
- create a temporary workspace
- materialize a small input file
- use shell tools or Python to transform/analyze it
- validate output with grep, diff, pytest, or a checksum-style check

## Required step sequence

1. announce the selected terminal task in one sentence
2. inspect relevant files or environment
3. run the command sequence
4. run at least one validation check
5. report result with command evidence

## Strong preference

Use actual commands such as:
- `pwd`, `ls`, `find`, `grep`, `sed`, `cat`
- `python3 ...`
- `pytest ...` or another real validation command when available

## Not acceptable

- pretending commands ran
- only describing what would happen
- returning a summary without evidence
