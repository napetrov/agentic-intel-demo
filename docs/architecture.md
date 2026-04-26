# Architecture — Agentic Execution on Intel CPUs

## Overview

Two-system deployment. Users interact with agents, not infrastructure.
OpenClaw runtime instances are created and managed by `openclaw-operator`.

```
User (Telegram / Teams / Web)
  │
  ▼
OpenClawInstance (System A, managed by openclaw-operator)
  │
  ├── OpenClaw gateway/runtime
  ├── workspace/storage
  ├── configured channels/tools/plugins
  └── Model Client → LiteLLM (System A, inference namespace)
                         │
                         ▼
                   vLLM / cloud backends

System B provides shared services such as:
- vLLM model backend
- MinIO
- offload analytics/services
```

> **Note:** Session pod never contacts System B directly.
> All cross-cluster calls go through the Control Plane.
> MinIO on System B is the exception: artifact reads/writes go through
> Control Plane's `GET /artifacts` and `POST /offload` responses.

---

## Layer 1 — Session Pod (System A)

One pod per active user session.

### Components inside the pod
- **OpenClaw agent runtime** — orchestration and tool execution
- **Tools layer**
  - terminal / shell execution
  - file read/write
  - control client (offload requests)
  - artifact client
- **Workspace volume** — per-session ephemeral scratch space
- **Session state** — task context, intermediate outputs
- **Model client** — single endpoint pointing at LightLLM

### Pod sizing
Defined by profiles, not hardcoded. See `config/pod-profiles/profiles.yaml`.

| Profile | CPU | Memory | Use case |
|---------|-----|--------|----------|
| small | 2 | 4Gi | orchestration, light tasks |
| medium | 8 | 16Gi | agent with local tools |
| large | 32 | 64Gi | build/test, compile |

---

## Layer 2 — Control Plane (System A)

Manages session and execution lifecycle.

### API surface (HTTP/REST)
The earlier control-plane sketch used explicit `/sessions` APIs, but for instance lifecycle the supported contract should now be the `OpenClawInstance` custom resource managed by the operator.

Any helper APIs should be treated as supporting services, not the source of truth for instance creation or deletion.

The offload-relay helper service is implemented in `runtimes/control-plane/`:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/offload` | submit a task; forwards to offload-worker, returns `{job_id, status, session_id}` |
| `GET` | `/offload/{job_id}` | poll job state; returns inline `result` or `result_ref` + `error` |
| `GET` | `/artifacts/{ref}` | presigned MinIO URL for a `result_ref` from a prior job |
| `GET` | `/health` | liveness/readiness |

This is a deliberately thin relay: jobs are kept in memory and forwarded
synchronously. A durable registry is still TODO. Deployed in k8s via
`k8s/system-a/control-plane-offload.yaml`.

### Sessions API — multi-agent fan-out

The control plane also owns session lifecycle so the demo can show many
agents running concurrently instead of one at a time. Each session maps
1:1 to one running agent workload; in the k8s deployment the backing
object is a `batch/v1.Job`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sessions` | create one session: `{scenario, profile?, session_id?}` → `SessionResponse` |
| `POST` | `/sessions/batch` | create N sessions in one call: `{scenario, profile?, count}`. Capped by `SESSION_BATCH_MAX` (default 50) |
| `GET` | `/sessions` | list all sessions + `by_status` summary |
| `GET` | `/sessions/{id}` | poll one session |
| `DELETE` | `/sessions/{id}` | request termination (k8s: foreground-propagation Job delete) |
| `GET` | `/sessions/profiles` | available pod profiles (small / medium / large) |

Backend selection is env-driven (`SESSION_BACKEND`):

* `local` (default for docker-compose / `scripts/dev-up.sh`) — in-memory
  state-machine simulator. Sessions move `Pending → Running → Completed`
  on a wall-clock timer; no real Pods are created. The "Multi-agent
  fan-out" panel in the web UI and `scripts/load-simulate.sh` both work
  against this backend, so the multi-session demo runs without k8s.
* `kube` (k8s deployment) — `KubeSessionBackend` creates one
  `batch/v1.Job` per session from the `session-job-template` ConfigMap
  (`k8s/system-a/session-job-template.yaml`). Resource requests come
  from the named profile (`config/pod-profiles/profiles.yaml`, mirrored
  in `session_manager.PROFILES`). Job condition `Complete=True` /
  `Failed=True` map directly to the response `status` field.
  `ttlSecondsAfterFinished` lets k8s GC finished sessions so the
  namespace doesn't accumulate Pods after a load demo.

The kube backend requires the additional RBAC verbs in
`k8s/system-a/rbac.yaml` (`batch/jobs` + `configmaps:get`); the
`kubernetes` Python package is added to `requirements.txt` but only
imported when `SESSION_BACKEND=kube`, so the local backend stays
dependency-free.

Capacity utilisation: the offload-worker (System B) is the shared
backend that all sessions hit when they call `/offload`. With
`k8s/system-b/offload-worker-hpa.yaml` it scales between 1 and 12
replicas based on CPU utilisation (target 60%), so a 20-session
load-simulator burst can actually exercise multi-replica behaviour
instead of queueing on a single worker.

### Internal modules
- **Session Manager** — pod create/delete, status, session registry
- **Pod Profile Resolver** — maps task type to pod profile
- **Policy Resolver** — reads configs, resolves routing and offload policies
- **Offload Gateway Client** — calls System B offload API
- **Artifact Registry** — stores refs, signed URLs

### Ready-made: use operator-managed lifecycle plus thin supporting services
- Kubernetes still does scheduling
- `openclaw-operator` should own instance reconciliation
- supporting services may exist for offload and artifacts, but not as the primary lifecycle manager for instances

