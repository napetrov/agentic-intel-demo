# Session Lifecycle Contract

System A is the single owner of session lifecycle.

## States

- new
- ready
- running
- waiting_input
- completed
- failed
- expired

## Meaning

### new
Session created but not yet ready for task execution.

### ready
Session is ready for scenario selection or task input.

### running
A task is actively being executed.

### waiting_input
The system needs one clarification or user decision.

### completed
The last task completed successfully.

### failed
The last task failed and a retry or fallback may be offered.

### expired
The session is no longer active and must be restarted.

## User-facing expectations

Each state must have a clear Telegram-visible message.

Examples:
- new -> Starting demo session
- ready -> Choose a scenario or enter chat mode
- running -> Working on your task
- waiting_input -> Need one quick clarification
- completed -> Demo task completed
- failed -> Task failed, offering retry or fallback
- expired -> Session expired, start a new one
