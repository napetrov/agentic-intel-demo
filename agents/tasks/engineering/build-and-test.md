# Build and Test Task Family

## Goal

Handle larger engineering workloads that require an explicit build/test sequence and stronger progress reporting.

## Required flow

1. inspect the repo and identify the target build/test entrypoint
2. state the chosen execution profile and why it fits
3. run environment checks
4. run the build or test sequence
5. capture success/failure evidence
6. report outcome, artifacts, and next action

## Execution requirements

- do not claim a build/test ran unless commands actually ran
- include at least one concrete command/output reference in the final result
- if the task fails, name the failing step precisely

## Expected output

Return:
- objective
- environment checks
- build/test actions
- key output evidence
- final state
- blockers or next step