---

## Layer 3 — Model Routing (LightLLM)

Single endpoint for all agent model calls.
Agent always calls one URL, LightLLM decides the backend.

### LightLLM responsibilities
- Receive all `/v1/chat/completions` calls
- Route based on model alias or request metadata
- Maintain model backend list
- Handle retries and fallbacks

### Model aliases for agents
| Alias | Mapped to | Routing rule |
|-------|-----------|-------------|
| `default` | local SLM | all steps unless overridden |
| `fast` | local SLM | summaries, extraction, retries |
| `reasoning` | cloud model | complex planning, synthesis |
| `code` | local SLM or cloud | configurable |

### Routing policy (declarative, not code)
See `config/model-routing/litellm-config.yaml`.

### Deployment
- **Ready-made**: LiteLLM OSS — `ghcr.io/berriai/litellm`
- Deployed as standalone Deployment in namespace `inference` on System A
- Session pods reach it via env var `LITELLM_BASE_URL=http://litellm.inference.svc.cluster.local:4000`
- LiteLLM reaches System B vLLM via `http://<system-b-ip>:30434/v1` (NodePort)

---

## Layer 4 — System B Services (GNR)

Shared compute, SLM, and storage node.

### Local SLM service
- OpenAI-compatible API server
- **Ready-made**: `vLLM` (canonical for this demo) — `ollama` /
  `llama.cpp` with OpenAI shim are valid alternatives but not what's
  pinned in `config/versions.yaml` or installed by
  `scripts/setup-system-b-vllm-local.sh`.
- Model: `Qwen/Qwen3-4B-Instruct-2507` at 32768 ctx, 16 CPU / 32Gi
  (see `config/versions.yaml`). Switch in
  `scripts/setup-system-b-vllm-local.sh` if you need a smaller fit.
- Exposed as `http://<system-b-ip>:30434/v1` (NodePort 30434).

### Offload API service
- Accepts job spec, launches Kubernetes Job on System B cluster
- Returns `job_id`, supports poll + artifact ref return
- **Ready-made**: thin FastAPI wrapper around k8s Jobs API

### Worker Jobs/Pods
- Analytics workers: pandas, polars, dask, sklearn
- Batch compute: numpy-heavy tasks, data preprocessing
- Spawned on-demand as k8s Jobs, no idle cost
- Results written to object storage

### Shared services
- **Object storage**: MinIO (S3-compatible) — `minio/minio`
  - Exposed on System B as NodePort 30900
  - Accessed by Control Plane (for artifact relay) and Worker Jobs (for result writes)
- **Artifact paths**: `s3://demo-artifacts/{session_id}/inputs|outputs|logs/`

> PostgreSQL is NOT required for MVP. Session/job metadata stored in SQLite inside the Control Plane.

---

## Layer 5 — Storage and Artifacts

Single artifact path accessible from both systems.

- MinIO deployed on System B, NodePort 30900
- S3-compatible API — `http://<system-b-ip>:30900`
- **Session pods do NOT access MinIO directly**
- Artifact write path: Worker Job or execution Job → MinIO directly (same cluster, System B)
- Artifact read path: Session pod calls `GET /artifacts/{ref}` on Control Plane → Control Plane fetches from MinIO → returns to session pod
- Artifact bucket layout: `demo-artifacts/{session_id}/inputs/`, `outputs/`, `logs/`

---

## Layer 6 — Chat Integration

Abstraction layer: users talk to agents, not to Kubernetes.

### Chat Gateway interface
```
create_or_resume_session(chat_user, thread_id, agent_profile)
post_user_message(session_id, message)
post_agent_response(session_id, response, artifact_refs)
```

### Adapters
| Adapter | Status in MVP |
|---------|--------------|
| Telegram | enabled |
| Microsoft Teams | architecture only |
| Web/HTTP API | architecture only |

### Session mapping
- `chat_user + thread_id` → `session_id` → pod name
- Mapping stored in metadata DB

### Ready-made: OpenClaw handles Telegram and session routing natively
- For MVP, OpenClaw running inside session pod handles the chat <-> agent bridge
- Teams and Web API adapters added later without changing agent logic

---

## Execution paths by demo task

### Task 1 — Terminal agent
```
User → Chat Gateway → Control Plane → Session Pod (System A)
  → terminal task execution (local tools inside pod)
  → model calls via LiteLLM → local SLM (System B)
  → result returned to user via Telegram (OpenClaw handles egress directly)
```
All execution on System A. System B provides model backend only via NodePort.
No MinIO needed for Task 1 unless agent chooses to save output artifact.

### Task 2 — Market research + GNR offload
```
User → Chat Gateway → Control Plane → Session Pod (System A)
  → agent orchestrates task
  → POST /offload (Control Plane) → Control Plane → System B Offload API
  → Worker Job runs on System B (GNR)
  → Worker writes results to MinIO (System B, internal)
  → session pod polls GET /offload/{job_id} via Control Plane
  → Control Plane fetches artifact from MinIO, returns to session pod
  → agent assembles report
  → result returned to user via Telegram
```
Orchestration on System A. Heavy compute on System B.
Session pod never calls System B directly.

### Task 3 — Build/test on a statically-sized large session pod
```text
User → Chat Gateway → OpenClaw operator (System A)
  → Session Pod created from the `large` pod profile at OpenClawInstance
    creation time (no runtime scale-up step)
  → agent runs build/test directly in the large session pod
  → results surfaced via MinIO artifact or direct tool output
  → result returned to user via Telegram
```
All execution on System A. Profile is selected statically per scenario in
`config/pod-profiles/profiles.yaml`; the old dynamic
`POST /sessions/{id}/scale-up` contract has been dropped. No System B
involvement except optional model backend.
