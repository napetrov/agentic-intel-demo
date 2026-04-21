# Agentic Execution on Intel CPUs Demo

Demo-first repository area for a reproducible two-system prototype:
- System A: Intel CPU Kubernetes environment for OpenClaw instances managed by `openclaw-operator`
- System B: GNR Intel CPU Kubernetes environment for local SLM, offload analytics, and shared services

## Goals
- Keep the user interacting with an agent, not with Kubernetes or physical systems
- Manage OpenClaw instance lifecycle only through `openclaw-operator`
- Support 3 demo scenarios:
  1. Terminal agent
  2. Market research report with GNR offload
  3. Local build/test with scale-up on System A
- Prefer ready-made components over custom platform work

## Documents
- `docs/demo-overview.md` — concise demo operating model for Telegram-first entry and two-system execution
- `docs/contracts/session-lifecycle.md` — System A-owned lifecycle and user-visible state model
- `docs/contracts/task-routing.md` — policy-driven routing for standard, local-large, and offload paths
- `docs/contracts/offload-result-contract.md` — strict System A ↔ System B execution/result boundary
- `docs/operator-runbook.md` — operator install/recovery notes and known CRD blocker
- `docs/operator-gap-analysis.md` — what is still missing for operator-first reproducibility
- `docs/implementation-guide.md` — current working implementation path, fixes, and reproducible setup guide
- `docs/architecture.md` — architecture breakdown and execution model
- `docs/mvp-plan.md` — minimal MVP path and implementation order
- `docs/reusable-components.md` — what to reuse vs what to build
- `docs/repo-layout.md` — proposed service/config/repo structure
- `docs/open-questions.md` — decisions and unknowns to resolve
- `docs/reproducibility.md` — what must be written down to make the demo reproducible

## Current validated direction
The current validated direction is:
- `openclaw-operator` is the primary and only supported instance-management path
- System B model serving uses **vLLM** with:
  - model: `Qwen/Qwen3-4B-Instruct-2507`
  - context length: `32768`
  - CPU profile: `16 CPU / 32Gi`

Use `docs/operator-runbook.md` and `docs/operator-gap-analysis.md` as the source of truth for operator-specific bring-up and remaining work.

## Scripts
- `scripts/check-operator-prereqs.sh` — checklist for operator-managed instance prerequisites
- `scripts/smoke-test-operator-instance.sh` — operator lifecycle validation checklist
- `scripts/setup-system-a.sh` — current System A manifest setup materials
- `scripts/setup-system-b.sh` — original System B ollama-based path
- `scripts/setup-system-b-vllm.sh` — current validated System B vLLM path
- `scripts/check-system-b-vllm.sh` — validate running vLLM setup and context length
- `scripts/cleanup-system-a.sh` — reduce disk pressure on System A safely

## Guiding principles
- Demo first, not platform first
- Start with the shortest end-to-end path
- Prefer explicit flows over hidden automation
- System A is the single owner of session state, routing policy, and user-visible status
- System B is an execution backend, not a second control plane
- Guided Telegram UX is the default; freeform chat is explicit
- Keep inference, routing, and execution policies declarative
- Reuse OpenClaw, Kubernetes, LightLLM, Terminal Bench, and an OpenAI-compatible local SLM where possible

## Recommended first slice
1. Install `openclaw-operator`
2. Apply CRD safely and verify controller health
3. Create one `OpenClawInstance`
4. Verify model access through LiteLLM/vLLM
5. Verify instance-managed gateway/service health
6. Then add scale-up and System B offload behavior
