# Operator Gap Analysis

This document treats `openclaw-operator` as the canonical and only supported lifecycle path for OpenClaw instances in this repo.

That means:
- instance creation must happen through `OpenClawInstance`
- instance updates must happen through `OpenClawInstance`
- instance deletion/reset must happen through operator-managed resources
- raw pod/deployment creation is implementation history, not the target operating model

---

## Target state

A fresh deploy should be considered correct only when all of the following are true:
- CRD `openclawinstances.openclaw.rocks` exists
- operator controller is Running
- one sample `OpenClawInstance` can be created successfully
- the instance reaches a healthy Ready-like state
- the gateway/service exposed by that instance is usable
- required secrets and config are described in repo, not only in chat history

---

## What already exists

### Confirmed
- operator deployment path was exercised during bring-up
- CRD installation issue was identified precisely
- `OpenClawInstance` creation was attempted successfully enough to reach `Provisioning`
- a sample instance name is known: `intel-demo-operator`

### Now added to repo
- `docs/operator-runbook.md`
- `docs/operator-gap-analysis.md`
- `examples/openclawinstance-intel-demo.yaml`
- `scripts/check-operator-prereqs.sh`
- `scripts/install-openclaw-operator.sh` — server-side CRD apply + pinning warning
- `scripts/create-operator-secrets.sh` — render `intel-demo-operator-secrets` from env
- `scripts/smoke-test-operator-instance.sh` — real create → wait-ready → optional gateway probe → delete
- `scripts/teardown-openclaw-instance.sh` — operator-owned CR delete + optional PVC/secret cleanup

---

## Remaining gaps

### 1. Exact operator source/bundle is not pinned
Status: open

What is missing:
- exact repo/ref/tag/commit of operator manifests
- exact install command sequence to fetch/build/apply them

Why it matters:
- without a pinned source, the operator install is not reproducible

### 2. CRD-safe install process is not automated
Status: closed

`scripts/install-openclaw-operator.sh` applies the CRD with `--server-side`
by default (`MODE=server-side-crd`) and falls back to `create || replace`
under `MODE=create-replace-crd`. It also fails fast if the operator overlay
still references `../crd` (which would re-apply the CRD client-side and
re-introduce the `metadata.annotations: Too long` failure).

### 3. Secret contract for operator-managed instance is incomplete
Status: closed

The required Secret is `intel-demo-operator-secrets` in the instance's
namespace, with these keys (used by `OpenClawInstance.spec.envFromSecrets`
in `examples/openclawinstance-intel-demo.yaml`):

- `TELEGRAM_BOT_TOKEN`
- `AWS_BEARER_TOKEN_BEDROCK`
- `SAMBANOVA_API_KEY`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`

Materialize it from env with `scripts/create-operator-secrets.sh`
(uses `kubectl create secret --dry-run=client -o yaml | kubectl apply`,
so values never land on disk).

### 4. Operator image contract is not fully defined
Status: open

What is missing:
- final image reference for operator-managed OpenClaw runtime
- whether image is pulled from GHCR or preloaded locally
- if private, imagePullSecret requirements

### 5. Health/ready criteria are not yet documented precisely
Status: partially closed

`scripts/smoke-test-operator-instance.sh` encodes the current best-known
success contract:
- CRD `openclawinstances.openclaw.rocks` exists
- controller `deploy/openclaw-operator-controller-manager` rollout completes
- `kubectl wait --for=condition=Ready openclawinstance/<name>` succeeds, OR
- `.status.phase` reaches one of `Ready|Running|Active|Healthy`
- with `PROBE_GATEWAY=1`, the gateway service responds to `/healthz`

On failure it dumps `describe openclawinstance`, controller logs, and pod
list scoped to `openclaw.rocks/instance=<name>`.

Still open: pin the exact `.status.phase` / Ready condition that the
upstream operator surfaces in the pinned ref, so the fallback list above
can be replaced with a single canonical check.

### 6. Old raw control-plane path still dominates repo structure
Status: open

What is missing:
- docs and scripts should stop presenting raw pod/control-plane creation as the main path
- repo structure should make operator-first flow obvious

---

## Decision now adopted

For this repo, `openclaw-operator` is the only supported instance-management path.

Consequences:
- old control-plane/session-pod-template flow should be treated as transitional history or auxiliary implementation material
- all user-facing deployment docs should point first to operator install + `OpenClawInstance`
- any smoke test for instance lifecycle should verify operator-managed resources, not direct pod creation

---

## Recommended next repo changes

### Highest priority
1. ~~add an operator install script~~ — done (`scripts/install-openclaw-operator.sh`)
2. ~~add a secret template for operator-managed instance~~ — done (`scripts/create-operator-secrets.sh` + template)
3. ~~add a smoke test that creates/checks/deletes `OpenClawInstance`~~ — done (`scripts/smoke-test-operator-instance.sh` + `teardown-openclaw-instance.sh`)
4. rewrite main docs to make operator the default path

### Second priority
1. ~~move legacy control-plane path into `docs/legacy/` or mark clearly as non-canonical~~ — done (legacy/ and scripts/legacy/ removed)
2. pin exact operator source ref (`OPENCLAW_OPERATOR_REF=<tag|sha>`); the install script now warns when left at `main`
3. document exact Ready verification output from a successful cluster (the smoke test currently auto-detects between condition `Ready` and `.status.phase`)
