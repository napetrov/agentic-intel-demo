# Task Brief — Large Build/Test (example, local-large)

Worked example of `task-brief.template.md` for the `large_build_test`
built-in scenario. The live task brief is
`agents/scenarios/large-build-test/build-task.md`.

## Objective

Execute a compile-heavy build and test sequence against a target repo using
a large execution Job on System A while the session pod stays as
orchestrator.

## Inputs

- path to the target repo in the workspace
- the build/test invocation (e.g., `make test`, `pytest -q`, or a language-
  specific command)

## Steps

1. inspect target repo and identify the build/test invocation
2. state "selecting large execution profile" (profile is already applied to
   the session pod at instance creation; no runtime scale-up step)
3. run the build/test directly in the session pod
4. collect the exit code and test counts
5. emit the structured result summary

The original dynamic scale-up path (`POST /sessions/{id}/scale-up`) has
been dropped in favour of static `large` profile selection at
`OpenClawInstance` creation time.

## Success criteria

- execution Job reaches a terminal state (`succeeded` or `failed`) within the
  configured timeout
- exit code is recorded
- test counts (or build artifact presence) are captured

## Allowed tools

- `shell`
- `git`
- `python`
- `build_tools`
- Control Plane API (artifact relay only)

## Out of scope

- offloading the build/test to System B
- running the build locally inside the small session pod
- modifying repo files outside the checked-out target

## Evidence to capture

- profile selection line
- execution Job id
- build/test command transcript (or tail of logs)
- exit code and test summary
- final status line
