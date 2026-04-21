# Plan vs Actual — Two-System Demo

## Purpose
This document compares the original demo plan with the implementation details that actually worked during bring-up.

It should be read together with:
- `docs/mvp-plan.md`
- `docs/implementation-guide.md`

---

## Executive summary
The architecture direction stayed mostly correct:
- System A for orchestration and agent sessions
- System B for local inference and shared services
- Kubernetes on both sides
- NodePort-based cross-system connectivity

The main implementation drift happened on **System B inference**:
- the original plan assumed **ollama**
- the validated working path ended up using **vLLM**

That is the single biggest difference between plan and reality.

---

## Side-by-side comparison

| Area | Original plan | Actual working result | Status |
|------|---------------|-----------------------|--------|
| System A runtime | k3s | k3s | matched |
| System B runtime | k3s | k3s | matched |
| System A role | session pods, control plane, LiteLLM | session pods, control plane, LiteLLM | matched |
| System B role | local model, MinIO, offload | local model, MinIO, offload | matched |
| System B model backend | ollama | vLLM | changed |
| Model family | qwen2.5:7b-instruct | Qwen/Qwen3-4B-Instruct-2507 | changed |
| API style on System B | ollama API | OpenAI-compatible vLLM API | changed |
| Context target | not concretely locked in script | 32768 validated | improved |
| Cross-system exposure | fixed NodePorts | fixed NodePorts | matched |
| Artifact storage | MinIO on System B | MinIO on System B | matched |
| Offload service | planned | present as service/worker path | partially matched |
| Session cluster access | assumed standard kubeconfig flow | required sudo/root-aware handling on A | adjusted |

---

## What stayed correct from the plan

### 1. Two-system split
The original split was good:
- System A should host the user-facing orchestration layer
- System B should host local inference and shared services

This stayed valid.

### 2. Fixed NodePorts
The fixed port map approach was correct and useful.
It made debugging and cross-system wiring easier.

### 3. Declarative k8s deployment model
Using Kubernetes manifests and Helm-backed services remained the right approach.

### 4. MinIO as shared artifact store
This stayed valid and still makes sense for reproducibility.

---

## What changed in practice

### 1. ollama was not the final working inference path
Planned:
- deploy ollama
- pull model via ollama
- expose ollama endpoint

Actual:
- a working bring-up was achieved with vLLM
- vLLM exposed `/v1/models`
- context length and model runtime were easier to validate directly in logs and API responses

Implication:
- any reproduction doc must treat **vLLM as the primary current path**
- ollama should be documented only as an alternative unless we intentionally switch back

### 2. Resource tuning mattered much more than expected
Planned docs did not pin a realistic working CPU/memory profile for the current Qwen path.

Actual working result on System B:
- `cpu: 16`
- `memory: 32Gi`
- `max_model_len: 32768`
- `max_num_batched_tokens: 1024`
- `max_num_seqs: 64`

Implication:
- deployment docs should publish these as known-good values

### 3. System A access assumptions were too optimistic
Planned docs assumed standard kubeconfig usage.

Actual:
- System A kubeconfig under `/etc/rancher/k3s/k3s.yaml` was root-only
- operationally, `sudo kubectl` was required unless a user kubeconfig copy is created

Implication:
- reproducibility docs must include this explicitly

### 4. Recovery strategy needed to be more explicit
Planned flow implied patch/upgrade-style evolution.

Actual:
- once System B release drifted into broken PVC/resource states, clean reinstall was safer than incremental fixups

Implication:
- docs should include a defined reset/reinstall path, not only happy-path install

---

## Problems discovered and how they were addressed

### Problem: System A looked inaccessible
Observed:
- permission denied reading kubeconfig

Addressed by:
- using `sudo kubectl`
- documenting user-kubeconfig copy as a better long-term option

### Problem: System B model came up with `8192` context
Observed:
- model was alive but not at the target context length

Addressed by:
- explicit vLLM args with `--max-model-len 32768`
- reducing other runtime parameters to keep the pod schedulable

### Problem: Helm upgrade broke resources
Observed:
- invalid CPU request/limit relationship

Addressed by:
- moving to consistent values
- reinstalling cleanly

### Problem: Pod could not schedule
Observed:
- memory too high for node capacity under real load

Addressed by:
- reducing to `32Gi`

### Problem: PVC lifecycle drifted into a broken state
Observed:
- upgrade path produced deleted/missing PVC issues

Addressed by:
- clean reinstall instead of patching the broken release state

### Problem: Disk pressure on System A
Observed:
- root filesystem at 89%

Addressed by:
- journal cleanup and safe cache cleanup
- reduced to 87%

---

## Final accepted implementation choices

### System A
- k3s
- LiteLLM
- control-plane
- session pods
- `sudo kubectl` or exported user kubeconfig

### System B
- k3s
- vLLM, not ollama, as the current working path
- MinIO
- offload-worker/service path
- Qwen/Qwen3-4B-Instruct-2507
- 32768 context

---

## Recommendation for future docs

### Source of truth priority
1. `docs/implementation-guide.md`
2. this file, `docs/plan-vs-actual.md`
3. older planning docs like `docs/mvp-plan.md`

### Recommended wording
Do not say:
- “the demo uses ollama”

Say instead:
- “the original plan used ollama, but the currently validated working path uses vLLM”

---

## Reproduction-ready conclusion
The plan was directionally correct, but the implementation needed concrete operational corrections:
- vLLM instead of ollama
- explicit resource tuning
- explicit kubeconfig permission handling on System A
- explicit reset/reinstall guidance for System B

Those corrections are now documented and should be treated as part of the implementation, not as incidental debugging noise.
