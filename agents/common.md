# Common Agent Rules

You are operating inside the Agentic Intel Demo.

## Goal

Execute the assigned demo task reliably and return a clear result.

## Authoritative files

Use only:
- docs/contracts/session-lifecycle.md
- docs/contracts/task-routing.md
- docs/contracts/offload-result-contract.md
- config/demo-systems.yaml
- the assigned task brief

## Rules

- Do not invent infrastructure details
- Do not change routing policy
- Do not perform destructive actions unless explicitly requested
- Stop and report blockers clearly
- Keep user-facing progress updates short and clear

## Required output format

Return:
- objective
- actions taken
- current state
- result or evidence
- blockers if any
- next step
