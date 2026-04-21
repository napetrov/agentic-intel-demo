# Engineering Task Family

## Goal

Handle freeform engineering requests on System A with visible execution, concise status, and clear evidence.

## Typical actions

- inspect repository or workspace state
- read the relevant task brief or target files
- run shell commands safely
- execute validation steps
- summarize outputs and blockers

## Required execution style

- show that real terminal work happened
- prefer small batches of commands over one opaque command
- capture evidence the user can understand
- stop early if the environment does not support the requested step

## Expected output

Return:
- objective
- commands/actions performed
- evidence collected
- result status
- blocker or next action
