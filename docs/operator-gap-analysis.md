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
Status: open

What is missing:
- a script or documented command sequence that applies CRDs separately and safely
- ideally server-side apply for the CRD stage

Why it matters:
- this is the one known real blocker observed on-cluster

### 3. Secret contract for operator-managed instance is incomplete
Status: open

What is missing:
- exact secret manifest template for `intel-demo-operator-secrets`
- exact list of required keys
- namespace expectations

Likely required keys include:
- `TELEGRAM_BOT_TOKEN`
- `AWS_BEARER_TOKEN_BEDROCK`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- any additional provider credentials used by the instance

### 4. Operator image contract is not fully defined
Status: open

What is missing:
- final image reference for operator-managed OpenClaw runtime
- whether image is pulled from GHCR or preloaded locally
- if private, imagePullSecret requirements

### 5. Health/ready criteria are not yet documented precisely
Status: open

What is missing:
- canonical success condition for `OpenClawInstance`
- expected services, pods, conditions, or status fields
- failure signatures and which logs to inspect first

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
1. add an operator install script
2. add a secret template for operator-managed instance
3. add a smoke test that creates/checks/deletes `OpenClawInstance`
4. rewrite main docs to make operator the default path

### Second priority
1. ~~move legacy control-plane path into `docs/legacy/` or mark clearly as non-canonical~~ — done (legacy/ and scripts/legacy/ removed)
2. pin exact operator source ref
3. document exact Ready verification output from a successful cluster
