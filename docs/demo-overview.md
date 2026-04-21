# Demo Overview

This demo shows how a user can start work from Telegram and have tasks routed through a controlled OpenClaw execution environment.

## Systems

### System A
Owns:
- Telegram-linked session state
- routing decisions
- policy enforcement
- operator-managed OpenClaw instance lifecycle
- user-facing progress and final results

### System B
Owns:
- offloaded job execution
- analytics and heavy compute
- structured result return to System A

System B does not own user state, routing policy, or session memory.

## Demo execution modes

### 1. Local standard
Used for terminal and lighter engineering tasks.

### 2. Local large
Used for larger build/test style workloads on System A.

### 3. Offload
Used for analytics and heavier data-processing workloads on System B.

## User experience

The user enters through Telegram, chooses a guided scenario or explicitly switches to chat mode, and receives status updates and final results in the same conversation.
