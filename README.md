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
- `docs/demo-setup.md` — tiered bring-up guide (web simulation, local services, two-system k8s + operator)
- `docs/contracts/session-lifecycle.md` — System A-owned lifecycle and user-visible state model
- `docs/contracts/task-routing.md` — policy-driven routing for standard, local-large, and offload paths
- `docs/contracts/offload-result-contract.md` — strict System A ↔ System B execution/result boundary
- `docs/operator-runbook.md` — operator install/recovery notes and known CRD blocker
- `docs/operator-gap-analysis.md` — what is still missing for operator-first reproducibility
- `docs/implementation-guide.md` — implementation notes and migration context for the current demo
- `docs/architecture.md` — architecture breakdown and execution model
- `docs/architecture-spec.md` — pluggable architecture spec (1..N clusters, pluggable token providers, Kubernetes-first)
- `docs/architecture-variants.md` — how architecture differs per execution mode (local-standard / local-large / offload) within the two-system reference
- `docs/scenario-spec.md` — requirements and acceptance checklist for authoring new demo scenarios
- `docs/mvp-plan.md` — (deprecated; describes the removed raw control-plane/session-pod path)
- `docs/reusable-components.md` — what to reuse vs what to build
- `docs/repo-layout.md` — reference repo-layout notes and earlier structure proposal
- `docs/reproducibility.md` — what must be written down to make the demo reproducible
- `docs/improvement-plan.md` — analysis of the current repo, what was runnable locally, bugs found, and prioritized improvements
- `docs/flowise-integration.md` — optional Flowise alt-orchestrator deployment (Docker + k8s) and flow specs

## Authoring new demo scenarios
External authors adding a new guided scenario should start here:
- `docs/scenario-spec.md` — required fields and acceptance checklist
- `docs/architecture-variants.md` — picking the execution mode / architecture variant
- `templates/scenarios/` — copy-and-fill templates (`scenario-spec.template.yaml`, `flow.template.md`, `task-brief.template.md`) plus one worked example per variant under `templates/scenarios/examples/`

## Authoring a new architecture
External authors deploying the demo on a different topology (single-node,
multi-system, alternative token providers) should start here:
- `docs/architecture-spec.md` — pluggable architecture requirements
- `templates/architecture/` — copy-and-fill architecture template plus
  worked examples: `single-node/`, `two-system/`, `multi-system/`,
  `cloud-provider-mix/`
- `scripts/validate-demo-templates.py` — validates both scenarios and
  architectures against the specs; runs in CI as job `validate-templates`

## Current validated direction
The current validated direction is:
- `openclaw-operator` is the primary and only supported instance-management path
- System B model serving uses **vLLM** with:
  - model: `Qwen/Qwen3-4B-Instruct-2507`
  - context length: `32768`
  - CPU profile: `16 CPU / 32Gi`
- The offload relay (`POST /offload`, `GET /offload/{job_id}`,
  `GET /artifacts/{ref}`) is implemented in `runtimes/control-plane/`
  and exercised end-to-end by the `tier1-scenario-slice` CI job
  (full scenario path: scenario → control-plane → offload-worker →
  MinIO artifact)

Use `docs/operator-runbook.md` and `docs/operator-gap-analysis.md` as the source of truth for operator-specific bring-up and remaining work.

## Local bring-up (laptop)
For a single-host demo without Kubernetes, the repo ships a
`docker-compose.yaml` that brings up MinIO, the offload-worker, the control
plane, and the static web UI with an `/api` reverse proxy:

```bash
docker compose up --build
# open http://localhost:8080 — "Run walkthrough" submits a real shell task
# via the control plane and renders the worker stdout in the demo UI.
```

`task_type=shell` is fully self-contained on this path. `task_type=agent_invoke`
is also wired locally: an `agent-stub` container stands in for the OpenClaw
gateway and exposes `POST /tools/invoke` with a small allow-listed tool set
(`shell`, `read_file`, `list_files`, `summarize`, `echo`, plus a `command`
classifier). The web UI exposes an "Agent command" input that submits free-form
text through `agent_invoke` and renders the agent's chosen tool, trace, and
output. To target a real remote OpenClaw instead of the stub, set
`OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` in your shell before
`docker compose up`.

### Optional: Flowise alt orchestrator

Flowise (visual flow builder) is shipped as an opt-in overlay:

```bash
# .env: FLOWISE_USERNAME, FLOWISE_PASSWORD, FLOWISE_SECRETKEY_OVERWRITE
docker compose -f docker-compose.yaml -f docker-compose.flowise.yaml up --build
# Flowise UI: http://localhost:3000
```

For Kubernetes, apply `k8s/system-a/flowise.yaml` after creating the
`flowise-auth` Secret; the UI is exposed at NodePort 31300. Full
instructions, flow specs for the three demo scenarios, and configuration
notes live in `docs/flowise-integration.md` and `config/flowise/`.

## Scripts
- `scripts/install-openclaw-operator.sh` — install the external `openclaw-operator` (upstream project; see `docs/operator-install.md`). Defaults to dry-run; pin `OPENCLAW_OPERATOR_REF=<tag|sha>` and pass `APPLY=1` to actually apply.
- `scripts/check-operator-prereqs.sh` — checklist for operator-managed instance prerequisites
- `scripts/smoke-test-operator-instance.sh` — operator lifecycle validation checklist
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
6. Then add System B offload behavior (scale-up is satisfied by static
   `large` profile selection — no separate scale-up contract)

## Repo curation notes
- `config/` is the canonical location for current live demo/runtime config
- `runtimes/control-plane/` is the canonical control-plane implementation (offload relay, artifact relay)
- The deprecated raw control-plane/session-pod path previously kept in `legacy/` and `scripts/legacy/` has been removed; the operator-first path is the only supported lifecycle
