# Flowise integration

Flowise is the **optional alternate orchestrator** referenced in the demo
architecture. The web demo's "Orchestration + Routing" band calls it out as
"optional alt orchestrator" alongside OpenClaw, but until now the repo did
not actually deploy it. This document covers what changed and how to use
it.

> **Status:** OpenClaw is still the primary, supported orchestration path
> for the demo. Flowise is provided so users who prefer a visual flow
> builder can drive the same backends (LiteLLM, control-plane offload,
> MinIO artifacts) without rewriting them.

## Where it sits

```
User ──▶ (Telegram / Web)
            │
            ▼
   ┌─────────────────────┐         ┌────────────────────┐
   │ OpenClaw (primary)  │   OR    │ Flowise (alt UI)   │
   └─────────┬───────────┘         └─────────┬──────────┘
             │                               │
             └──────────┬────────────────────┘
                        ▼
              LiteLLM gateway (System A)
                        │
        ┌───────────────┼─────────────────────────┐
        ▼               ▼                         ▼
   vLLM (System B)  Bedrock / SambaNova   Other providers
                        │
                        ▼
              control-plane (System A)
                        │
                        ▼
              offload-worker (System B) ──▶ MinIO
```

Both orchestrators share:
- `LITELLM_BASE_URL` — single model gateway.
- `CONTROL_PLANE_BASE_URL` — `POST /offload`, `GET /offload/{id}`, `GET /artifacts/{ref}`.

So a flow built in Flowise stays portable as long as it routes through
those two endpoints.

## Deployment options

### Docker (single host)

Bring up the base stack with the Flowise overlay:

```bash
# .env (sibling of docker-compose.yaml)
FLOWISE_USERNAME=admin
FLOWISE_PASSWORD=<choose-one>
FLOWISE_SECRETKEY_OVERWRITE=$(openssl rand -hex 32)
LITELLM_API_KEY=sk-demo-not-a-real-key
# Optional: activate any of the real providers declared in
# config/model-routing/litellm-compose.yaml.
# AWS_BEARER_TOKEN_BEDROCK=...
# SAMBANOVA_API_KEY=...
# OPENAI_API_KEY=...

eval "$(scripts/lib/load-versions.sh)"   # pin LITELLM_IMAGE from versions.yaml
docker compose -f docker-compose.yaml -f docker-compose.flowise.yaml up --build
# Flowise UI: http://localhost:3000  (login with the values above)
```

What the overlay brings up alongside Flowise:

1. **`litellm`** — the OpenAI-compatible model gateway, mounted from
   `config/model-routing/litellm-compose.yaml`. The `default`, `reasoning`,
   and `fast` aliases use LiteLLM's built-in `mock_response`, so the demo
   boots with **zero cloud credentials**: any caller that POSTs to
   `/v1/chat/completions` gets a deterministic canned reply, which is
   enough to prove the wire end-to-end. The `bedrock`, `sambanova`, and
   `openai` aliases activate when the matching env var is set.
2. **`flowise-seed`** — a one-shot container that polls Flowise's
   `/api/v1/ping`, then idempotently creates the `litellm-openai`
   credential and the `LITELLM_BASE_URL` / `CONTROL_PLANE_BASE_URL`
   Variables. Re-running `compose up` is a no-op once the records exist;
   rotating `LITELLM_API_KEY` in `.env` overwrites the credential on the
   next boot.

Building the actual flow is still a one-time UI step — see
`config/flowise/flows/terminal-agent.md` for the four nodes to drop in.
The credentials and variables the spec references are already there.

Notes:
- Flowise persists to a named docker volume `flowise-data`. The flow you
  build survives `docker compose down`; reset with `docker compose ... down -v`.
- The seeder uses Python stdlib only (image: `python:3.12-alpine`,
  bind-mounted from `scripts/flowise/seed.py`) so the overlay adds no
  package downloads beyond LiteLLM and Flowise themselves.

### Kubernetes (System A)

```bash
# Create the auth secret first.
kubectl -n agents create secret generic flowise-auth \
  --from-literal=username=admin \
  --from-literal=password="$(openssl rand -base64 24)" \
  --from-literal=secretkey="$(openssl rand -hex 32)"

kubectl apply -f k8s/system-a/flowise.yaml
kubectl -n agents rollout status deploy/flowise

# Reach the UI from outside the cluster:
#   http://<system-a-node-ip>:31300
```

The manifest creates:
- Namespace `agents` (shared with the OpenClawInstance namespace).
- 5Gi PVC `flowise-data` (RWO, sqlite + uploaded credentials).
- ConfigMap `flowise-config` (non-sensitive endpoints).
- Deployment `flowise` (single replica, `Recreate` strategy because of sqlite).
- Service `flowise` (ClusterIP) and `flowise-nodeport` (NodePort 31300).

## Configuration

