# Flowise — configuration and tasks

Flowise is the **optional alternate orchestrator** referenced in the demo
architecture (see the web demo's "Orchestration + Routing" band and
`docs/flowise-integration.md`). OpenClaw remains the primary path; Flowise
exists for users who want a visual flow-builder front-end against the same
LiteLLM gateway and the same control-plane offload/artifact services.

This directory holds:

| Path | Purpose |
|------|---------|
| `README.md` | this file |
| `flows/terminal-agent.md` | flow spec for scenario 1 (`local_standard`) |
| `flows/market-research.md` | flow spec for scenario 2 (`offload_system_b`) |
| `flows/large-build-test.md` | flow spec for scenario 3 (`local_large`) |

The flow files describe **node graphs** rather than shipping exported JSON.
Flowise's exported chatflow JSON is a verbose internal representation that
breaks across versions; pinning a version-stable graph spec keeps the demo
reproducible. Each spec gives the exact nodes to add, how to wire them, and
the credentials/URLs they must point at.

## Required configuration

Flowise reaches the rest of the demo through two endpoints:

| Endpoint | Default value (k8s) | Default value (compose) |
|----------|---------------------|-------------------------|
| `LITELLM_BASE_URL` | `http://litellm.inference.svc.cluster.local:4000` | `http://litellm:4000` (set via env) |
| `CONTROL_PLANE_BASE_URL` | `http://control-plane.platform.svc.cluster.local:8080` | `http://control-plane:8080` |

Both are injected as env vars (k8s: `flowise-config` ConfigMap; compose:
`docker-compose.flowise.yaml`). Flow nodes that need them either reference
the env directly (Custom Tool / HTTP node) or have the URLs pasted in the
node's "Base URL" field at flow-build time.

### Credentials

In compose mode, the `flowise-seed` one-shot service in
`docker-compose.flowise.yaml` creates the `litellm-openai` credential
automatically (see `scripts/flowise/seed.py`). The list below is what
gets created — useful when you're working off the k8s deploy or want to
add the second slot manually:

1. **`litellm-openai`** — type "OpenAI". Base URL: the value of
   `LITELLM_BASE_URL`. API key: any non-empty string when LiteLLM has no
   master key set, otherwise the LiteLLM master key. *(seeded in compose;
   set manually in k8s.)*
2. **`control-plane-bearer`** — type "Generic / API Key". Used by the HTTP
   nodes that call `POST /offload`. The current control plane does not
   require auth; reserve this slot for when it does. *(not seeded; only
   needed once the control plane gates `/offload`.)*

### Model aliases

Flow nodes that select a model should use one of the aliases declared in
`config/model-routing/litellm-config.yaml` so LiteLLM handles routing:

- `fast` — System B vLLM (Qwen3-4B), low-latency
- `default` — same backend, longer timeout, Bedrock fallback
- `reasoning` — Bedrock Claude Sonnet
- `sambanova` — SambaNova DeepSeek V3.1 (alternative reasoning path)

Pick aliases by step (e.g. extract → `fast`, plan → `reasoning`). Hard-
coding model names in the flow defeats LiteLLM routing.

## How tasks (flows) are exposed

Each flow gets a stable Chatflow ID once saved. Flowise exposes it at:

```
POST {flowise}/api/v1/prediction/{chatflow-id}
GET  {flowise}/api/v1/prediction/{chatflow-id}            # streaming
```

Body:

```json
{
  "question": "<user message>",
  "overrideConfig": { "session_id": "<demo session id>" }
}
```

To call a flow from the demo's existing surface, point a thin task type at
that endpoint (see `docs/flowise-integration.md` for the wiring options:
control-plane → Flowise vs. browser → Flowise direct).

## Reset

To reset a Flowise install (drop all flows and credentials) without
reinstalling:

- compose: `docker compose -f docker-compose.yaml -f docker-compose.flowise.yaml down -v`
- k8s: `kubectl -n agents delete pvc flowise-data && kubectl -n agents rollout restart deploy/flowise`
