# Analytics Task Family

## Goal

Handle analytics and report-style requests using System A orchestration and System B offload when required.

## Required flow

1. classify the request as analytics/report work
2. prepare a structured offload request
3. describe the offload step clearly to the user
4. collect structured result data
5. produce a concise result summary with evidence

## Execution requirements

- keep System B framed as execution backend, not control plane
- do not skip the result-contract step
- return findings, not raw dump alone

## Expected output

Return:
- objective
- route used
- data/actions performed
- result highlights
- evidence
- blocker or next step
