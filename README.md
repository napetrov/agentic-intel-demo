# Agentic Execution on Intel CPUs Demo

Demo-first repository area for a reproducible two-system prototype:
- System A: Intel CPU Kubernetes environment for agent session pods and local engineering execution
- System B: GNR Intel CPU Kubernetes environment for local SLM, offload analytics, and shared services

## Goals
- Keep the user interacting with an agent, not with Kubernetes or physical systems
- Run one agent session per pod
- Support 3 demo scenarios:
  1. Terminal agent
  2. Market research report with GNR offload
  3. Local build/test with scale-up on System A
- Prefer ready-made components over custom platform work

## Documents
- `docs/implementation-guide.md` — current working implementation path, fixes, and reproducible setup guide
- `docs/architecture.md` — architecture breakdown and execution model
- `docs/mvp-plan.md` — minimal MVP path and implementation order
- `docs/reusable-components.md` — what to reuse vs what to build
- `docs/repo-layout.md` — proposed service/config/repo structure
- `docs/open-questions.md` — decisions and unknowns to resolve
- `docs/reproducibility.md` — what must be written down to make the demo reproducible

## Current validated direction
The originally sketched System B path used `ollama`, but the currently validated working setup uses **vLLM** with:
- model: `Qwen/Qwen3-4B-Instruct-2507`
- context length: `32768`
- CPU profile: `16 CPU / 32Gi`

Use `docs/implementation-guide.md` as the source of truth for the current bring-up flow.

## Scripts
- `scripts/setup-system-a.sh` — apply System A manifests
- `scripts/setup-system-b.sh` — original System B ollama-based path
- `scripts/setup-system-b-vllm.sh` — current validated System B vLLM path
- `scripts/check-system-b-vllm.sh` — validate running vLLM setup and context length
- `scripts/cleanup-system-a.sh` — reduce disk pressure on System A safely
- `scripts/smoke-test-session.sh` — end-to-end smoke test entry point

## Guiding principles
- Demo first, not platform first
- Start with the shortest end-to-end path
- Prefer explicit flows over hidden automation
- Keep inference, routing, and execution policies declarative
- Reuse OpenClaw, Kubernetes, LightLLM, Terminal Bench, and an OpenAI-compatible local SLM where possible

## Recommended first slice
1. Session pod on System A
2. Local tools execution
3. Model access through LightLLM
4. Artifact/log return
5. Then add scale-up path
6. Then add System B offload path
