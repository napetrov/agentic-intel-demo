# Single-Node Validation Guide (onedal-build)

Use this guide to validate the full demo stack on `onedal-build`
before real System A / System B hardware is available.

---

## What onedal-build simulates

- **System A cluster** — agent session pods, control plane, LiteLLM
- **System B cluster** — vLLM SLM, MinIO, offload API, offload-worker
- Both run as two separate k3s instances on one machine
- Uses different API server ports (6443 / 6444) and data directories
- NodePorts still work — both clusters expose services on the same host IP
- Cross-cluster traffic = localhost:<NodePort>

---

## Hardware: onedal-build
- 8 vCPU, 32 GB RAM, Ubuntu
- Model: `Qwen/Qwen3-4B-Instruct-2507` via vLLM (canonical; needs
  16 CPU / 32Gi at 32768 ctx — drop `--max-model-len` to fit on a
  smaller host).
- Remaining for k3s + pods: ~24 GB on a fitted profile.

---

## Step 1 — Install two k3s instances

See `docs/port-map.md` for exact install commands.

Quick recap:
```bash
# System A: port 6443, CIDR 10.42/10.96, data-dir k3s-a
# System B: port 6444, CIDR 10.43/10.97, data-dir k3s-b
```

After install:
- kubeconfig for A: `/etc/rancher/k3s/k3s-a.yaml`
- kubeconfig for B: `/etc/rancher/k3s/k3s-b.yaml`
- Fix server IP in both files (replace 127.0.0.1 with LAN IP)

Verify:
```bash
kubectl --kubeconfig k3s-a.yaml get nodes  # one node Ready
kubectl --kubeconfig k3s-b.yaml get nodes  # one node Ready
```

---

## Step 2 — Deploy System B services first

### vLLM
```bash
APPLY=1 \
  CHART_REPO=https://github.com/<your-org>/Enterprise-Inference.git \
  CHART_REF=<tag|sha> \
  KUBECTL="kubectl --context system-b" \
  ./scripts/setup-system-b-vllm-local.sh
# Wait for Running, then verify (OpenAI-compatible):
curl http://localhost:30434/v1/models
```

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
./scripts/install-openclaw-operator.sh
./scripts/check-operator-prereqs.sh
kubectl apply -f examples/openclawinstance-intel-demo.yaml
# Instance name comes from metadata.name in the manifest above.
kubectl get openclawinstance intel-demo-operator -n default -o yaml
```

---

## Step 5 — End-to-end smoke test

`./scripts/smoke-test-operator-instance.sh` is a checklist printer — it
emits the `kubectl` commands you should run to verify the instance
reached a healthy state, it does not execute assertions or gate on
readiness. Run the suggested commands manually and confirm each one:

```bash
./scripts/smoke-test-operator-instance.sh   # prints the checklist
kubectl get crd openclawinstances.openclaw.rocks
kubectl get openclawinstance intel-demo-operator -n default -o yaml
kubectl get pods -A | grep -E 'openclaw|operator|intel-demo-operator'
```

Then send a test message through Telegram and verify a response comes
back.

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
- [ ] Control plane creates a session pod on `POST /sessions`
- [ ] Session pod starts, OpenClaw daemon running
- [ ] Tool execution works: `exec("echo hello")` returns result
- [ ] Model call from inside pod reaches LiteLLM and returns a response
- [ ] Artifact write/read roundtrip via Control Plane API works

End-to-end:
- [ ] Telegram message triggers session pod execution
- [ ] Agent returns result to Telegram
- [ ] Offload job submitted, worker runs, artifact returned (Task 2 path)
- [ ] Scale-up request creates sibling job, result collected (Task 3 path)

---

## What this validation proves before real hardware

- Two-cluster architecture works in principle
- vLLM on CPU (with AMX on GNR) is fast enough for demo UX
- Session pod image works (OpenClaw daemon, tools, model client)
- Control Plane correctly creates/terminates pods and jobs
- Cross-"cluster" (cross-NodePort) artifact and API paths work
- Actual RAM/CPU numbers for sizing real System A and System B hardware
