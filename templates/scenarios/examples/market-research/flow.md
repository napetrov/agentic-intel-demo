# Guided Scenario Flow — Market Research (example, offload)

Worked example of `flow.template.md` for the `market_research` built-in
scenario. The live, authoritative file is
`agents/scenarios/market-research/flow.md`.

## Demo intent

Show System A orchestrating a structured market-research workflow while
System B acts as the offload backend for heavier analysis.

## Required opening

Start with:
`Starting market research demo`

Then state the flow briefly:
1. frame the question
2. prepare structured analysis inputs
3. offload analysis to System B
4. collect findings
5. return a concise report

## Scenario contract

- route: `offload_system_b`
- system owner: System A for orchestration, System B for compute only
- tool scope: analytics_tools, python
- session pod must not call System B directly; go through Control Plane
- do not perform the heavy analysis locally inside the session pod

## Execution expectations

- frame the research question and pick comparison dimensions
- submit the offload job through Control Plane (never direct to System B)
- poll for completion through Control Plane
- fetch the artifact via Control Plane artifact relay
- assemble the analyst-style summary

The specific endpoint surface (`POST /offload`, `GET /offload/{job_id}`,
`GET /artifacts/{ref}`) is the planned contract documented in
`docs/architecture.md` and `docs/mvp-plan.md` Phase 7. Treat it as the
target shape; the live `legacy/services/control-plane` does not yet
implement these routes. When authoring a real scenario, describe the
behavior at the same abstraction level as the live
`agents/scenarios/*/flow.md` files and point to the architecture doc for
endpoint names.

## Minimum evidence to show

- framed research question and comparison dimensions
- offload job id returned by the offload layer
- artifact ref (MinIO path) relayed by Control Plane
- concise analyst summary

## Failure handling

If offload is unavailable:
- say so explicitly
- offer the `terminal_agent` fallback (configured in catalog)
- do not silently run the analysis locally

## Final result shape

Follow `templates/result-summary.md`. Analyst-style content:
- question/objective
- approach
- findings
- evidence or structured support
- recommended next step
