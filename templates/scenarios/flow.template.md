# Guided Scenario Flow — <Scenario Label>

## Demo intent

<One short paragraph describing what the audience should see and why this
scenario is worth showing. No implementation details.>

## Required opening

Start with:
`<Exact acknowledgement text; must match initial_user_message in catalog/scenarios.yaml>`

Then briefly state the flow:
1. <step 1>
2. <step 2>
3. <step 3>
4. <step 4>
5. <step 5>

## Scenario contract

- route: `<local_standard|local_large|offload_system_b>`
- system owner: <System A | System A for orchestration, System B for compute>
- tool scope: <terminal, analytics, build-test, ...>
- do not <list what this scenario must not turn into, e.g., "a vague
  conversational answer">

## Execution expectations

<Concrete description of what the agent should actually do. Examples:
- "run a bounded terminal task in a Terminal Bench style"
- "offload the heavy step via POST /offload and poll for the artifact"
- "request scale-up and wait for the execution Job to finish before
  returning results">

## Minimum evidence to show

Include evidence for:
- <step-level evidence, e.g., "workspace/task inspection">
- <tool transcripts, e.g., "at least one real shell command sequence">
- <check/validation, e.g., "explicit success/failure checkpoint">
- <for offload: "offload job id and artifact ref returned via Control Plane">
- <for local-large: "profile selection line and execution Job id">

## Failure handling

If a step cannot run or the environment lacks the expected tooling:
- say exactly which step was blocked
- still provide the partial evidence gathered
- suggest the next corrective action
- if the scenario has a `fallback_scenario`, offer it explicitly

## Final result shape

Follow `templates/result-summary.md`. Every run must return:
- objective
- actions taken
- current state
- result or evidence
- blockers if any
- recommended next step
