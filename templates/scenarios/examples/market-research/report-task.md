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
3. submit an offload job via Control Plane `POST /offload`
4. poll `GET /offload/{job_id}` until the job is done
5. fetch the artifact via Control Plane relay
6. assemble the analyst-style summary

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
