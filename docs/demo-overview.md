# Demo Overview

This demo shows how a user can pick a guided scenario in the web portal and have it routed through a controlled OpenClaw execution environment. A Telegram interface is supported for the operator-driven path (`agents/orchestrator.md`) but is no longer the primary audience-facing surface — the web portal at `:8080` is.

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

The audience-facing path is the web portal (`web-demo/index.html`): pick one of three main scenario cards (Local task, Cross-system offload, Density), watch the architecture animate during the run, see the artifact + economics tiles populate, and follow the deep links into the satellite "Behind the scenes" and "Scalability story" pages.

Telegram remains supported as an operator-driven alternative interface (`agents/orchestrator.md` defines the callback contract); it's not the default for the audience-facing demo.
