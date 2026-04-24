# Implementation Guide — Two-System Agentic Intel Demo

## Purpose
This document captures the working implementation path for the two-system demo, including the fixes discovered during bring-up, the scripts to run, and the exact configuration shape that produced a working setup.

It is written so the setup can be reproduced on another pair of systems with minimal guesswork.

---

## Scope
Two k3s systems:
- **System A**: session pods, control plane, LiteLLM
- **System B**: local vLLM/Qwen, MinIO, offload services

Primary goals:
1. Agent session execution on System A
2. Local SLM inference on System B
3. Artifact storage on System B
4. Reproducible deployment flow with scripts

---

## Final working state

### System A
- k3s running
- namespaces available: `agents`, `inference`, `platform`
- working components observed:
  - `session-sess-73e5759b2370`
  - `litellm`
  - `control-plane`
- cluster access requires `sudo kubectl` if using `/etc/rancher/k3s/k3s.yaml`
- disk pressure reduced from 89% to 87% via cleanup

### System B
- k3s running
- namespaces available: `default`, `system-b`, `kube-system`
- working components observed:
  - `vllm-qwen-3-4b-cpu`
  - `minio`
  - `offload-worker`
- vLLM confirmed with:
  - model: `Qwen/Qwen3-4B-Instruct-2507`
  - `max_model_len: 32768`
- PVC successfully provisioned and bound
- service exposed as NodePort

---

## What changed relative to the original plan

### Original plan assumptions
The original MVP docs assumed:
- System B would run `ollama`
- System B setup script would deploy `ollama.yaml`
- model pull would be done with `ollama pull qwen2.5:7b-instruct`
- LiteLLM on System A would target System B at NodePort `30434`

### What actually worked
The working System B path uses **vLLM**, not ollama.

That means:
- the old ollama-based setup path has been removed; use `scripts/setup-system-b-vllm.sh` as the current working path
- the System B model service is OpenAI-compatible via vLLM directly
- the deployed model is `Qwen/Qwen3-4B-Instruct-2507`
- the validated working context length is `32768`

---

## Critical bring-up findings

### 1. System A access issue was permissions, not TLS
Observed symptom:
- `kubectl` from the regular user failed on System A with permission denied on `/etc/rancher/k3s/k3s.yaml`

Actual cause:
- root-owned kubeconfig

Working fix:
```bash
sudo kubectl get pods -A
sudo kubectl get svc -A
```

Operational note:
- if reproducibility matters, either use `sudo kubectl` consistently or export a user-readable kubeconfig copy

Recommended fix:
```bash
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/system-a.yaml
sudo chown $USER:$USER ~/.kube/system-a.yaml
chmod 600 ~/.kube/system-a.yaml
sed -i 's/127.0.0.1/<SYSTEM_A_IP>/g' ~/.kube/system-a.yaml
```

### 2. System B vLLM default was too small
Observed state:
- vLLM exposed `/v1/models`
- model was healthy
- `max_model_len` was only `8192`

Impact:
- not aligned with the intended demo target
- insufficient for the target OpenClaw path discussed during debugging

Working fix:
- reinstall release with explicit `--max-model-len 32768`
- reduce resource footprint so the pod can actually schedule and start

### 3. Chart resource settings mattered
A failed upgrade revealed:
- `requests.cpu: 24`
- `limits.cpu: 16`

This is invalid in Kubernetes.

Working rule:
- requests must be less than or equal to limits
- for this demo, `cpu: 16` was used successfully

### 4. Memory settings blocked scheduling
A larger memory request caused scheduling failure on System B.

Observed scheduler blocker:
- insufficient memory

Working value:
- `memory: 32Gi`

### 5. PVC lifecycle was fragile during upgrade
A failed upgrade path caused:
- old PVC deletion
- replacement PVC issues
- Pending pod state

Working fix:
- clean reinstall of the release instead of patching the broken state in place

---

## Working System B configuration

The following values produced a working vLLM instance:

