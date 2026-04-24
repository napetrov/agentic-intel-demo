# Architecture Variants by Scenario

This document is scoped to the shipped **two-system** architecture
(`templates/architecture/examples/two-system/`). It explains how the three
`execution_mode` values reshape load within that topology.

For a different topology (single-node, multi-system, different token
providers), start from `docs/architecture-spec.md` and
`templates/architecture/` — those document the pluggable slots. An
architecture's `spec.supported_execution_modes` controls which of the
modes below are even legal in that deployment.

Three execution modes are supported in this demo. The overall architecture in
`docs/architecture.md` is shared across all three, but different layers carry
load in different variants. This document is the single place that calls out
what actually differs per mode so a new scenario author can pick correctly.

All three variants share the following invariants:

- System A owns session state, routing policy, and user-facing status.
- System B is an execution backend only. It never owns user state and never
  makes routing decisions.
- Session pods never call System B directly. Offloaded artifact access goes
  through Control Plane.
- OpenClaw instance lifecycle is managed by `openclaw-operator`.
- Model calls go through LiteLLM on System A, which may back to vLLM on
  System B (see `docs/architecture.md` Layer 3).

What changes is which compute layer does the work, which pod profile is
used, and which contracts come into play.

## Quick picker

| Scenario shape | Pick this variant |
|----------------|-------------------|
| Terminal / shell / single-agent engineering on modest resources | `local-standard` |
| Build, compile, or test that needs a big pod but stays on System A | `local-large` |
| Analytics / data processing / heavier compute that should run on GNR | `offload` |

## Variant: `local-standard` (execution_mode `local_standard`)

Used by: `terminal_agent` (built-in example).

### What runs where
- Session pod on System A does all task execution.
- No sibling execution Job.
- No System B compute involvement.
- System B is still reachable as the model backend via LiteLLM; this is the
  same in all variants.

### Architectural layers that matter
- Layer 1 (Session Pod) — primary.
- Layer 2 (Control Plane) — session lifecycle only, no scale-up, no offload.
- Layer 3 (Model routing via LiteLLM) — unchanged.
- Layer 5 (Artifacts) — only if the scenario chooses to save a log/output.
- Layer 6 (Chat integration) — unchanged.

### Pod profile
- Session pod: `medium` (see `config/pod-profiles/profiles.yaml`).
- No scale-up path.

### Required contracts
- `docs/contracts/session-lifecycle.md`
- `docs/contracts/task-routing.md`

### Required evidence in the final result
- Real command transcript or tool-output transcript.
- Explicit success/failure checkpoint.

### When NOT to pick this variant
- If the task needs more than the `medium` pod profile.
- If the task would benefit from parallel analytics/data processing — that
  belongs in `offload`.

## Variant: `local-large` (execution_mode `local_large`)

Used by: `large_build_test` (built-in example).

### What runs where
- Session pod on System A stays at `small` (it stays alive as orchestrator).
- Control Plane launches a sibling **execution Job** with the `large` profile
  on System A.
- The Job writes outputs to MinIO (via Control Plane relay) or returns via
  Job status.
- No System B compute involvement.

### Architectural layers that matter
- Layer 1 (Session Pod) — orchestrator only.
- Layer 2 (Control Plane) — owns the scale-up path (`POST /sessions/{id}/scale-up`).
- Layer 3 (Model routing) — unchanged.
- Layer 5 (Artifacts) — in use. MinIO on System B is still the artifact
  store, accessed only through Control Plane relay.
- Layer 6 (Chat integration) — unchanged.

### Pod profile
- Session pod: `small`.
- Execution Job: `large`.

### Required contracts
- `docs/contracts/session-lifecycle.md`
- `docs/contracts/task-routing.md`

### Required evidence in the final result
- Explicit profile selection line ("selecting large execution profile").
- Execution Job id / status.
- Build or test command evidence (exit code, test counts, logs).

### When NOT to pick this variant
- If the heavy step is analytics/data-processing — use `offload` instead.
- If a `medium` pod would have been enough — use `local-standard`.

## Variant: `offload` (execution_mode `offload_system_b`)

Used by: `market_research` (built-in example).

### What runs where
- Session pod on System A is the orchestrator and stays `small`.
- Control Plane posts the job to the System B Offload API.
- A Worker Job runs on System B (GNR) and writes results to MinIO on System B.
- Session pod polls job status and pulls artifacts via Control Plane relay.
- Final result delivery still happens on System A.

### Architectural layers that matter
- Layer 1 (Session Pod) — orchestrator only.
- Layer 2 (Control Plane) — owns the offload path and artifact relay.
- Layer 3 (Model routing) — unchanged.
- Layer 4 (System B services) — primary compute layer for this variant.
- Layer 5 (Artifacts) — in use for both intermediate and final results.
- Layer 6 (Chat integration) — unchanged.

### Pod profile
- Session pod: `small`.
- Offload Worker Job: sized inside System B (`analytics` profile in
  `config/demo-systems.yaml`).

### Required contracts
- `docs/contracts/session-lifecycle.md`
- `docs/contracts/task-routing.md`
- `docs/contracts/offload-result-contract.md`

### Required evidence in the final result
- Offload job id returned by the Offload API.
- Artifact ref (MinIO path, relayed through Control Plane).
- Structured summary matching `templates/result-summary.md`.

### When NOT to pick this variant
- If the task is interactive terminal work — that belongs in `local-standard`.
- If the heavy step is a build/test and not data processing — use
  `local-large`.

## Side-by-side summary

| Dimension | local-standard | local-large | offload |
|-----------|----------------|-------------|---------|
| Session pod profile | medium | small | small |
| Second workload | none | execution Job on System A (large) | Worker Job on System B |
| Cross-system compute | no | no | yes (System B) |
| Uses MinIO artifact relay | optional | typical | required |
| Offload contract required | no | no | yes |
| Scale-up contract required | no | yes | no |
| Built-in example | `terminal_agent` | `large_build_test` | `market_research` |

## How architecture choice flows from the scenario spec

When authoring a new scenario:

1. Pick `execution_mode` in `catalog/scenarios.yaml`.
2. That choice locks the variant above.
3. The variant determines which layers of `docs/architecture.md` are on the
   critical path, which contracts are required, and which evidence must
   appear in the final result.
4. `docs/scenario-spec.md` lists the fields and acceptance checklist; this
   document explains the architectural consequences of each choice.

If a proposed scenario does not fit cleanly into one of the three variants,
prefer splitting it into two scenarios rather than inventing a fourth mode.
