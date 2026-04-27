# Single-Node Validation Guide

Use this guide to validate the full Tier 2 stack on **one machine** before
real System A / System B hardware is available. Two k3s instances run
side-by-side on the same host and emulate the cross-cluster path.

This is a sanity-check rig, not the demo path — for a real bring-up follow
`docs/runbooks/tier2-bring-up.md`.

---

## What this rig simulates

- **System A cluster** — agent session pods, control plane, LiteLLM
- **System B cluster** — vLLM SLM, MinIO, offload-worker
- Both run as two separate k3s instances on one machine
- Different API server ports and data directories
- NodePorts still work — both clusters expose services on the same host IP
- Cross-cluster traffic = `localhost:<NodePort>`

> The earlier version of this guide was pinned to a specific lab host
> (`onedal-build`). This version is host-neutral; size the fitted profile
> below to whatever single machine you actually have.

---

## Hardware target

Pick a fitted profile based on the host you have:

| Host | Fits |
|---|---|
| 8 vCPU / 32 GB | vLLM at `MAX_MODEL_LEN=8192` + everything else; the 32768 ctx shipped default will not schedule. |
| 16+ vCPU / 64+ GB | full default Tier 2 profile (Qwen3-4B at 32768 ctx, 16 CPU / 32Gi). |

In all cases, vLLM serves `Qwen/Qwen3-4B-Instruct-2507` on NodePort 30434
(OpenAI-compatible).

---

## Step 1 — Install two k3s instances

See `docs/port-map.md` for exact install flags.

Quick recap:
```bash
# System A: port 6443, CIDR 10.42/10.96, data-dir k3s-a
# System B: port 6444, CIDR 10.43/10.97, data-dir k3s-b
```

After install:
- kubeconfig for A: `/etc/rancher/k3s/k3s-a.yaml`
- kubeconfig for B: `/etc/rancher/k3s/k3s-b.yaml`
- Replace `127.0.0.1` in both kubeconfigs with the LAN IP so cross-context
  traffic works.

Verify:
```bash
kubectl --kubeconfig k3s-a.yaml get nodes  # one node Ready
kubectl --kubeconfig k3s-b.yaml get nodes  # one node Ready
```

If you don't have root / can't run two k3s servers, `k3d` or `kind` with
two clusters works equally well — the rest of this guide only depends on
having `system-a` / `system-b` contexts.

---

## Step 2 — Deploy System B services first

### vLLM (fitted profile for an 8 vCPU host)

`scripts/setup-system-b-vllm-local.sh` defaults to 16 CPU / 32Gi / 32768
context, which won't schedule on a small host. Override the resource and
context env knobs explicitly:

```bash
APPLY=1 \
  CHART_REPO=https://github.com/<your-org>/Enterprise-Inference.git \
  CHART_REF=<tag|sha> \
  CPU=4 \
  MEMORY=12Gi \
  MAX_MODEL_LEN=8192 \
  MAX_BATCHED_TOKENS=2048 \
  MAX_NUM_SEQS=8 \
  KV_CACHE_SPACE=2 \
  KUBECTL="kubectl --context system-b" \
  ./scripts/setup-system-b-vllm-local.sh
# Wait for Running, then verify (OpenAI-compatible):
curl http://localhost:30434/v1/models
```

The full Tier 2 profile is in `docs/demo-setup.md` "Hardware and network
requirements".

### MinIO
```bash
kubectl --context system-b apply -f k8s/system-b/minio.yaml
kubectl --context system-b rollout status deploy/minio -n system-b
# Verify (from host):
curl http://localhost:30900/minio/health/live
```

---

## Step 3 — Deploy System A services

### LiteLLM
```bash
kubectl --context system-a apply -f k8s/system-a/litellm.yaml
# Verify — call from a test pod on System A or from host via NodePort 31400:
curl http://localhost:31400/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"ping"}]}'
```

### Control Plane
```bash
kubectl --context system-a apply -f k8s/system-a/rbac.yaml
kubectl --context system-a apply -f k8s/system-a/control-plane.yaml
# Verify:
curl http://localhost:31000/health
```

---

## Step 4 — Install `openclaw-operator` and apply an `OpenClawInstance`

The session-pod image is built and loaded by `openclaw-operator` (external
upstream project — see `docs/operator-install.md`). Single-node validation
uses the same path as a real cluster.

```bash
APPLY=1 OPENCLAW_OPERATOR_REF=v0.30.0 ./scripts/install-openclaw-operator.sh
./scripts/check-operator-prereqs.sh
kubectl --context system-a apply -f examples/openclawinstance-intel-demo.yaml
kubectl --context system-a get openclawinstance intel-demo-operator -o yaml
```

---

## Step 5 — End-to-end smoke test

```bash
# KEEP=1 leaves the OpenClawInstance Running so the demo-task smoke
# below has a live gateway/session to talk to. Without KEEP=1 the
# lifecycle smoke deletes the instance at the end and the next step
# fails with "no openclawinstance found".
APPLY=1 KEEP=1 ./scripts/smoke-test-operator-instance.sh
APPLY=1 SYSTEM_A_KUBECTL="kubectl --context system-a" \
  ./scripts/smoke-test-demo-task.sh
APPLY=1 ./scripts/smoke-test-offload-k8s.sh   # optional: full offload roundtrip

# When you're done, drop the instance:
APPLY=1 ./scripts/teardown-openclaw-instance.sh
```

Then send a test message through Telegram and verify a response comes back.

---

## Validation checklist

Infrastructure:
- [ ] Both k3s clusters show nodes Ready
- [ ] Pod CIDRs confirmed non-overlapping (10.42 vs 10.43)
- [ ] No NodePort conflicts (check with `ss -tlnp | grep 30`)

Inference:
- [ ] vLLM pod Ready and serving the configured model
- [ ] vLLM responds: `curl localhost:30434/v1/models`
- [ ] LiteLLM routes to vLLM: `curl localhost:31400/v1/chat/completions`
- [ ] Measure first-token latency (target <10s on 8 vCPU at fitted profile)
- [ ] Two concurrent requests don't OOM

Storage:
- [ ] MinIO accessible at `localhost:30900`
- [ ] Write test: `aws s3 cp test.txt s3://demo-artifacts/test/ --endpoint-url http://localhost:30900`
- [ ] Read test from inside a test pod (simulates cross-cluster)

Agent session:
- [ ] Operator-managed `OpenClawInstance` reaches Ready
- [ ] Session pod created via the operator on demand
- [ ] Tool execution works: `exec("echo hello")` returns result
- [ ] Model call from inside pod reaches LiteLLM and returns a response
- [ ] Artifact write/read roundtrip via Control Plane API works

End-to-end:
- [ ] Telegram message triggers a session
- [ ] Agent returns result to Telegram
- [ ] Offload job submitted, worker runs, artifact returned (market-research path)

---

## What this validation proves before real hardware

- Two-cluster architecture works in principle
- vLLM on CPU (with AMX on GNR) is fast enough for demo UX
- Session pod image works (OpenClaw daemon, tools, model client)
- Operator-managed lifecycle correctly creates/terminates pods and jobs
- Cross-"cluster" (cross-NodePort) artifact and API paths work
- Actual RAM/CPU numbers for sizing real System A and System B hardware
