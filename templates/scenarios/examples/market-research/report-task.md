# Task Brief — Market Research (example, offload)

Worked example of `task-brief.template.md` for the `market_research`
built-in scenario. The live task brief is
`agents/scenarios/market-research/report-task.md`.

## Objective

Produce a short analyst-style note that answers a bounded market question by
orchestrating on System A and running the heavy analytical step as an
offload job on System B.

## Inputs

- a framed research question (user-provided or canned)
- comparison dimensions (e.g., cost, performance, adoption)
- an analytics input dataset reference or canned inputs

## Steps

1. frame the research question and comparison dimensions
2. build a structured input spec
3. submit an offload job through Control Plane (planned surface:
   `POST /offload`, per `docs/architecture.md`)
4. poll Control Plane for completion (planned surface:
   `GET /offload/{job_id}`)
5. fetch the artifact via Control Plane relay (planned surface:
   `GET /artifacts/{ref}`)
6. assemble the analyst-style summary

The endpoint names are the planned contract per `docs/architecture.md` and
`docs/mvp-plan.md` Phase 7. The live Control Plane implementation in
`legacy/services/control-plane` currently exposes only session endpoints;
match the abstraction level used by the live `agents/scenarios/*` files
when authoring a real scenario.

## Success criteria

- offload job status is `succeeded`
- artifact ref is fetchable via Control Plane relay
- final summary contains question, approach, findings, evidence, next step

## Allowed tools

- `python`
- `analytics_tools`
- Control Plane API (offload + artifact relay)

## Out of scope

- running the heavy analytics locally inside the session pod
- calling System B APIs directly from the session pod
- modifying any files outside the session workspace

## Evidence to capture

- structured input spec
- offload job id
- artifact ref
- final analyst summary
