# Agentic Execution on Intel CPUs Demo

Demo-first repository area for a reproducible two-system prototype:
- System A: Intel CPU Kubernetes environment for OpenClaw instances managed by `openclaw-operator`
- System B: GNR Intel CPU Kubernetes environment for local SLM, offload analytics, and shared services

## Where to start

| You want to… | Go to |
|---|---|
| **Run the shipped demo end-to-end** | `docs/runbooks/tier2-bring-up.md` |
| Understand what the demo does before reading any setup | `docs/demo-overview.md` |
| Develop / debug the control-plane or offload-worker locally | "Local dev/smoke (Tier 1)" below |
| Add a new scenario | `docs/scenario-spec.md` + `templates/scenarios/` |
| Deploy on a different topology (single-node, multi-system) | `docs/architecture-spec.md` + `templates/architecture/` |
| Contribute | `CONTRIBUTING.md` |

## Goals
- Keep the user interacting with an agent, not with Kubernetes or physical systems
- Manage OpenClaw instance lifecycle only through `openclaw-operator`
- Support 3 demo scenarios:
  1. Terminal agent
  2. Market research report with GNR offload
  3. Local build/test with scale-up on System A
- Prefer ready-made components over custom platform work

## Documents

### Start here
- **`docs/runbooks/tier2-bring-up.md` — canonical "from empty cluster to demo task" runbook. The only path that runs the shipped demo end-to-end.**
- `docs/demo-overview.md` — one-page operating model (Telegram-first entry, two-system execution).
- `docs/demo-setup.md` — tiered bring-up reference. Tier 2 is the demo path; Tier 0 / Tier 1 are local dev/smoke.

### Architecture and contracts
- `docs/architecture.md` — architecture breakdown and execution model for the shipped two-system reference.
- `docs/architecture-spec.md` — pluggable architecture spec (1..N clusters, pluggable token providers).
- `docs/architecture-variants.md` — how architecture differs per execution mode (`local-standard` / `local-large` / `offload`).
- `docs/contracts/session-lifecycle.md` — System A-owned lifecycle and user-visible state model.
- `docs/contracts/task-routing.md` — policy-driven routing for standard, local-large, and offload paths.
- `docs/contracts/offload-result-contract.md` — strict System A ↔ System B execution/result boundary.

### Operator and reproducibility
- `docs/operator-install.md` — how to install the upstream `openclaw-operator`.
- `docs/operator-runbook.md` — operator install/recovery notes and known CRD blocker.
- `docs/reproducibility.md` — values to fill in, secrets to provision, recovery playbook.
- `docs/versions-tested.md` — combinations validated end-to-end (single source of truth for "what works").
- `docs/port-map.md` — fixed NodePort assignments and k3s install flags.

### References
- `docs/api-reference.md` — control-plane HTTP contract.
- `docs/agent-tool-reference.md` — tool registry exposed to the agent.
- `docs/health-probes.md` — what `/health`, `/ready`, `/probe/*` mean per component.
- `docs/scenario-spec.md` — requirements and acceptance checklist for authoring new demo scenarios.
- `docs/implementation-guide.md` — implementation notes and migration context.
- `docs/reusable-components.md` — what to reuse vs what to build.
- `docs/flowise-integration.md`, `docs/sambanova-integration.md` — optional integrations.

### Internal / archive (skip on first read)
- `docs/internal/operator-gap-analysis.md` — open-gap tracker for operator-first reproducibility.
- `docs/internal/operator-config-checklist.md` — readiness checklist (🔴/🟡/✅), maintainer-facing.
- `docs/internal/improvement-plan.md` — audit-style analysis snapshot (2026-04 trial run).
- `docs/archive/mvp-plan.md` — historical pre-operator path.

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

Use `docs/operator-runbook.md` and `docs/internal/operator-gap-analysis.md` as the source of truth for operator-specific bring-up and remaining work.

## Local dev/smoke (Tier 1, no cluster)

> Tier 1 is a developer convenience — it does **not** run the demo as
> an audience would see it. For the shipped demo path, follow
> `docs/runbooks/tier2-bring-up.md`.

Top-level shortcuts live in the `Makefile` — `make help` prints the
canonical verbs (`make tier0` / `make tier1-up` / `make tier2-smoke`,
plus `make lint` and `make test`). The raw commands below still work
identically.

For a single-host dev loop without Kubernetes, the repo ships a
`docker-compose.yaml` that brings up MinIO, the agent-stub, the
offload-worker, the control plane, and the static web UI with an `/api`
reverse proxy:

