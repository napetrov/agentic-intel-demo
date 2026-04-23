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
2. state "selecting large execution profile"
3. request scale-up via Control Plane `POST /sessions/{id}/scale-up`
4. wait for the execution Job to reach `running`
5. stream or poll logs
6. collect the exit code and test counts
7. emit the structured result summary

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
- Control Plane API (scale-up + artifact relay)

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