```yaml
LLM_MODEL_ID: Qwen/Qwen3-4B-Instruct-2507
cpu: 16
memory: 32Gi
tensor_parallel_size: "1"
pipeline_parallel_size: "1"
max_model_len: 32768
service:
  type: NodePort
pvc:
  enabled: true
defaultModelConfigs:
  configMapValues:
    VLLM_CPU_KVCACHE_SPACE: "8"
    VLLM_RPC_TIMEOUT: "100000"
    VLLM_ALLOW_LONG_MAX_MODEL_LEN: "1"
    VLLM_ENGINE_ITERATION_TIMEOUT_S: "120"
    VLLM_CPU_NUM_OF_RESERVED_CPU: "0"
    VLLM_CPU_SGL_KERNEL: "1"
    HF_HUB_DISABLE_XET: "1"
  extraCmdArgs:
    [
      "--block-size",
      "128",
      "--dtype",
      "bfloat16",
      "--max-model-len",
      "32768",
      "--distributed_executor_backend",
      "mp",
      "--enable_chunked_prefill",
      "--enforce-eager",
      "--max-num-batched-tokens",
      "1024",
      "--max-num-seqs",
      "64"
    ]
modelConfigs:
  "Qwen/Qwen3-4B-Instruct-2507":
    configMapValues:
      VLLM_CPU_KVCACHE_SPACE: "8"
      VLLM_RPC_TIMEOUT: "100000"
      VLLM_ALLOW_LONG_MAX_MODEL_LEN: "1"
      VLLM_ENGINE_ITERATION_TIMEOUT_S: "120"
      VLLM_CPU_NUM_OF_RESERVED_CPU: "0"
      VLLM_CPU_SGL_KERNEL: "1"
      HF_HUB_DISABLE_XET: "1"
    extraCmdArgs:
      [
        "--block-size",
        "128",
        "--dtype",
        "bfloat16",
        "--max-model-len",
        "32768",
        "--distributed_executor_backend",
        "mp",
        "--enable_chunked_prefill",
        "--enforce-eager",
        "--max-num-batched-tokens",
        "1024",
        "--max-num-seqs",
        "64",
        "--enable-auto-tool-choice",
        "--tool-call-parser", "hermes"
      ]
```

---

## Recommended repository changes

To make the setup reproducible, align the repo with the working implementation.

### Validated scripts
The old ollama-based `scripts/legacy/setup-system-b.sh` has been removed.
The current validated System B path uses vLLM:
- `scripts/setup-system-b-vllm.sh`
- `scripts/check-system-b-vllm.sh`

System A disk hygiene:
- `scripts/cleanup-system-a.sh`

---

## Step-by-step reproducible deployment

## Phase 0 — prerequisites

### Required hosts
- System A host with k3s
- System B host with k3s

### Required secrets
- Telegram bot token
- MinIO credentials
- control plane token
- any cloud model secrets used by LiteLLM

### Required local access
- SSH access to both systems
- sudo on System A and System B

---

## Phase 1 — verify clusters

### System A
```bash
ssh onedal-build
sudo kubectl get nodes
sudo kubectl get ns
sudo kubectl get pods -A
```

### System B
```bash
ssh system-b
kubectl get nodes
kubectl get ns
kubectl get pods -A
```

Expected:
- both clusters healthy
- all core kube-system pods running

---

## Phase 2 — deploy System B services

### 2.1 Deploy MinIO and offload-worker
If they are not already present:
```bash
kubectl -n system-b apply -f k8s/system-b/minio.yaml
kubectl -n system-b apply -f k8s/system-b/offload-worker.yaml
kubectl -n system-b rollout status deploy/minio --timeout=600s
kubectl -n system-b rollout status deploy/offload-worker --timeout=600s
```

### 2.2 Deploy vLLM using the working values
Use the chart source:
```bash
/home/ubuntu/Enterprise-Inference/core/helm-charts/vllm
```

Install with a generated values file:
```bash
helm install -n default vllm-qwen-3-4b-cpu /home/ubuntu/Enterprise-Inference/core/helm-charts/vllm -f /tmp/vllm-qwen-clean.yaml
```

### 2.3 Verify vLLM
```bash
kubectl -n default get pod -l app.kubernetes.io/instance=vllm-qwen-3-4b-cpu
kubectl -n default logs deploy/vllm-qwen-3-4b-cpu --tail=100
kubectl -n default port-forward svc/vllm-qwen-3-4b-cpu-service 18080:80
curl http://127.0.0.1:18080/v1/models
```

Expected:
- `max_model_len: 32768`
- model `Qwen/Qwen3-4B-Instruct-2507`

---

## Phase 3 — deploy System A services

### 3.1 Apply RBAC, LiteLLM, control-plane
```bash
kubectl --kubeconfig ~/.kube/system-a.yaml apply -f k8s/system-a/rbac.yaml
kubectl --kubeconfig ~/.kube/system-a.yaml apply -f k8s/system-a/litellm.yaml
kubectl --kubeconfig ~/.kube/system-a.yaml apply -f k8s/system-a/control-plane.yaml
kubectl --kubeconfig ~/.kube/system-a.yaml rollout status deploy/litellm -n inference --timeout=600s
kubectl --kubeconfig ~/.kube/system-a.yaml rollout status deploy/control-plane -n platform --timeout=600s
```