| Setting | Compose (env) | k8s (location) |
|---------|---------------|----------------|
| Auth username | `FLOWISE_USERNAME` | secret `flowise-auth/username` |
| Auth password | `FLOWISE_PASSWORD` | secret `flowise-auth/password` |
| Encryption key | `FLOWISE_SECRETKEY_OVERWRITE` | secret `flowise-auth/secretkey` |
| LiteLLM endpoint | `LITELLM_BASE_URL` | configmap `flowise-config/LITELLM_BASE_URL` |
| Control-plane endpoint | `CONTROL_PLANE_BASE_URL` | configmap `flowise-config/CONTROL_PLANE_BASE_URL` |

Inside Flowise (Settings):
- Add a credential `litellm-openai` (type: OpenAI). Base URL = the
  `LITELLM_BASE_URL` value. Any non-empty API key works against a LiteLLM
  proxy without a master key set.
- Add Variables `CONTROL_PLANE_BASE_URL` and `LITELLM_BASE_URL` mirroring
  the env so Custom Tool node bodies can reference `$vars.<name>`.

## Tasks (flows) that ship as specs

Three flow specs are checked in under `config/flowise/flows/`. They map
1:1 to the three demo scenarios in `catalog/scenarios.yaml`:

| Spec file | Scenario | Execution mode |
|-----------|----------|----------------|
| `terminal-agent.md` | Terminal Agent | `local_standard` |
| `market-research.md` | Market Research | `offload_system_b` |
| `large-build-test.md` | Large Build/Test | `local_large` |

Each spec lists the exact nodes, system prompts, tool bodies, and wiring.
The repo deliberately avoids checking in Flowise's exported chatflow JSON
because it embeds the runtime version and breaks easily across upgrades —
specs are the authoring source of truth.

To rebuild a flow in the UI:
1. Open Flowise → New Chatflow.
2. Add the nodes listed under "Nodes" in the spec, in order.
3. Wire them per the "Wiring" diagram.
4. Paste the body of each Custom Tool from the spec verbatim.
5. Save with the chatflow name from the spec filename.

## Calling a flow

Once saved, each flow gets a stable Chatflow ID. Use it from anywhere:

```bash
curl -s "http://<flowise-host>:3000/api/v1/prediction/<chatflow-id>" \
  -H 'content-type: application/json' \
  -d '{
    "question": "show me free memory",
    "overrideConfig": { "session_id": "demo-1" }
  }'
```

Two integration patterns are supported:

1. **Browser → Flowise direct.** The web demo's UI can offer Flowise as a
   second "engine" choice next to OpenClaw, calling the prediction endpoint
   directly. Lowest-latency, no extra hop.
2. **Control-plane → Flowise as a `task_type`.** Add a new task type in
   `runtimes/control-plane/app.py` that forwards to a chatflow ID. This
   keeps every entry point (Telegram, web, API smoke tests) on a single
   contract.

Pattern (1) is the smaller change and is recommended for the first slice;
pattern (2) should follow only if the demo UX requires a single ingress
contract.

## Limits / known gaps

- Sqlite-backed; not horizontally scalable. For the demo scope this is
  fine — single replica, single host.
- Custom Tool sandboxing in Flowise allows full `fetch` access. The k8s
  manifest does not pin a NetworkPolicy; if you tighten egress on the
  `agents` namespace, allow-list `litellm.inference.svc.cluster.local` and
  `control-plane.platform.svc.cluster.local` so flows still work.
- The base `docker-compose.yaml` still does not include LiteLLM; the
  Flowise overlay adds it as a sibling so Flowise has a gateway to call
  out of the box. If you also bring up `docker-compose.openwebui.yaml`,
  OpenWebUI's default `OPENAI_API_BASE_URL` already points at this same
  `litellm` service by name — no extra wiring needed.
- The chatflow JSON itself is not auto-imported. Hand-authoring the
  Flowise 2.2.7 chatflow JSON without a live Flowise to export from is
  fragile (per-node `inputAnchors` / `outputAnchors` arrays must match
  the runtime component registry exactly), so the seeder stops at
  credentials + variables — the values the flow specs reference. Building
  the flow itself stays a one-time UI step.
- Telemetry is disabled by default (`DISABLE_FLOWISE_TELEMETRY=true`). Do
  not flip this on without reviewing what Flowise sends upstream.

## Related files

- `docker-compose.flowise.yaml` — overlay for the laptop bring-up (Flowise + LiteLLM + seeder)
- `config/model-routing/litellm-compose.yaml` — compose-mode LiteLLM config (mock-default, opt-in providers)
- `scripts/flowise/seed.py` — idempotent credential + variable seeder
- `k8s/system-a/flowise.yaml` — manifest for the System A cluster
- `config/flowise/README.md` — directory overview
- `config/flowise/flows/*.md` — per-scenario flow specs
- `docs/architecture.md`, `docs/architecture-spec.md` — primary architecture
- `docs/port-map.md` — port assignments (NodePort 31300 added for Flowise)