```bash
docker compose up --build
# open http://localhost:8080 — "Run walkthrough" submits a real shell task
# via the control plane and renders the worker stdout in the demo UI. The
# "Agent command" panel only works once this stack is up.
```

Ports bound on `127.0.0.1`: `8080` (web UI + `/api` proxy), `8090`
(control-plane, debug), `9000` (MinIO S3 API), `9001` (MinIO console). Make
sure those are free, or override them via the env (the optional Flowise /
OpenWebUI overlays add `3000` / `3030`).

The control-plane writes the offload-job registry and the local-backend
session table to a `control-plane-data` named volume (mounted at
`/var/lib/control-plane`), so a `docker compose restart control-plane`
preserves issued `result_ref`s and the multi-agent fan-out table. Set
`JOBS_DB_PATH=:memory:` (and/or `SESSIONS_DB_PATH=:memory:`) on the
service to opt out and go back to the legacy in-memory behavior; `docker
compose down -v` drops the volume.

Verify the stack came up before clicking through the UI:

```bash
docker compose ps                      # agent-stub / offload-worker / control-plane
                                       # should be "healthy"; minio is "running" (no
                                       # healthcheck) and minio-init exits 0 after
                                       # creating the bucket
curl -fsS http://localhost:8080/api/health   # control-plane via the nginx /api proxy
curl -fsS http://localhost:8080/api/ready    # 200 once dependencies are wired
```

Optional overrides go in a `.env` file at the repo root (see
`.env.example`): `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`,
`OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN` (point `agent_invoke`
at a remote OpenClaw instead of the in-compose `agent-stub`),
`LITELLM_BASE_URL`, `SAMBANOVA_PROBE_URL`. Anything left unset falls back
to the bundled stub or stays "unwired" in the Platform health rail.

Teardown:

```bash
docker compose down            # stop containers, keep the MinIO volume
docker compose down -v         # also drop the minio-data volume
```

### Local bring-up without Docker

When container registries (quay.io, docker.io, ghcr.io) aren't reachable —
restricted networks, sandboxes, air-gapped CI — `scripts/dev-up.sh` brings
up the same four services from a Python venv, with `moto[server]` standing
in for MinIO. Requires `python3` (3.10+) with the `venv` module and a
POSIX shell (Linux / macOS).

```bash
./scripts/dev-up.sh        # creates .dev-up/venv + starts everything
# open http://127.0.0.1:8080 — same UI, same /api/* contract
./scripts/dev-down.sh      # stops everything
```

This path binds `127.0.0.1` ports `8080` (web proxy), `8090`
(control-plane), `8001` (agent-stub), `8002` (offload-worker), and `9000`
(moto S3). Override any of them via `WEB_DEMO_PORT`, `CONTROL_PLANE_PORT`,
`AGENT_STUB_PORT`, `OFFLOAD_WORKER_PORT`, `MOTO_PORT` before running
`dev-up.sh`.

State (venv, logs, pid files) lives under `.dev-up/`. To target a real
LiteLLM/SambaNova endpoint, export `LITELLM_BASE_URL` /
`SAMBANOVA_PROBE_URL` before `dev-up.sh` — the "Platform health" rail
probes them honestly via `/api/probe/{name}` and stays neutral when
nothing is configured.

`task_type=shell` is fully self-contained on this path. `task_type=agent_invoke`
is also wired locally: an `agent-stub` container stands in for the OpenClaw
gateway and exposes `POST /tools/invoke` with a small allow-listed tool set
(`shell`, `read_file`, `list_files`, `summarize`, `echo`, plus a `command`
classifier). The web UI exposes an "Agent command" input that submits free-form
text through `agent_invoke` and renders the agent's chosen tool, trace, and
output. To target a real remote OpenClaw instead of the stub, set
`OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` in your shell before
`docker compose up`.

### Long-lived agents vs short-lived tasks

The demo distinguishes two concepts:

* **Agent (long-lived)** — a registered, addressable runtime that stays
  up across many tasks. Two kinds today: **OpenClaw** (one
  `OpenClawInstance`, managed by `openclaw-operator`) and **Flowise**
  (one chatflow inside a Flowise Deployment). The pool is declared in
  `config/agents.yaml` and surfaced read-only via `GET /api/agents` and
  the "Agents (long-lived)" panel in the web UI. Lifecycle stays
  operator-driven: OpenClaw agents are added through the operator path
  (`scripts/install-openclaw-operator.sh` + smoke tests), Flowise
  chatflows through the documented one-time UI step in
  `docs/flowise-integration.md`. The control plane never writes CRs.
