# Guided Scenario Flow — Large Build/Test (example, local-large)

Worked example of `flow.template.md` for the `large_build_test` built-in
scenario. The live, authoritative file is
`agents/scenarios/large-build-test/flow.md`.

## Demo intent

Show a larger System A engineering workload on a statically-sized `large`
session pod, with visible build/test steps and concrete completion
evidence.

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

- scenario is routed to a session pod created from the `large` pod profile
  (set at `OpenClawInstance` creation time; see
  `config/pod-profiles/profiles.yaml`)
- agent runs the build/test directly in the `large` session pod
- results surfaced via MinIO artifact or direct tool output
- no dynamic scale-up step — profile is selected statically, up front

The original design called for a dynamic `POST /sessions/{id}/scale-up`
contract on the control plane; that phase has been dropped in favour of
static profile selection. If it is revived later, the operator-native path
(child or resized `OpenClawInstance`) is preferred. Use the same
abstraction level as the live `agents/scenarios/*/flow.md` files when
authoring a real scenario.

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
