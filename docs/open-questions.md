# Open Questions and Decisions

This document tracks everything that must be answered or decided
before the demo is reproducible and runnable.
Items are grouped by layer. Each item has a status and a notes field.

---

## Status legend
- 🔴 OPEN — blocking, must resolve before implementation
- 🟡 DECISION NEEDED — important but not yet blocking the first slice
- 🟢 RESOLVED — agreed, documented
- ⬜ DEFERRED — not needed for MVP

---

## Section 1 — Infrastructure / Systems

### Q1.1 Are System A and System B separate Kubernetes clusters or separate node pools in one cluster?
- **Status**: 🟢 RESOLVED
- **Answer**: two separate k3s clusters, one for System A and one for System B
- **Notes**: control plane holds kubeconfig contexts for both clusters

### Q1.2 What are the actual hostnames / IPs for System A and System B?
- **Status**: 🔴 OPEN
- **Notes**: needed for all endpoint config files

### Q1.3 What Kubernetes version and CNI plugin is running on each system?
- **Status**: 🟢 RESOLVED
- **Answer**: k3s on both systems; CNI = flannel (k3s default)
- **Notes**: k3s install parameters documented separately

### Q1.4 Is there shared L3 network connectivity between System A and System B?
- **Status**: 🟢 RESOLVED
- **Answer**: same L2/L3 network; cross-system access via fixed NodePort values
- **Notes**: no cross-cluster DNS, use IP:NodePort

### Q1.5 What persistent volume / storage classes are available on each system?
- **Status**: 🟢 RESOLVED
- **Answer**: hostPath volumes for demo (MinIO data, ollama model cache)
- **Notes**: no dynamic provisioner needed for MVP

---

## Section 2 — Local SLM on System B

### Q2.1 What local model will run on System B for inference?
- **Status**: 🟢 RESOLVED
- **Answer**: `qwen2.5:7b-instruct`
- **Notes**: chosen for CPU-friendly MVP quality/latency tradeoff

### Q2.2 What serving stack for local SLM?
- **Status**: 🟢 RESOLVED
- **Answer**: `ollama` for MVP
- **Notes**: can switch to vLLM later if throughput matters

### Q2.3 What is the expected token throughput / latency requirement for local SLM?
- **Status**: 🟡 DECISION NEEDED
- **Notes**: demo doesn't need high throughput, but user-facing latency should be under ~10s for short completions

### Q2.4 HuggingFace token: available on System B?
- **Status**: 🟢 RESOLVED
- **Answer**: not needed for MVP because Qwen2.5 is ungated
- **Notes**: revisit only if switching to gated models

---

## Section 3 — LiteLLM / Model Routing

### Q3.1 Will LiteLLM proxy run on System A or System B?
- **Status**: 🟢 RESOLVED
- **Answer**: System A, standalone Deployment in namespace `inference`
- **Notes**: session pods call LiteLLM via ClusterIP service

### Q3.2 What cloud model endpoint will be used for heavy reasoning?
- **Status**: 🔴 OPEN
- **Options**: OpenAI GPT-4o, Anthropic Claude, AWS Bedrock, Azure OpenAI
- **Notes**: API key must be provisioned and available as k8s Secret

### Q3.3 What is the routing policy for model selection?
- **Status**: 🟢 RESOLVED
- **Answer**:
  - `fast` → local SLM always
  - `reasoning` → cloud model
  - `default` → local SLM with cloud fallback if timeout >10s
- **Notes**: captured in `configs/model-routing/litellm-config.yaml`

### Q3.4 LiteLLM deployment: standalone pod or sidecar?
- **Status**: 🟢 RESOLVED
- **Answer**: standalone Deployment in `inference` namespace, accessed via ClusterIP Service

---

## Section 4 — Control Plane

### Q4.1 What is the scale-up semantics?
- **Status**: 🟢 RESOLVED
- **Answer**: Option A — launch a sibling execution Job, session pod remains orchestrator
- **Notes**: session pod polls and collects results via Control Plane / artifact flow

### Q4.2 How does the control plane authenticate to the Kubernetes API?
- **Status**: 🟢 RESOLVED
- **Answer**: In-cluster ServiceAccount + scoped RBAC on System A; System B kubeconfig mounted as Secret in Control Plane
- **Notes**: Control Plane is the only broker for cross-cluster operations

### Q4.3 Control plane language/framework?
- **Status**: 🟢 RESOLVED
- **Answer**: Python + FastAPI + `kubernetes-client/python`

### Q4.4 Does the control plane need HA / restartability for the demo?
- **Status**: ⬜ DEFERRED
- **Notes**: for demo, single replica is fine; add HA later

---

## Section 5 — Offload API (System B)

### Q5.1 What is the offload job contract?
- **Status**: 🟢 RESOLVED
- **Draft contract**:
  ```json
  POST /jobs
  {
    "task_type": "analytics",
    "input_artifact": "s3://demo-artifacts/session-123/input.parquet",
    "output_prefix": "s3://demo-artifacts/session-123/results/",
    "params": { ... }
  }

  Response:
  { "job_id": "job-abc123", "status": "submitted" }

  GET /jobs/{job_id}
  { "job_id": "...", "status": "running|completed|failed", "output_artifact": "..." }
  ```
- **Notes**: finalize schema before implementing Task 2

### Q5.2 What analytics workload runs in offload workers for Task 2?
- **Status**: 🟡 DECISION NEEDED
- **Notes**: for demo purposes, it can be a simple pandas/sklearn pipeline on synthetic market data
  to show the pattern without requiring real data sources

