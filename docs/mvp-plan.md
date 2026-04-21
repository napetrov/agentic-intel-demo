# MVP Plan — Minimal End-to-End Path

## Goal
Working demo of Task 1 (terminal agent) as fast as possible.
Everything else is layered on top of a verified first slice.

---

## Phase 0 — Environment foundation

Get both systems to a known state before any service is deployed.

### Tasks
- [ ] Confirm System A and System B hostnames, IP addresses
- [ ] Install k3s on both systems with non-overlapping CIDRs
- [ ] Export/merge kubeconfigs with contexts `system-a` and `system-b`
- [ ] Confirm network connectivity A ↔ B (ping, curl to fixed NodePorts)
- [ ] Confirm available node resources (CPU/RAM per node)
- [ ] Create namespaces: `agents`, `inference`, `platform`, `system-b`

### Notes
- k3s install flags and port assignments are documented in `docs/port-map.md`
- For onedal-build single-node validation, use the two-k3s-instance setup in `docs/single-node-validation.md`

### Deliverables
- `configs/env/system-a.yaml` — System A endpoints and cluster info
- `configs/env/system-b.yaml` — System B endpoints and cluster info
- Network connectivity verified (documented in `docs/reproducibility.md`)

### Check: done when
```
kubectl get nodes          # System A
kubectl get nodes          # System B
curl http://system-b:port  # from System A pod
```

---

## Phase 1 — Inference backend

Deploy local SLM on System B and verify it answers via OpenAI-compatible API.

### Tasks
- [ ] Create required secrets first (`litellm-api-keys`, MinIO creds if needed)
- [ ] Deploy ollama on System B (k8s Deployment)
- [ ] Pull model: `ollama pull qwen2.5:7b`
- [ ] Expose ollama as fixed NodePort `30434`
- [ ] Deploy LiteLLM on System A (k8s Deployment)
- [ ] Configure LiteLLM with:
  - local SLM backend at `http://<system-b-ip>:30434`
  - cloud model backend (API key from Secret)
  - routing aliases: `fast`, `reasoning`, `default`
- [ ] Test LiteLLM endpoint from a test pod on System A

### Config files
- `configs/model-routing/litellm-config.yaml`
- `k8s/system-b/ollama.yaml`
- `k8s/system-a/litellm.yaml`

### Check: done when
```
curl http://litellm-service/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"hello"}]}'
# returns a valid response
```

---

## Phase 2 — Artifact storage

Deploy MinIO on System B and verify write/read from System A.

### Tasks
- [ ] Deploy MinIO on System B (k8s Deployment)
- [ ] Expose MinIO API as fixed NodePort `30900`
- [ ] Create bucket `demo-artifacts`
- [ ] Create access key pair, store as k8s Secrets on both systems
- [ ] Verify read/write from a test pod using `aws s3` CLI or boto3
- [ ] Verify Control Plane artifact relay assumptions against MinIO access model

### Config files
- `k8s/system-b/minio.yaml`
- `k8s/shared/minio-secret.yaml` (template, not actual secret)

### Check: done when
```
# from System A pod:
aws s3 ls s3://demo-artifacts/ --endpoint-url http://system-b-minio:9000
aws s3 cp test.txt s3://demo-artifacts/test.txt --endpoint-url http://system-b-minio:9000
```

---

## Phase 3 — Control plane

Deploy minimal control plane on System A.

### Tasks
- [ ] Implement `POST /sessions` — create session pod
- [ ] Implement `GET /sessions/{id}` — get status
- [ ] Implement `DELETE /sessions/{id}` — terminate
- [ ] Implement artifact relay endpoints for `GET /artifacts/{ref}`
- [ ] RBAC: ServiceAccount with pod/job create/delete/list
- [ ] Mount System B kubeconfig Secret into Control Plane
- [ ] Session registry in SQLite (embedded in control plane for MVP)

### Code location
`legacy/services/control-plane/`

