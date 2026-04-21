# Offload Result Contract

System B is an execution backend only.

## Offload request from System A

Must include:
- task id
- session id
- task type
- structured input or input references
- timeout
- expected output type
- provenance metadata
- allowed tool scope

## Offload response from System B

Must include:
- task id
- status
- progress metadata when available
- output references or structured output
- summary metadata
- error details on failure

## Rules

- System B must not own user session state
- System B must not make routing decisions
- System B returns results only to System A
- System A is responsible for user-facing result delivery