* **Task (short-lived)** — one unit of work spawned through the
  `/sessions` API (kept on that wire path for backwards compatibility;
  the UI labels them "tasks"). Today's fan-out spawns ephemeral Jobs;
  with the new optional `agent_id` field on `POST /sessions`, every
  task can be attributed to a registered agent and rendered in the
  Agent column of the table.

In Tier 2 the kube backend overlays live cluster status (CR phase,
Deployment readiness) on top of each seed agent; in Tier 1 the seed is
shown as-is with `status: Unknown`.

### Multi-agent fan-out (concurrent sessions)

The control plane exposes a `/sessions` API for spawning many agent
workloads concurrently — the original demo only supported one running
agent at a time. Two backends:

* **Local** (default for `docker compose up` / `dev-up.sh`) — in-memory
  state-machine simulator. Sessions transition `Pending → Running →
  Completed` on a wall-clock timer; useful for showing the multi-agent
  story without spinning up a real cluster.
* **Kube** (in the k8s deployment) — every session becomes one
  `batch/v1.Job` from `k8s/system-a/session-job-template.yaml`, sized
  by the requested profile (`small` / `medium` / `large`). Status is
  read back from the Job's `Complete` / `Failed` conditions.
  `ttlSecondsAfterFinished` lets k8s GC finished sessions for you.

Two ways to drive it:

```bash
# CLI: fan out 10 medium market-research sessions, then watch
scripts/load-simulate.sh -s market-research -p medium -c 10 -w

# CLI: same fan-out, but explicitly pin every spawned session to System B
scripts/load-simulate.sh -s market-research -p medium -c 10 -t system_b -w

# Web UI: the "Multi-agent fan-out" panel on http://localhost:8080 —
# pick scenario / profile / target system / count, hit Spawn, watch the
# table update. The target-system picker selects which demo system runs
# the spawned agents (System A, System B, or the scenario default);
# system_b-targeted sessions render in the System B pool of the
# architecture diagram.
```

The k8s side also ships `k8s/system-b/offload-worker-hpa.yaml`, a CPU-
based HPA that scales the shared offload-worker between 1 and 12
replicas so concurrent sessions don't all queue on one worker.
Architecture details and the full status-mapping table live in
`docs/architecture.md` under "Sessions API — multi-agent fan-out".

### Optional: Flowise alt orchestrator

Flowise (visual flow builder) is shipped as an opt-in overlay. The overlay
also brings up the LiteLLM gateway it depends on (mock-default, opt-in
real providers) and a one-shot seeder that pre-creates the credential and
Variables every flow expects, so `compose up` boots end-to-end:

```bash
# .env: FLOWISE_USERNAME, FLOWISE_PASSWORD, FLOWISE_SECRETKEY_OVERWRITE
eval "$(scripts/lib/load-versions.sh)"   # pin LITELLM_IMAGE
docker compose -f docker-compose.yaml -f docker-compose.flowise.yaml up --build
# Flowise UI: http://localhost:3000   (login with the FLOWISE_* values)
# LiteLLM:    http://localhost:4000   (OpenAI-compatible /v1/*)
```

The chatflow itself is still a one-time UI step — follow
`config/flowise/flows/terminal-agent.md` to drop in the four nodes; the
`litellm-openai` credential and the `LITELLM_BASE_URL` /
`CONTROL_PLANE_BASE_URL` Variables it references are already there.

For Kubernetes, apply `k8s/system-a/flowise.yaml` after creating the
`flowise-auth` Secret; the UI is exposed at NodePort 31300. Full
instructions, flow specs for the three demo scenarios, and configuration
notes live in `docs/flowise-integration.md` and `config/flowise/`.

### Optional: OpenWebUI direct-chat surface

OpenWebUI ships as an opt-in overlay alongside the Flowise overlay above:

```bash
docker compose -f docker-compose.yaml -f docker-compose.openwebui.yaml up --build
# OpenWebUI: http://localhost:3030 (defaults to LiteLLM at /v1)
```

Stack both overlays together with `-f docker-compose.yaml -f docker-compose.flowise.yaml -f docker-compose.openwebui.yaml up`.

### Service launchers panel

The web demo carries a "Service launchers" section that probes MinIO,
Flowise, the LiteLLM admin UI, and OpenWebUI on their default localhost
ports. Cards are shown only for services that respond, so leaving the
overlays off simply hides them. To hide the entire panel, click "Hide
panel" (persisted to localStorage) or load the page with `?services=off`;
clicking "Reset demo" brings it back. URLs can be overridden by setting
the `demoServices` localStorage key to a JSON array.

