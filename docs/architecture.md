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
  - control client (scale-up + offload requests)
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
- LiteLLM reaches System B ollama via `http://<system-b-ip>:30434` (NodePort)

---

## Layer 4 — System B Services (GNR)

Shared compute, SLM, and storage node.

### Local SLM service
- OpenAI-compatible API server
- **Ready-made**: `vLLM` or `ollama` or `llama.cpp` with OpenAI shim
- Model: configurable, e.g. Qwen2.5-7B-Instruct or Llama-3.2-3B
- Exposed as `http://system-b:8000/v1`

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

### Task 3 — Build/test with scale-up
```
User → Chat Gateway → Control Plane → Session Pod small (System A)
  → agent detects need for larger execution profile
  → POST /sessions/{id}/scale-up (Control Plane)
  → Control Plane launches sibling execution Job (large profile, System A)
  → session pod REMAINS running as orchestrator
  → agent polls GET /offload/{job_id} for job completion
  → execution Job writes results to MinIO or returns via job status
  → Control Plane relays artifact to session pod
  → result returned to user via Telegram
```
All execution on System A. Session pod is never replaced — it stays as orchestrator.
No System B involvement except optional model backend.
