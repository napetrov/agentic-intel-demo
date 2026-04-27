# Agentic Execution on Intel CPUs Demo

Demo-first repository area for a reproducible two-system prototype:

- **System A** — Intel CPU Kubernetes environment for OpenClaw instances managed by `openclaw-operator`.
- **System B** — GNR Intel CPU Kubernetes environment for vLLM, MinIO, and offload analytics.

## Where to start

| You want to… | Go to |
|---|---|
| **Run the shipped demo end-to-end** | [docs/runbooks/tier2-bring-up.md](docs/runbooks/tier2-bring-up.md) |
| Understand what the demo does | [docs/demo-overview.md](docs/demo-overview.md) |
| Develop / debug locally without a cluster | "Local dev (Tier 1)" below + [docs/demo-setup.md](docs/demo-setup.md) |
| Find a file in the repo | [docs/repo-layout.md](docs/repo-layout.md) |
| Add a new scenario or topology | [templates/scenarios/](templates/scenarios/), [templates/architecture/](templates/architecture/) |
| Pre-demo checklist / incident recovery | [demo-checklist](docs/runbooks/demo-checklist.md), [incident-recovery](docs/runbooks/incident-recovery.md) |
| Contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Goals

- Keep the user interacting with an agent, not with Kubernetes.
- Manage `OpenClawInstance` lifecycle only through `openclaw-operator`.
- Ship three scenarios: terminal agent, market research with GNR offload, and local build/test with scale-up on System A.
- Prefer ready-made components over custom platform work.

## Documents

**Start here**
- **[docs/runbooks/tier2-bring-up.md](docs/runbooks/tier2-bring-up.md)** — canonical "empty cluster → demo task". The only path that runs the shipped demo end-to-end.
- [docs/demo-overview.md](docs/demo-overview.md) — one-page operating model.
- [docs/demo-setup.md](docs/demo-setup.md) — tiered bring-up reference (Tier 0/1/2).
- [docs/repo-layout.md](docs/repo-layout.md) — annotated tree.

**Runbooks** — [tier2-bring-up](docs/runbooks/tier2-bring-up.md), [demo-checklist](docs/runbooks/demo-checklist.md), [incident-recovery](docs/runbooks/incident-recovery.md).

**Architecture and contracts** — [architecture](docs/architecture.md), [architecture-spec](docs/architecture-spec.md), [architecture-variants](docs/architecture-variants.md), [session-lifecycle](docs/contracts/session-lifecycle.md), [task-routing](docs/contracts/task-routing.md), [offload-result-contract](docs/contracts/offload-result-contract.md).

**Operator and reproducibility** — [operator-install](docs/operator-install.md), [operator-runbook](docs/operator-runbook.md), [telegram-operator-checklist](docs/telegram-operator-checklist.md), [reproducibility](docs/reproducibility.md), [versions-tested](docs/versions-tested.md), [single-node-validation](docs/single-node-validation.md), [port-map](docs/port-map.md).

**References** — [api-reference](docs/api-reference.md), [agent-tool-reference](docs/agent-tool-reference.md), [health-probes](docs/health-probes.md), [scenario-spec](docs/scenario-spec.md), [implementation-guide](docs/implementation-guide.md), [reusable-components](docs/reusable-components.md), [flowise-integration](docs/flowise-integration.md), [sambanova-integration](docs/sambanova-integration.md).

**Internal / archive** (skip on first read) — [operator-gap-analysis](docs/internal/operator-gap-analysis.md), [operator-config-checklist](docs/internal/operator-config-checklist.md), [improvement-plan](docs/internal/improvement-plan.md), [mvp-plan (archived)](docs/archive/mvp-plan.md).

## Repository layout

[docs/repo-layout.md](docs/repo-layout.md) is the canonical, annotated tree. The top-level pieces:

