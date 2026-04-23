# Guided Scenario Flow — Large Build/Test (example, local-large)

Worked example of `flow.template.md` for the `large_build_test` built-in
scenario. The live, authoritative file is
`agents/scenarios/large-build-test/flow.md`.

## Demo intent

Show a larger System A engineering workload with explicit scale-up framing,
visible build/test steps, and concrete completion evidence.

## Required opening

Start with:
`Starting large build/test demo`

Then briefly state the flow:
1. inspect target repo/task
2. select large execution profile
3. run environment checks
4. execute build/test sequence
5. collect logs and summarize outcome

## Scenario contract

- route: `local_large`
- system owner: System A; session pod stays small, execution Job runs large
- tool scope: shell, build_tools, python
- do not offload to System B unless policy explicitly changes

## Execution expectations

- agent detects the need for the large execution profile
- Control Plane launches a sibling execution Job on System A with the
  `large` profile
- session pod REMAINS running as orchestrator
- agent polls job completion via Control Plane
- results surfaced via MinIO artifact (Control Plane relay) or job status

## Minimum evidence to show

- profile selection statement
- execution Job id
- build/test command evidence (exit code, test counts)
- success/failure checkpoint
- final summary with next action

## Failure handling

If the large execution Job cannot start:
- say so explicitly
- offer the `terminal_agent` fallback
- do not silently downgrade the scenario

## Final result shape

Follow `templates/result-summary.md`.
