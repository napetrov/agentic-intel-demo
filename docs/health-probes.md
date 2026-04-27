# Health Probes

Two layers, one contract:

1. **Server-side state** — the control-plane returns one of three
   strings from `GET /probe/{name}`. This is the source of truth.
2. **UI state** — the web demo's "Platform health" rail maps each
   probe response to one of five CSS classes on a coloured dot. The
   mapping is deliberately wider than the server vocabulary because
   the UI also tracks "not yet probed" and "we cannot probe at all"
   states the server doesn't model.

Closing gap #5 in `docs/internal/operator-gap-analysis.md`.

## Server-side states (control-plane `/probe/{name}`)

The endpoint is implemented in `runtimes/control-plane/app.py:202`
(`probe_dependency`). Response body:

```json
{ "state": "ok" | "down" | "unconfigured", "target": "<name>", "detail": "<exception class>" }
```

| State | Returned when | `target` | `detail` |
|-------|---------------|----------|----------|
| `ok` | Target answered 2xx within `PROBE_TIMEOUT_SECONDS` (default 2.5s) | logical name | omitted |
| `down` | Probe ran but failed: timeout, connect error, non-2xx, malformed URL | logical name | exception class name |
| `unconfigured` | No URL is configured for this probe (env var unset / blank) | omitted | omitted |

Unknown probe names return `404 {"detail": "unknown probe '<name>'"}`.

The probe is intentionally cheap (single HTTP GET, no auth in the
default path) and side-effect-free. Operators can call it manually:

```bash
curl -s http://control-plane.platform.svc.cluster.local:8080/probe/litellm | jq
```

### Probe name → env mapping

`PROBE_TARGETS` (`runtimes/control-plane/app.py:78`) is the canonical
table. The `target` field in the JSON response is always the probe's
**logical name only** — the configured URL stays in server-side logs so
embedded credentials (`https://user:token@host/...`) never reach the
browser.

| Probe name | Base URL env | Path env | Bearer env |
|------------|--------------|----------|------------|
| `openclaw` | `OPENCLAW_GATEWAY_URL` | `OPENCLAW_PROBE_PATH` (default `/health`) | _none_ |
| `litellm` | `LITELLM_BASE_URL` | `LITELLM_PROBE_PATH` (default `/health/liveliness`) | `LITELLM_API_KEY` |
| `sambanova` | `SAMBANOVA_PROBE_URL` | `SAMBANOVA_PROBE_PATH` (default `/`) | `SAMBANOVA_API_KEY` |

### Why `unconfigured` exists

A demo deployment may legitimately leave a probe blank — e.g. a Tier 1
local run without SambaNova credentials, or a Tier 2 cluster where the
operator gateway is on a different network path than the LiteLLM
probe. Returning a third `unconfigured` state (instead of `down`) lets
the UI render a neutral "not wired" indicator. A red dot would
incorrectly imply we'd confirmed the target is broken.

## UI states (web demo "Platform health" rail)

The rail is rendered by `setHealthDot()` (`web-demo/app.js:1230`). Each
dot has exactly one of these CSS classes:

| Class | Dot colour | `aria-label` | Meaning |
|-------|-----------|--------------|---------|
| `ok` | green | `healthy` | Server returned `state: "ok"` |
| `warn` | yellow | `degraded` | Initial / not-yet-probed state, OR System B = control-plane up but `/ready` failing |
| `down` | red | `unreachable` | Server returned `state: "down"`, OR a probe-fetch network error |
| `idle` | grey | `not configured` | Server returned `state: "unconfigured"` |
| `unknown` | grey | `reachability unknown` | Control plane itself is down; we cannot probe upstream targets |

The five dots in the rail map to two distinct probe sources:

- `systemA` and `systemB` come from the control-plane's own `/health`
  and `/ready` (`probeBackend()` in `app.js:1268`).
- `openclaw`, `litellm`, `sambanova` come from `/probe/{name}`
  (`probeDependency()` in `app.js:1249`).

### Server-state → UI-class mapping

| Server state | UI class | Why |
|--------------|----------|-----|
| `ok` | `ok` (green) | Target healthy |
| `down` | `down` (red) | Probe failed |
| `unconfigured` | `idle` (grey) | Operator deliberately didn't wire it |

When the control plane itself is unreachable, the UI does NOT call
`/probe/*` — there's nothing to call. Instead it sets the upstream
dots to `unknown` (grey, with tooltip "Control plane unreachable —
cannot probe upstream"). This is distinct from `idle` ("not wired") and
from `down` ("we tried and it failed"), and the distinction matters for
operator interpretation.

## State diagrams

### `systemA` (control plane)
```
[warn] --GET /health 2xx--> [ok]
[warn] --GET /health fail--> [down]
[ok]   --GET /health fail--> [down]
[down] --GET /health 2xx--> [ok]
```

### `systemB` (offload-worker, via control-plane `/ready`)
```
[warn] --control-plane down--> [unknown]
[warn] --GET /ready 2xx-----> [ok]
[warn] --GET /ready 5xx-----> [warn]   (control-plane up, worker not ready)
[ok]   --control-plane down--> [unknown]
```

### `openclaw` / `litellm` / `sambanova` (via `/probe/{name}`)
```
[warn] --control-plane down----------> [unknown]
[warn] --probe state="ok"-----------> [ok]
[warn] --probe state="down"---------> [down]
[warn] --probe state="unconfigured"-> [idle]
[warn] --network error fetching probe-> [down]
```

## What to do when a dot is red or grey

| Dot | Colour | First check |
|-----|--------|-------------|
| `systemA` | red | `curl http://control-plane.../health` from the same network as the browser |
| `systemB` | red / yellow | `curl http://control-plane.../ready`; then `curl http://offload-worker.../health` |
| `openclaw` | red | OpenClaw operator-managed pod logs; verify `OPENCLAW_GATEWAY_URL` resolves |
| `openclaw` | grey (idle) | `OPENCLAW_GATEWAY_URL` is blank — set it on the control-plane Deployment |
| `litellm` | red | LiteLLM pod logs; check `LITELLM_BASE_URL` and `LITELLM_API_KEY` ConfigMap |
| `sambanova` | grey (idle) | Expected unless SambaNova is in scope for the demo |
| any | grey (unknown) | Fix the control plane first — it has to be up before we can probe anything else |

Cross-references: `docs/api-reference.md` (the `/probe/{name}`
endpoint), `docs/runbooks/incident-recovery.md` (decision trees for
each red-dot scenario), `web-demo/README.md` (the rail in context).
