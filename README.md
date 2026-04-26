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
- `docs/archive/mvp-plan.md` — historical context; describes the removed raw control-plane/session-pod path. Current minimum path lives in `docs/demo-setup.md` and `docs/operator-runbook.md`.
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

Top-level shortcuts live in the `Makefile` — `make help` prints the
canonical verbs (`make tier0` / `make tier1-up` / `make tier2-smoke`,
plus `make lint` and `make test`). The raw commands below still work
identically.

For a single-host demo without Kubernetes, the repo ships a
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

# Web UI: the "Multi-agent fan-out" panel on http://localhost:8080 —
# pick scenario / profile / count, hit Spawn, watch the table update.
```

The k8s side also ships `k8s/system-b/offload-worker-hpa.yaml`, a CPU-
based HPA that scales the shared offload-worker between 1 and 12
replicas so concurrent sessions don't all queue on one worker.
Architecture details and the full status-mapping table live in
`docs/architecture.md` under "Sessions API — multi-agent fan-out".

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
- `scripts/install-openclaw-operator.sh` — install the external `openclaw-operator` (upstream project; see `docs/operator-install.md`). Defaults to dry-run; pin `OPENCLAW_OPERATOR_REF=<tag|sha>` and pass `APPLY=1` to actually apply.
- `scripts/create-operator-secrets.sh` — render every Secret the demo expects (operator instance, LiteLLM, agent pod, MinIO) from env via `kubectl --dry-run=client | kubectl apply`. `SCOPE=system-a|system-b|all` for two-cluster bring-up.
- `scripts/check-operator-prereqs.sh` — checklist for operator-managed instance prerequisites
- `scripts/smoke-test-operator-instance.sh` — operator lifecycle validation checklist
- `scripts/setup-system-b-vllm.sh` — historical SSH-into-`onedal-build` vLLM bring-up
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
