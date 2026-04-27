# OpenClaw Agentic Intel Web Demo

Static web demo surface for showing:

- OpenClaw orchestration
- LiteLLM model routing
- SambaNova inference
- System A (CWF) and System B (GNR) execution paths
- run context explaining what answers where and why

## Which path do I want?

This `web-demo/` is the static front-end only. Two panels in the UI —
"Run demo" (live backend mode) and "Agent command" — need a real
control-plane on `/api/*`. Without a backend, the Platform health rail
stays "probing" and Agent command renders "Backend not detected".

Pick one:

- **Static-only (Tier 0 — UX walkthrough, no backend).** Run this
  directory with any static server. The Run demo button falls back to
  the scripted walkthrough; Agent command is disabled.
- **Full local stack (Tier 1 — recommended).** From the repo root, run
  `docker compose up --build` (or `scripts/dev-up.sh` when container
  registries are blocked). That brings up MinIO, the agent-stub, the
  offload-worker, and the control-plane behind this UI's `/api`
  proxy. See the repo root `README.md` for prerequisites, ports, and
  teardown.

## Run static-only (Tier 0)

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Run static-only in Docker

```bash
docker build -t web-demo:local ./web-demo
docker run --rm -p 8080:8080 web-demo:local
```

The container is `nginx:alpine` serving the static files on port 8080 with
basic security headers set. In compose, the same image is the front-end
and `nginx.conf` reverse-proxies `/api/*` to the control-plane service.
Override `WEB_DEMO_CONTROL_PLANE_URL` when the UI must talk to an
already-running control-plane, for example
`WEB_DEMO_CONTROL_PLANE_URL=http://127.0.0.1:31001` for the System A
`control-plane-offload` NodePort.

## Deploy to Kubernetes

```bash
WEB_DEMO_IMAGE=ghcr.io/your-org/web-demo:latest \
  envsubst < k8s/shared/web-demo.yaml | kubectl apply -f -
```

This creates a `web-demo` namespace with a 2-replica Deployment and ClusterIP
Service on port 80. By default `/api/*` is proxied to
`http://control-plane-offload.platform.svc.cluster.local:8080`, so a public
production/demo deployment exercises `web-demo -> System A control-plane-offload
-> System B offload-worker` rather than a developer-local worker. Override the
`WEB_DEMO_CONTROL_PLANE_URL` env var in the Deployment if your System A
control-plane is exposed through a different FQDN or through the NodePort
(`http://<system-a-host>:31001`). Expose the web-demo Service with the ingress
of your choice.

## Smoke tests

A small Playwright suite validates that the page loads, each scenario card
populates the tool activity panel with ≥3 rows, and the walkthrough completes
end-to-end.

```bash
cd web-demo
npm install
npx playwright install --with-deps chromium
python3 -m http.server 8080 &
BASE_URL=http://localhost:8080 npx playwright test
```

The same suite runs in CI on every PR (`.github/workflows/test.yml`,
`web-demo-smoke` job).

## UI walkthrough

The page is laid out as one column of stacked panels. Top to bottom:

### 1. Platform health rail
Five dots, one per upstream service: OpenClaw, LiteLLM, SambaNova, System
A (control-plane), System B (offload-worker). Each dot polls `/api/probe/{name}`
(the control-plane probe endpoint — see `docs/api-reference.md`) and renders
one of four states:

| Class | Dot colour | aria-label | Meaning |
|-------|-----------|------------|---------|
| `ok` | green | `healthy` | Target answered 2xx within the timeout |
| `warn` | yellow | `degraded` | Initial state, OR control-plane up but worker not ready (System B only) |
| `down` | red | `unreachable` | Target probed and failed (timeout / non-2xx / network error) |
| `idle` | grey | `not configured` | No URL configured for this probe (env var unset) |
| `unknown` | grey | `reachability unknown` | Control plane is down, so we genuinely cannot probe upstream — distinct from "broken" |

`idle` and `unknown` both render grey but mean different things: `idle`
is "operator deliberately didn't wire this", `unknown` is "we tried but
couldn't tell". Both are honest; neither is a false-OK. See
`docs/health-probes.md` for the full state model.

### 2. Hero / scenario picker
Two primary buttons:
- **Run demo** — runs the scripted walkthrough. Falls back to a static
  scripted run if the control plane isn't reachable; uses live backend
  data when it is.
- **Reset demo** — clears the run state, hides the services panel,
  resets the architecture diagram and tool activity log.

Below: a horizontally-scrollable card row of demo scenarios pulled from
`catalog/scenarios.yaml`. Clicking a card runs that scenario through the
walkthrough. The scenarios shipped today are:
`terminal-agent`, `market-research`, `large-build-test`.

