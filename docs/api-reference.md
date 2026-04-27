# Control-Plane API Reference

The control plane (`runtimes/control-plane/app.py`) is a thin FastAPI relay
that fronts System B execution and the artifact store, and tracks demo
sessions. The web demo, the Telegram orchestrator, and the smoke-test
scripts all talk to it over the same HTTP contract documented below.

In Tier 1 (docker-compose / `scripts/dev-up.sh`) the control plane is
reachable on host port `8090` (compose maps `127.0.0.1:8090 → container 8080`),
or behind the web demo's nginx at `/api/*`. In Tier 2 (k8s) it is the
`control-plane` service in the `platform` namespace, listening on port
`8080`; the web demo proxies to it on the cluster network.

FastAPI's auto-generated interactive schema is also available at
`GET /docs` (Swagger) and `GET /redoc` whenever the process is running;
this document is the human reference.

## Base URLs

| Mode | Base URL |
|------|----------|
| docker-compose / dev-up | `http://localhost:8090` (control-plane direct) |
| Web demo (any mode) | `<web-demo-origin>/api` |
| Tier 2 (in-cluster) | `http://control-plane.platform.svc.cluster.local:8080` |

All responses are JSON unless otherwise noted. Errors use the standard
FastAPI envelope: `{"detail": "<message>"}` with the documented status code.

## Health and probes

### `GET /health`
Liveness. Returns `200 {"status": "ok"}` whenever the process is up. Used
by the Deployment's `livenessProbe`.

### `GET /ready`
Readiness. Returns `200 {"status": "ready"}` only when the offload-worker
is reachable on its `/health`. Returns `503` otherwise so kube does not
route traffic until the upstream relay can actually forward.

### `GET /probe/{name}`
Best-effort liveness probe of a named external dependency. Used by the web
demo's "Platform health" rail. The set of recognised names is:

| Name | Env var providing target URL | Purpose |
|------|------------------------------|---------|
| `openclaw` | `OPENCLAW_GATEWAY_URL` | OpenClaw operator-managed instance |
| `litellm` | `LITELLM_BASE_URL` | LiteLLM model router |
| `sambanova` | `SAMBANOVA_PROBE_URL` | SambaNova inference endpoint |

Response shape:

```json
{ "state": "ok" | "down" | "unconfigured", "target": "<name>", "detail": "<error class>" }
```

States:

- `ok` — target answered 2xx within `PROBE_TIMEOUT_SECONDS` (default 2.5s).
- `down` — target reachable but non-2xx, OR a timeout / connection error.
  `detail` carries the exception class (e.g. `ConnectTimeout`).
- `unconfigured` — no target URL is configured for that name. The UI
  renders this as a neutral "not wired" indicator instead of a false-OK.

The `target` field is the logical name only — credentials embedded in the
configured URL never leave the server. See `docs/health-probes.md` for the
UI surfacing convention.

Unknown names return `404 {"detail": "unknown probe '<name>'"}`.

## Offload (System A → System B relay)

### `POST /offload`
Submit a single offload job and synchronously wait for the worker to
return. The control plane is intentionally a thin relay — it does not
queue work; the request blocks until either the worker responds or
`OFFLOAD_TIMEOUT_SECONDS` (default 60s) elapses.

Request body:

```json
{
  "task_type": "<string, required>",
  "payload": { "...": "..." },
  "session_id": "<optional string>",
  "timeout_seconds": <optional positive number>
}
```

Response (`200`):

```json
{
  "job_id": "job-<12 hex>",
  "status": "completed" | "error",
  "session_id": "<echoed if provided>"
}
```

Error responses:

- `422` — request body fails validation (e.g. `task_type` empty,
  `timeout_seconds <= 0`).
- `502` — offload-worker unreachable / timed out / returned non-2xx.
  Job is recorded with `status="error"` and is queryable via
  `GET /offload/{job_id}`.

Result contract (what `task_type` values are accepted, what payload each
expects) lives in `docs/contracts/offload-result-contract.md`.

### `GET /offload/{job_id}`
Poll a previously submitted job. Returns the full job record:

```json
{
  "job_id": "job-...",
  "status": "running" | "completed" | "error",
  "session_id": "...",
  "task_id": "...",
  "result": { "...": "..." },
  "result_ref": "<artifact key in MinIO>",
  "error": "<message if status=error>",
  "submitted_at": <unix seconds>,
  "completed_at": <unix seconds | null>
}
```

`404` if the `job_id` is unknown. The job registry is sqlite-backed when
`JOBS_DB_PATH` is set (compose / dev-up sets it) and in-memory otherwise.
A `docker compose restart control-plane` does NOT drop `result_ref`s in
the persistent path.

### `GET /artifacts/{ref}`
Mint a presigned MinIO URL for an artifact previously produced by an
offload job. The `ref` must match a `result_ref` already issued through
this control plane; arbitrary bucket keys are rejected with `404` so the
endpoint cannot be used as a bucket-wide read proxy.

Response:

```json
{
  "ref": "<key>",
  "url": "<presigned https URL>",
  "expires_in": 900
}
```

Errors: `400` (malformed ref), `404` (unknown ref), `502` (MinIO presign
failure), `503` (`MINIO_ENDPOINT` not configured).

