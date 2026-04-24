# Task Brief — Terminal Agent (example, local-standard)

Worked example of `task-brief.template.md` for the `terminal_agent` built-in
scenario. The live task brief is
`agents/scenarios/terminal-agent/terminal-bench-task.md` with a reference
task in `terminal-bench-reference.md`.

## Objective

Run a bounded terminal task inside the session pod on System A and return a
concise engineering summary with verifiable evidence.

## Inputs

- a small target repo or script already available in the session workspace
- the reference task defined in
  `agents/scenarios/terminal-agent/terminal-bench-reference.md`

## Steps

1. inspect the workspace and the reference task
2. run the terminal commands required to complete the task
3. run a validation command that proves success
4. capture the transcript
5. emit the structured result summary

## Success criteria

- the reference task's documented check passes
- transcript of the successful command is present in the evidence
- final status line clearly says `completed` or `failed`

## Allowed tools

- `shell`
- `git`
- `python`
- `build_tools`

## Out of scope

- offloading work to System B
- modifying files outside the session workspace
- requesting scale-up (that belongs in `large_build_test`)

## Evidence to capture

- command transcripts
- validation-command output
- final status line