### 3. Architecture diagram
Three bands stacked top-to-bottom:
- **Orchestration band** (shared) — Telegram, OpenClaw, LiteLLM.
- **System A** — control-plane and the active session pods. The
  capacity bar at top-right shows used / total vCPU.
- **System B** — offload-worker, vLLM, MinIO. Same capacity bar shape.

The cross-system arrow lights when an offload is in flight. Per-pod
chips populate live during a scenario run; clicking a chip surfaces the
matching log lines in the workspace panel further down.

### 4. Multi-agent fan-out
Spawn N concurrent sessions to demonstrate density. Picks scenario,
profile (`small` (default), `medium`, `large`), and count, then `POST /sessions/batch`
to the control plane. The session table polls `/sessions` and shows live
status per session (`Pending` → `Running` → `Completed`/`Failed`;
`Deleting` on termination).

The "backend" badge top-right reflects which backend the control plane
is using — `local` (in-memory simulation; the dev / docker-compose
default) or `kube` (real `batch/v1.Job`s in the `agents` namespace —
overridable via `AGENTS_NAMESPACE`).

`Clear list` only purges the local list; it does NOT delete sessions on
the backend. Use the per-row delete button to terminate a session.

### 5. Optional services panel (hidden until reachable)
Surfaces optional integrations the local stack can pick up:
Flowise (`:3000`), OpenWebUI (`:3030`), MinIO console (`:9001`). The
panel only appears if at least one of them probes successfully.

### 6. Agent console
A free-form input wired to `/api/agent/command`, which forwards to the
agent-stub's `/tools/invoke` (Tier 1) or to the operator-managed agent
gateway (Tier 2). Output rendering:
- **Status line** — what the agent decided to do and why
  (classifier rationale).
- **Command log** — full tool trace, stdout/stderr, and elapsed time.

Available tools and the deterministic / LLM-backed classifier are
documented in `docs/agent-tool-reference.md`. If the control plane is
unreachable the input shows "Backend not detected" and disables submit.

### 7. Workspace + tool activity
The bottom panel renders the most recent scenario run:
- **Command log** — every shell / tool invocation in order.
- **Metrics grid** — counters wired up by `app.js` (commands run, tools
  invoked, artifacts produced, elapsed seconds).
- **Tool activity** — short one-liner per step, suitable for a
  presentation overlay.
- **Result** — final structured summary returned by the agent.
- **Console** — raw stream output.

## Other entry points

- `service-views.html` — "Behind the scenes" view: per-service
  status, log tails, and config snapshots.
- `scalability.html` — "Scalability story": density, throughput, and
  the frontier-API spend displaced per day on synthetic data.

## Backend env vars that affect the UI

The web demo is purely static; everything dynamic is rendered from
control-plane responses. Relevant control-plane env vars (consumed by
`runtimes/control-plane/app.py`):

| Var | Effect on the UI |
|-----|------------------|
| `OPENCLAW_GATEWAY_URL` | OpenClaw dot — `idle` (grey, "not configured") if blank |
| `LITELLM_BASE_URL` | LiteLLM dot — `idle` (grey, "not configured") if blank |
| `SAMBANOVA_PROBE_URL` | SambaNova dot — `idle` (grey, "not configured") if blank |
| `SESSION_BACKEND` | Multi-agent fan-out badge (`local` / `kube`) |
| `MINIO_ENDPOINT` | Whether artifact links resolve |

A full reference is in `docs/api-reference.md`.

## Troubleshooting

- **All dots stay yellow ("warn").** That's the initial state — the
  first probe hasn't returned yet. If they stay yellow, the backend
  isn't reachable. Check `curl http://localhost:8090/health` (compose
  exposes the control plane on host port 8090). In
  static-only mode this is expected.
- **OpenClaw / SambaNova dots show grey "not configured".** The control
  plane doesn't have a URL configured for that probe. See env var table
  above. Not a failure — the rail is reporting honestly.
- **Upstream dots show grey "reachability unknown".** Control plane is
  down, so the UI can't tell whether System B / OpenClaw / etc. are
  healthy. Fix the control plane first; the upstream dots will
  re-resolve on the next probe tick.
- **Multi-agent panel says "backend: probing…" indefinitely.** The
  `/sessions` endpoint isn't responding. Verify `SESSION_BACKEND` env
  resolves a valid backend at startup; check the control-plane logs for
  the "session backend: ..." line.
- **Agent command says "Backend not detected".** The `/api/agent/*`
  proxy isn't wired up. In compose this means nginx-in-the-web-demo
  container is up but the agent-stub container isn't.
