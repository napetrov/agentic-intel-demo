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
LITELLM_BASE_URL=http://litellm:4000          # only if LiteLLM also runs in compose
LITELLM_API_KEY=sk-demo-not-a-real-key

docker compose -f docker-compose.yaml -f docker-compose.flowise.yaml up --build
# Flowise UI: http://localhost:3000  (login with the values above)
```

Notes:
- The base `docker-compose.yaml` does NOT ship LiteLLM (it's deployed as a
  k8s Deployment in `k8s/system-a/litellm.yaml`). On a laptop you can either
  add a LiteLLM service to the overlay or point `LITELLM_BASE_URL` at a
  remote LiteLLM. Until that's wired, model nodes inside Flowise can talk
  directly to a cloud provider with their own credential.
- Flowise persists to a named docker volume `flowise-data`. Reset with
  `docker compose ... down -v`.

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
- The base `docker-compose.yaml` does not include LiteLLM, so flows built
  against the compose stack need a remote LiteLLM URL or a side-car
  LiteLLM service. Adding LiteLLM to the base compose is tracked
  separately.
- Telemetry is disabled by default (`DISABLE_FLOWISE_TELEMETRY=true`). Do
  not flip this on without reviewing what Flowise sends upstream.

## Related files

- `docker-compose.flowise.yaml` — overlay for the laptop bring-up
- `k8s/system-a/flowise.yaml` — manifest for the System A cluster
- `config/flowise/README.md` — directory overview
- `config/flowise/flows/*.md` — per-scenario flow specs
- `docs/architecture.md`, `docs/architecture-spec.md` — primary architecture
- `docs/port-map.md` — port assignments (NodePort 31300 added for Flowise)