### Q5.3 Worker image: what base image and Python packages?
- **Status**: 🟡 DECISION NEEDED
- **Draft**: `python:3.12-slim` + pandas + polars + scikit-learn + boto3

---

## Section 6 — Artifact Storage / MinIO

### Q6.1 MinIO: deployed on System B or a separate shared system?
- **Status**: 🟢 RESOLVED
- **Answer**: System B

### Q6.2 MinIO auth: root credentials vs per-service access keys?
- **Status**: 🟢 RESOLVED
- **Answer**: one shared access key pair for demo, distributed via k8s Secrets

### Q6.3 Bucket layout
- **Status**: 🟢 RESOLVED
- **Answer**:
  ```
  demo-artifacts/
    {session_id}/
      inputs/
      outputs/
      logs/
  ```

---

## Section 7 — Session Pod / OpenClaw Runtime

### Q7.1 How is OpenClaw launched inside a session pod?
- **Status**: 🟢 RESOLVED
- **Answer**: long-lived daemon process, one per session pod

### Q7.2 OpenClaw image: build custom or mount config on base image?
- **Status**: 🟢 RESOLVED
- **Answer**: base image with Node.js + OpenClaw installed; config mounted via ConfigMap/Secret

### Q7.3 How does the session pod talk back to the user (response egress)?
- **Status**: 🟢 RESOLVED
- **Answer**: OpenClaw handles Telegram/chat directly; chat gateway only maps chat_user → session

### Q7.4 What happens when the session pod crashes mid-task?
- **Status**: ⬜ DEFERRED
- **Notes**: for demo, restart policy `OnFailure` is sufficient; session state recovery is post-MVP

---

## Section 8 — Chat Integration

### Q8.1 For Telegram: bot token available and configured?
- **Status**: 🟡 DECISION NEEDED
- **Notes**: token wiring path is defined, but deploy-time secret provisioning still must be completed for Task 1 end-to-end

### Q8.2 Multi-user routing: how are different users mapped to different session pods?
- **Status**: 🟡 DECISION NEEDED
- **Draft**: `telegram_chat_id` → `session_id` mapping in metadata DB
- **Notes**: for single-user demo this is trivial; document the pattern for multi-user later

### Q8.3 Teams and Web API adapters: when to implement?
- **Status**: ⬜ DEFERRED
- **Notes**: architecture is designed to support them; implement after Task 1 is working

---

## Section 9 — Reproducibility and Deployment

### Q9.1 How are secrets managed across both systems?
- **Status**: 🟢 RESOLVED
- **Answer**: k8s Secrets, manually provisioned and documented in reproducibility guide

### Q9.2 Is there a single deploy script / makefile / helm chart?
- **Status**: 🟢 RESOLVED
- **Answer**: documented `kubectl apply` manifests + shell deploy script; Helm deferred later

### Q9.3 What CI/CD is expected for demo environment?
- **Status**: ⬜ DEFERRED
- **Notes**: demo is manually deployed; automate after first working slice

---

### Q1.6 What fixed NodePort values are assigned to cross-system services?
- **Status**: 🟢 RESOLVED
- **Answer**:
  - ollama: 30434
  - MinIO API: 30900
  - MinIO Console: 30901
  - Offload API: 30800
  - Control Plane API: 31000
  - LiteLLM external test port: 31400
- **Notes**: see `docs/port-map.md`

### Q1.7 What k3s install parameters are required for reproducibility?
- **Status**: 🟢 RESOLVED
- **Answer**: explicit pod CIDRs, service CIDRs, and disabled default components
- **Notes**: documented in `docs/port-map.md`

### Q1.8 Is there cross-cluster DNS between System A and System B?
- **Status**: 🟢 RESOLVED
- **Answer**: no; use IP:NodePort for all cross-system references

### Q1.9 Where are container images built and stored?
- **Status**: 🔴 OPEN
- **Why**: required for session pod, control plane, and worker images
- **Notes**: need decision on GHCR/Docker Hub/local registry/ctr import

### Q1.10 How is the onedal-build single-node validation environment set up?
- **Status**: 🟢 RESOLVED
- **Answer**: two separate k3s instances on one host, different ports/data dirs
- **Notes**: see `docs/single-node-validation.md`

### Q5.4 What exact result contract should offload/execution jobs produce?
- **Status**: 🔴 OPEN
- **Why**: required to implement Task 2 and Task 3 artifact/result collection consistently
- **Notes**: should define artifact path, metadata JSON, and success/failure schema

### Q7.5 What is the session pod lifecycle and cleanup policy?
- **Status**: 🟡 DECISION NEEDED
- **Why**: long-lived session pods need TTL/GC policy to avoid resource leaks
- **Notes**: define create-on-first-message and teardown behavior

### Q9.4 What is the image build/push workflow for demo images?
- **Status**: 🟡 DECISION NEEDED
- **Why**: reproducibility requires exact commands for build, tag, and deploy

## Next steps

Work through these questions in priority order:
1. Q1.2 — fill in actual System A / System B IPs and hostnames
2. Q1.9 / Q9.4 — choose image build and distribution path
3. Q5.1 / Q5.4 — finalize offload and result contracts
4. Q3.2 — provision cloud model API key
5. Q8.1 — confirm Telegram bot token
6. Q8.2 — decide chat_id → session_id mapping store
7. Q7.5 — define session pod cleanup / TTL behavior