### 3.2 Verify
```bash
sudo kubectl get pods -A
sudo kubectl get svc -A
curl http://<SYSTEM_A_IP>:31400/health/liveliness
curl http://<SYSTEM_A_IP>:31000/health
```

---

## Phase 4 — smoke test

### Operator-managed instance
`./scripts/smoke-test-operator-instance.sh` only prints a suggested
checklist — it does not run assertions. Run it to get the commands, then
execute them manually and confirm the instance is healthy:

```bash
./scripts/smoke-test-operator-instance.sh
kubectl get crd openclawinstances.openclaw.rocks
kubectl get openclawinstance intel-demo-operator -n default -o yaml
kubectl get pods -A | grep -E 'openclaw|operator|intel-demo-operator'
```

### System B model path
```bash
kubectl -n default port-forward svc/vllm-qwen-3-4b-cpu-service 18080:80
curl http://127.0.0.1:18080/v1/models
```

### MinIO path
```bash
curl http://<SYSTEM_B_IP>:30900/minio/health/live
```

---

## Recommended scripts to add

## 1. `scripts/setup-system-b-vllm.sh`
Purpose:
- clean install of vLLM on System B
- write working values file
- run helm install/upgrade
- wait for rollout
- run verification curl

## 2. `scripts/check-system-b-vllm.sh`
Purpose:
- verify pod state
- verify PVC state
- verify `/v1/models`
- verify `max_model_len`

## 3. `scripts/cleanup-system-a.sh`
Purpose:
- trim journals
- prune container images if safe
- clear temp files
- print before/after disk usage

---

## Known caveats

### 1. NodePort direct reachability
Direct host curl to the NodePort did not behave consistently during validation.

However:
- pod was healthy
- service existed
- port-forward worked
- model endpoint worked

Recommendation:
- treat `port-forward + /v1/models` as authoritative functional validation
- separately debug host firewall / k3s service exposure if NodePort host access is mandatory

### 2. System A kubeconfig permissions
Do not assume plain `kubectl` works for the normal user on System A.
Document either:
- `sudo kubectl`
- or a copied user kubeconfig

### 3. Chart assumptions
The vLLM chart expects `defaultModelConfigs.extraCmdArgs` to exist.
If omitted, template rendering can fail.

---

## Plan vs actual summary

| Topic | Original docs | Actual working result |
|------|------|------|
| System B model service | ollama | vLLM |
| Model | qwen2.5:7b-instruct | Qwen/Qwen3-4B-Instruct-2507 |
| API shape | ollama API | OpenAI-compatible `/v1/models` |
| max context | not fixed in script | validated at 32768 |
| System A access | standard kubectl assumed | sudo kubectl required unless kubeconfig copied |
| System B sizing | not tuned | cpu 16, memory 32Gi worked |
| recovery strategy | patch in place implied | clean reinstall was safer |

---

## Acceptance checklist

A setup is considered good when all items below pass:

### System A
- [ ] `sudo kubectl get pods -A` works
- [ ] session pod running
- [ ] LiteLLM running
- [ ] control-plane running
- [ ] root filesystem usage below emergency threshold

### System B
- [ ] `kubectl get pods -A` works
- [ ] `vllm-qwen-3-4b-cpu` pod is `Running`
- [ ] `vllm-qwen-3-4b-cpu-pvc` is `Bound`
- [ ] port-forward to service works
- [ ] `/v1/models` returns `max_model_len: 32768`
- [ ] `minio` running
- [ ] `offload-worker` running

---

## Operator path status
The operator-managed deployment path is the intended and only supported instance lifecycle path.

What was observed:
- the operator controller deployment came up
- the CRD `openclawinstances.openclaw.rocks` hit a real Kubernetes annotation-size blocker when installed via raw `kubectl apply -k`
- after working around the CRD install, an `OpenClawInstance` creation path started
- an instance named `intel-demo-operator` reached `Provisioning`

Important conclusion:
- the operator path is the source of truth
- the remaining gap is reproducibility of install/recovery and committing the missing operator-owned artifacts into the repo

Use `docs/operator-runbook.md` and `docs/operator-gap-analysis.md` as the source of truth for operator-specific install, recovery, and missing work.

## Next documentation step
After this document, create or maintain:
1. `scripts/setup-system-b-vllm.sh`
2. `scripts/check-system-b-vllm.sh`
3. `scripts/cleanup-system-a.sh`
4. `docs/operator-runbook.md`