## Sessions API (multi-agent fan-out)

A "session" is one running agent workload. In Tier 2 the backend creates a
`batch/v1.Job` per session in the `agents` namespace (override via
`AGENTS_NAMESPACE`); in Tier 1 it
simulates the same lifecycle in-memory. The wire contract is identical, so
the web UI does not need to know which backend is in use.

The active backend reports its name in every list/batch response under the
`backend` field (`local` or `kube`).

### `GET /sessions/profiles`
List the resource profiles the create endpoints accept. The web UI uses
this to render its profile picker without hard-coding the table.

```json
{
  "default": "<profile name>",
  "profiles": { "<name>": { "cpu": "...", "memory": "..." } }
}
```

### `POST /sessions`
Create one session. `201` on success.

Request:

```json
{
  "scenario": "<string, required, ≤ 63 chars>",
  "profile": "<profile name; defaults to PROFILES default>",
  "session_id": "<optional, ≤ 59 chars>"
}
```

`session_id` is bounded at 59 chars because the kube backend appends
`-job` (4 chars) when forming the Job name and DNS-1035 caps labels at
63. The same limit is enforced for the local backend so a request that
succeeds locally still succeeds against kube.

Response: a `SessionResponse` (see below). Errors: `400` (unknown
profile, duplicate `session_id`), `502` (backend failure).

### `POST /sessions/batch`
Create N sessions in one call. Used by `scripts/load-simulate.sh` and the
"Spawn N concurrent sessions" panel in the UI.

```json
{
  "scenario": "<string, required>",
  "profile": "<optional>",
  "count": <int, 1..SESSION_BATCH_MAX>
}
```

`SESSION_BATCH_MAX` defaults to 50 and is settable via env. Status codes:

- `201` — every requested session was created.
- `207` — partial success: at least one created, then the loop bailed.
  The body still carries the successfully-created sessions plus an
  `_error: 1` entry in `by_status` and a populated `error` field.
- `502` — total failure: zero sessions were created. Body carries the
  underlying `error` so the caller knows why.

### `GET /sessions`
List all sessions known to the active backend.

```json
{
  "backend": "local" | "kube",
  "total": <int>,
  "by_status": { "Running": 2, "Completed": 5, ... },
  "sessions": [ { ...SessionResponse... } ],
  "error": null
}
```

### `GET /sessions/{session_id}`
Poll one session. `404` if unknown.

### `DELETE /sessions/{session_id}`
Request termination. Returns `200 {"session_id": ..., "status": "Deleting"}`.
`404` if unknown. The session record stays in `Deleting` until the
backend confirms the underlying Job is gone.

### `SessionResponse` shape

```json
{
  "session_id": "sess-<10 hex>",
  "scenario": "...",
  "profile": "...",
  "status": "Pending" | "Running" | "Completed" | "Failed" | "Deleting",
  "created_at": <unix seconds>,
  "started_at": <unix seconds | null>,
  "completed_at": <unix seconds | null>,
  "pod_name": "...",
  "job_name": "...",
  "backend": "local" | "kube",
  "cpu_request": "<resource string>",
  "memory_request": "<resource string>",
  "message": "<freeform if backend has one to report>"
}
```

## Environment variables

| Var | Default | Effect |
|-----|---------|--------|
| `OFFLOAD_WORKER_URL` | `http://offload-worker.system-b.svc.cluster.local:8080` | Where to forward `/offload` |
| `OFFLOAD_TIMEOUT_SECONDS` | `60` | Per-request offload timeout |
| `MINIO_ENDPOINT` | _unset_ | If unset, `/artifacts/{ref}` returns 503 |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | _unset_ | Auth for MinIO presign |
| `MINIO_BUCKET` | `demo-artifacts` | Bucket for presigned URLs |
| `PRESIGN_EXPIRES_SECONDS` | `900` | Presigned URL TTL |
| `JOBS_DB_PATH` | _unset_ | Sqlite path for durable job registry; in-memory if unset |
| `OPENCLAW_GATEWAY_URL` | _unset_ | Probe target for `/probe/openclaw` |
| `LITELLM_BASE_URL` | _unset_ | Probe target for `/probe/litellm` |
| `LITELLM_API_KEY` | _unset_ | Bearer for `litellm` probe (never leaked back to UI) |
| `SAMBANOVA_PROBE_URL` | _unset_ | Probe target for `/probe/sambanova` |
| `SAMBANOVA_API_KEY` | _unset_ | Bearer for `sambanova` probe |
| `PROBE_TIMEOUT_SECONDS` | `2.5` | Per-probe HTTP timeout |
| `SESSION_BACKEND` | `local` | `local` for in-memory sim, `kube` for batch/v1.Job |
| `SESSION_BATCH_MAX` | `50` | Hard cap on `POST /sessions/batch` |

## Related contracts

- `docs/contracts/offload-result-contract.md` — `task_type`s, payload
  schemas, and result shapes.
- `docs/contracts/session-lifecycle.md` — state machine for session →
  job → task across the two-system boundary.
- `docs/contracts/task-routing.md` — policy that picks `local_standard`
  vs `local_large` vs `offload_system_b` for a given scenario.
- `docs/health-probes.md` — what each probe state means and how the UI
  surfaces it.