## Scripts

### Tier 2 (operator-first demo path)
- `scripts/check-tier2-environment.sh` — preflight the deploy workstation: kubectl on PATH, `system-a`/`system-b` contexts, API reachability, namespace/CRD/controller state. Read-only; run before anything else.
- `scripts/check-upstream-pins.sh` — pre-cluster validation that every pinned image/tag actually resolves (GitHub release + GHCR/Docker Hub manifests). Catches the "operator runtime image is private" class of bring-up failures.
- `scripts/install-openclaw-operator.sh` — install the external `openclaw-operator` (upstream project; see `docs/operator-install.md`). Defaults to dry-run; pin `OPENCLAW_OPERATOR_REF=<tag|sha>` and pass `APPLY=1` to actually apply.
- `scripts/create-operator-secrets.sh` — render every Secret the demo expects (operator instance, LiteLLM, agent pod, MinIO) from env via `kubectl --dry-run=client | kubectl apply`. `SCOPE=system-a|system-b|all` for two-cluster bring-up.
- `scripts/verify-operator-secrets.sh` — confirm each Secret exists with the expected keys, **without ever reading values**. Pairs with `create-operator-secrets.sh`.
- `scripts/check-telegram-routing.sh` — verify the bot token + slash-command menu before any human DM (Telegram Bot API only; no cluster).
- `scripts/check-operator-prereqs.sh` — checklist for operator-managed instance prerequisites
- `scripts/smoke-test-operator-instance.sh` — operator lifecycle validation (CRD + controller + `OpenClawInstance` reaches Ready + gateway `/healthz`)
- `scripts/smoke-test-demo-task.sh` — six-step live demo-task verification: instance phase, gateway, LiteLLM chat completion, Telegram config, `tools.exec` config, session-pod env-name wiring (no values read).
- `scripts/smoke-test-offload-k8s.sh` — Tier 2 offload roundtrip: System A control-plane → System B offload-worker → MinIO artifact.
- `scripts/check-openclaw-tools.sh` — scan recent session-pod logs for tool-invocation traces (run after DM-ing /demo).
- `scripts/check-tier2-logs.sh` — canonical live-logs helper (operator/session/gateway/litellm/vllm/offload/minio) with the right `--context` for each.
- `scripts/archive/setup-system-b-vllm.sh` — archived; historical SSH-into-`onedal-build` vLLM bring-up. Use `scripts/setup-system-b-vllm-local.sh` instead.
- `scripts/setup-system-b-vllm-local.sh` — kubectl/helm vLLM bring-up against the current kube context (no SSH)
- `scripts/check-system-b-vllm.sh` — validate running vLLM setup and context length
- `scripts/load-offload-worker-image.sh` — build + load the offload-worker image into k3s/k3d when GHCR is unreachable
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

## Recommended first slice (Tier 2, operator-first)
The demo path is **operator-first**: every `OpenClawInstance` is managed
by `openclaw-operator`, and Tier 2 is the only path that runs the
shipped demo end-to-end (Telegram, Bedrock/SambaNova/vLLM, offload).

Follow `docs/runbooks/tier2-bring-up.md`. The short version:

0. **Preflight** the workstation (`./scripts/check-tier2-environment.sh`)
1. Bring up System B model backend + storage (vLLM, MinIO, offload-worker)
2. Bring up System A inference proxy (LiteLLM) and secrets
3. Install `openclaw-operator`, apply one `OpenClawInstance`, smoke-test
   the lifecycle (`./scripts/smoke-test-operator-instance.sh`)
4. Smoke-test the live demo task (`./scripts/smoke-test-demo-task.sh`)
   — confirms gateway `/healthz`, LiteLLM completion, Telegram-bound
   config, and (optionally) the System A → System B offload roundtrip
   (`./scripts/smoke-test-offload-k8s.sh`).

Tier 1 (`docker compose up` / `scripts/dev-up.sh`) is **local dev/smoke
only** — it exercises the offload relay and the static web UI without a
cluster. It does NOT run OpenClaw, LiteLLM, vLLM, or Telegram, so it is
not the "demo path" an audience would see. Use it to develop the
control-plane / offload-worker locally, not to demo to users.

## Repo curation notes
- `config/` is the canonical location for current live demo/runtime config
- `runtimes/control-plane/` is the canonical control-plane implementation (offload relay, artifact relay)
- The deprecated raw control-plane/session-pod path previously kept in `legacy/` and `scripts/legacy/` has been removed; the operator-first path is the only supported lifecycle