| Path | What's there |
|---|---|
| `docs/` | Runbooks, contracts, references, internal/archive notes. |
| `runtimes/` | In-repo container code: `control-plane/`, `offload-worker/`, `agent-stub/`. |
| `web-demo/` | Static front-end (`index.html`, `service-views.html`, `scalability.html`) + nginx `/api/*` proxy. |
| `agents/` | Orchestrator + scenario / task instructions consumed at runtime. |
| `catalog/` | Declarative inputs: `scenarios.yaml`, `tasks.yaml`. |
| `config/` | Live config: `agents.yaml`, `demo-systems.yaml`, `model-routing/`, `pod-profiles/`, `task-types/`, `flowise/`, `versions.yaml`. |
| `templates/` | Copy-and-fill templates for new scenarios and architectures, with worked examples. |
| `schemas/` | JSON Schemas for the declarative inputs (enforced in CI). |
| `k8s/` | Tier 2 manifests, split by `system-a/` / `system-b/` / `shared/`. |
| `examples/` | The shipped `OpenClawInstance` spec the operator applies. |
| `scripts/` | Tier 1 and Tier 2 helpers (`make help` lists every wrapper). |
| `Makefile` | Top-level verbs: `make help`, `make all` (lint + test), `make tier{0,1,2}-*`, `make validate-templates`, `make clean`. |

## Tier 2 — shipped demo path

The demo path is **operator-first**: every `OpenClawInstance` is managed by `openclaw-operator`, and Tier 2 is the only path that runs the shipped demo end-to-end (Telegram, Bedrock/SambaNova/vLLM, offload).

Follow [docs/runbooks/tier2-bring-up.md](docs/runbooks/tier2-bring-up.md). The short version:

0. Preflight the workstation (`./scripts/check-tier2-environment.sh`).
1. Bring up System B (vLLM + MinIO + offload-worker).
2. Bring up System A (LiteLLM + secrets).
3. Install `openclaw-operator`, apply one `OpenClawInstance`, smoke-test the lifecycle.
4. Smoke-test the live demo task and the System A → System B offload roundtrip.

Validated direction: operator-first lifecycle, **vLLM** on System B (`Qwen/Qwen3-4B-Instruct-2507`, ctx `32768`, 16 CPU / 32Gi), and the offload relay (`POST /offload`, `GET /offload/{job_id}`, `GET /artifacts/{ref}`) in `runtimes/control-plane/`. The `tier1-scenario-slice` CI job exercises the full scenario → control-plane → offload-worker → MinIO path.

## Local dev (Tier 1, no cluster)

> Tier 1 is dev/smoke only — it does **not** run OpenClaw, LiteLLM, vLLM, or Telegram. For the audience-facing demo path, follow [docs/runbooks/tier2-bring-up.md](docs/runbooks/tier2-bring-up.md).

`make help` lists the wrappers. The minimum bring-up:

```bash
docker compose up --build
# http://localhost:8080 — "Run demo" submits a real task; "Behind the scenes"
# and "Scalability story" link to web-demo/{service-views,scalability}.html.
# "Agent command" requires this stack to be up.
```

Ports bound on `127.0.0.1`: `8080` (web UI + `/api`), `8090` (control-plane), `9000` / `9001` (MinIO).

When container registries are blocked (sandboxes / air-gapped CI), `scripts/dev-up.sh` brings up the same stack from a Python venv with `moto[server]` standing in for MinIO. Same `/api/*` contract.

`config/agents.yaml` declares the long-lived agent pool; the control plane exposes it read-only via `GET /api/agents`. Short-lived tasks go through `POST /sessions` (multi-agent fan-out, status polled in the web UI). Optional Flowise / OpenWebUI overlays add `:3000` / `:3030`.

Full env vars, persistence, multi-agent fan-out, overlay setup, and the service-launchers panel are documented in [docs/demo-setup.md](docs/demo-setup.md), [docs/architecture.md](docs/architecture.md), [docs/flowise-integration.md](docs/flowise-integration.md), and [web-demo/README.md](web-demo/README.md).

## Authoring

- **New scenario** — [docs/scenario-spec.md](docs/scenario-spec.md) + [templates/scenarios/](templates/scenarios/) (template files plus one worked example per execution variant under `templates/scenarios/examples/`).
- **New architecture / topology** — [docs/architecture-spec.md](docs/architecture-spec.md) + [templates/architecture/](templates/architecture/) (single-node, two-system, multi-system, cloud-provider-mix).
- Run `python3 scripts/validate-demo-templates.py` (or `make validate-templates`) to check scenarios, tasks, and architecture files for consistency. Same check runs in CI as `validate-templates`.

## Guiding principles

- Demo first, not platform first.
- Start with the shortest end-to-end path; prefer explicit flows over hidden automation.
- System A owns session state, routing policy, and user-visible status. System B is an execution backend, not a second control plane.
- Guided Telegram UX is the default; freeform chat is explicit.
- Keep inference, routing, and execution policies declarative.
- Reuse OpenClaw, Kubernetes, LiteLLM, Terminal Bench, and an OpenAI-compatible local SLM where possible.