### Config files
- `k8s/system-a/control-plane.yaml`
- `k8s/system-a/rbac.yaml`

### Check: done when
```
curl -X POST http://control-plane/sessions \
  -d '{"user_id":"test","agent_profile":"default"}'
# returns session_id; pod appears in kubectl get pods -n agents
```

---

## Phase 4 — Session pod with OpenClaw

Define and launch a session pod that runs OpenClaw agent.

### Tasks
- [ ] Build session pod container image:
  - base: Node.js 22
  - install: `openclaw` CLI
  - install: basic tools (curl, git, python3, awscli or minio client if needed)
  - config: mounted via ConfigMap
- [ ] Define OpenClaw config for session pod:
  - model endpoint: LiteLLM URL
  - tools: terminal, file, custom shell/Python helpers via `exec`
  - chat: Telegram adapter
- [ ] Provide OpenClaw auth/license secret if required
- [ ] Choose image distribution path: GHCR/Docker Hub/local registry/`ctr images import`
- [ ] Push or import image
- [ ] Update control plane to launch this image as session pod

### Config files
- `legacy/runtimes/session-pod/Dockerfile`
- `legacy/runtimes/session-pod/openclaw-config.yaml`
- `k8s/system-a/session-pod-template.yaml`

### Check: done when
```
kubectl exec -n agents {pod} -- openclaw status
# agent is running, connected to LiteLLM, can execute a tool
```

---

## Phase 5 — Task 1 end-to-end demo

Run Task 1 (terminal agent) through the full stack.

### Tasks
- [ ] Define a terminal task (e.g., "count lines in a file", or a TerminalBench task)
- [ ] Configure Telegram bot token and delivery mode (polling or webhook)
- [ ] User sends task via Telegram → session pod receives it
- [ ] Agent executes terminal command locally
- [ ] Optionally save log/output artifact for reproducibility
- [ ] Result returned to user in Telegram

### Check: done when
User sends a message in Telegram → gets back a correct result with log attached.

---

## Phase 6 — Scale-up path (Task 3)

Extend control plane and agent with scale-up support.

### Tasks
- [ ] Implement `POST /sessions/{id}/scale-up` in control plane
- [ ] Control plane launches execution Job with `large` pod profile
- [ ] Agent submits work to execution Job, waits for result
- [ ] Result returned via MinIO artifact, then to user

### Config files
- `configs/pod-profiles/profiles.yaml`

### Check: done when
Agent requests scale-up, larger Job runs, result returned to user.

---

## Phase 7 — Offload path (Task 2)

Add System B offload API and analytics worker.

### Tasks
- [ ] Finalize offload job contract and result artifact schema
- [ ] Implement `POST /jobs` and `GET /jobs/{id}` on System B
- [ ] Implement analytics worker image (pandas + sklearn)
- [ ] Agent submits offload job via control plane → System B → worker job
- [ ] Worker writes results to MinIO
- [ ] Control Plane relays results back to session pod
- [ ] Agent reads results, assembles report

### Check: done when
Agent sends a market research task → offload job runs on System B → agent returns a report.

---

## What can be tested independently

| Component | How to test independently |
|-----------|--------------------------|
| ollama / LiteLLM | curl /v1/chat/completions from any client |
| MinIO | boto3 or aws CLI write/read test |
| Control plane | curl /sessions without session pod running |
| Session pod | kubectl exec + openclaw status |
| Offload API | curl /jobs with test payload |

---

## Timeline estimate (rough)

| Phase | Estimated time |
|-------|---------------|
| 0 — Environment | 0.5 day |
| 1 — Inference | 1 day |
| 2 — Artifact storage | 0.5 day |
| 3 — Control plane | 1-2 days |
| 4 — Session pod | 1 day |
| 5 — Task 1 e2e | 1 day |
| 6 — Scale-up | 1 day |
| 7 — Offload | 1-2 days |

Total to first working demo (Task 1): ~4-5 days of focused implementation.
