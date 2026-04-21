# Task Routing Contract

System A is the single owner of routing decisions.

## Inputs

A task request includes:
- session id
- Telegram user/chat context
- selected scenario if guided
- freeform task text if provided
- task family if already known
- execution constraints if known

## Routing order

### 1. Guided scenario selected
If the user selected a guided scenario, use the route defined in `catalog/scenarios.yaml`.

### 2. Freeform request
If the user entered chat mode and sent a freeform task:
- classify the request using `catalog/tasks.yaml`
- apply hard guards
- select the route
- if uncertain, ask one short clarifying question or offer guided scenarios

## Hard guards

Hard guards must be applied before route selection:
- task family compatibility
- required capabilities
- allowed tools
- sensitivity restrictions
- profile availability

## Execution routes

- local_standard
- local_large
- offload_system_b

## Fallback behavior

If the selected route is unavailable:
- prefer a safe fallback if policy allows it
- otherwise return a clear Telegram-visible failure or fallback offer

Examples:
- offload unavailable -> offer local guided scenario
- local_large unavailable -> offer standard path or explain limitation
