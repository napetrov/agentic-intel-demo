# Demo Scenario Specification

This document defines what an external user must supply to add a new guided
demo scenario to this repo. It is the contract between a demo author and the
rest of the stack (orchestrator, catalog, agent files, architecture).

Scenarios are the units that Telegram-driven demos expose as buttons. Each
scenario must carry enough information for the orchestrator to route it, for
an operator to run it end-to-end, and for a reviewer to tell whether a run
succeeded.

Use `templates/scenarios/` as the starting point and keep each new scenario
self-contained under a single directory.

## Required fields

Every scenario MUST define these fields. Missing any of them means the
scenario is not acceptance-ready.

| Field | Where it lives | Purpose |
|-------|----------------|---------|
| `id` | `catalog/scenarios.yaml` key | stable machine id, snake_case |
| `label` | `catalog/scenarios.yaml` | human-readable Telegram button text |
| `execution_mode` | `catalog/scenarios.yaml` | one of `local_standard`, `local_large`, `offload_system_b` |
| `task_family` | `catalog/scenarios.yaml` | must exist in `catalog/tasks.yaml` |
| `initial_user_message` | `catalog/scenarios.yaml` | exact text sent to user on start |
| `allowed_next_actions` | `catalog/scenarios.yaml` | subset of `show_status`, `reset_session`, scenario ids |
| `fallback_scenario` | `catalog/scenarios.yaml` | scenario id or `null` |
| Demo intent | `agents/scenarios/<id>/flow.md` | one short paragraph |
| Required opening | `agents/scenarios/<id>/flow.md` | exact acknowledgement text |
| Scenario contract | `agents/scenarios/<id>/flow.md` | route, system owner, tool scope |
| Minimum evidence | `agents/scenarios/<id>/flow.md` | list of artifacts/outputs required |
| Failure handling | `agents/scenarios/<id>/flow.md` | what to report when a step is blocked |
| Task brief | `agents/scenarios/<id>/<task>.md` | bounded work the agent actually does |
| Context map entry | `agents/context-map.md` | files the orchestrator loads for this scenario |
| Telegram trigger | `agents/orchestrator.md` guided triggers section | callback + natural-language triggers |

## Optional but recommended fields

- `architecture_variant` — one of `local-standard`, `local-large`, `offload`
  (see `docs/architecture-variants.md`). If omitted, it is inferred from
  `execution_mode`.
- `pod_profile` override — set in `config/pod-profiles/profiles.yaml` only if
  the scenario genuinely needs a non-default profile.
- `offload_task_type` — only for `offload_system_b`; must match the contract
  in `docs/contracts/offload-result-contract.md`.
- `artifact_output: true|false` — whether the scenario is expected to write
  artifacts to the shared artifact path.
- Success criteria checklist — objective, observable conditions the operator
  can check before calling a run successful.

## Requirements, by category

### Identity
- `id` must be unique across `catalog/scenarios.yaml`
- `label` should fit the Telegram inline-button width and avoid punctuation
  that breaks callback data
- Acknowledgement text in `flow.md` must match `initial_user_message`
  character-for-character

### Execution
- Pick exactly one `execution_mode`. Do not mix modes inside one scenario.
- `local_standard`: all work runs inside the session pod on System A. No
  scale-up, no System B compute.
- `local_large`: session pod stays small; a sibling execution Job on System A
  runs the heavy step. No System B compute.
- `offload_system_b`: orchestration on System A; compute runs as a System B
  Job. Session pod never contacts System B directly (see
  `docs/contracts/offload-result-contract.md`).
- The chosen mode must be supported by the scenario's `task_family` in
  `catalog/tasks.yaml` (either as `default_execution` or listed in
  `alternate_execution`).

### User experience
- The orchestrator must be able to resolve the scenario from a Telegram
  callback and from at least one natural-language phrase.
- The scenario must list the six-button guided menu as an allowed "next
  action" surface (done at the orchestrator level, not per scenario).
- Every progress update must be one short line, consistent with the vocabulary
  in `templates/tg-messages.md`.

### Evidence and output
- The final message must follow `templates/result-summary.md`:
  objective, actions, state, evidence, blockers, next step.
- For `offload_system_b` scenarios, evidence must include the offload job id
  and artifact ref returned via Control Plane.
- For `local_large` scenarios, evidence must include the execution Job id and
  profile selection line.
- For `local_standard` scenarios, evidence must include at least one real
  shell command transcript or equivalent tool output.

### Safety and scope
- No destructive actions without explicit user confirmation.
- No direct reach-through from session pod to System B (MinIO access is
  always relayed through Control Plane).
- No routing decisions delegated to System B.

## Acceptance checklist for a new scenario

Before opening a PR that adds a scenario, confirm:

- [ ] `catalog/scenarios.yaml` entry added and valid
- [ ] `catalog/tasks.yaml` already contains the `task_family` referenced
- [ ] `agents/scenarios/<id>/flow.md` exists with all required sections
- [ ] `agents/scenarios/<id>/<task>.md` defines a bounded, runnable task
- [ ] `agents/context-map.md` lists all files needed to run the scenario
- [ ] `agents/orchestrator.md` lists the Telegram triggers
- [ ] Acknowledgement text matches between catalog and `flow.md`
- [ ] Architecture variant is either explicit or unambiguous from
      `execution_mode` (see `docs/architecture-variants.md`)
- [ ] Minimum evidence list is concrete (commands, artifacts, job ids)
- [ ] Failure handling explicitly names what to tell the user and what to
      fall back to

## Reference templates and examples

- `templates/scenarios/README.md` — how to use the templates
- `templates/scenarios/scenario-spec.template.yaml` — catalog entry template
- `templates/scenarios/flow.template.md` — agent flow template
- `templates/scenarios/task-brief.template.md` — bounded task brief template
- `templates/scenarios/examples/` — filled-in examples for the three built-in
  scenarios (terminal agent, market research, large build/test)
