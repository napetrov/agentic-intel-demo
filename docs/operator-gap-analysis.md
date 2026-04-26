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
Status: candidate pinned, awaiting on-stand verification

What is in repo:
- `scripts/install-openclaw-operator.sh` defaults `OPENCLAW_OPERATOR_REF`
  to `v0.30.0` (the latest upstream release at repo-pin time).
- `config/versions.yaml` `operator.ref` mirrors the same value.
- The script prints a "candidate ref" notice unless
  `OPENCLAW_OPERATOR_REF_VERIFIED=1` is set, so a deployer who hasn't
  validated against their own stand sees that explicitly.

What is still open:
- The candidate has NOT been re-validated end-to-end on this demo's
  stand. Bumping the default on every upstream release without a green
  smoke test would silently break Tier 2.

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
Status: candidate pinned, awaiting on-stand verification

What is in repo:
- `examples/openclawinstance-intel-demo.yaml` `spec.image.tag` defaults
  to `v0.30.0` (mirrors the operator binary release).
- `config/versions.yaml` `operator.image` carries the same default.

What is still open:
- The runtime image is published independently from the operator binary
  upstream — a future upstream release may bump only one of the two.
  Confirm both tags resolve before promoting past dry-run.
- imagePullSecret requirements (when the registry becomes private).

### 5. Health/ready criteria are not yet documented precisely
Status: candidate pinned, awaiting on-stand verification

`scripts/smoke-test-operator-instance.sh` defaults `READY_JSONPATH` to
`{.status.phase}` and accepts `Running` (canonical for upstream
v0.30.0) plus the historical fallback enum `Ready|Active|Healthy|True`.
Set `READY_JSONPATH=` (empty) to fall through to the legacy
`condition=Ready` then `.status.phase` heuristic.

Other surfaces of the success contract:
- CRD `openclawinstances.openclaw.rocks` exists
- controller `deploy/openclaw-operator-controller-manager` rollout completes
- with `PROBE_GATEWAY=1`, the gateway service responds to `/healthz`

On failure the script dumps `describe openclawinstance`, controller logs,
and pod list scoped to `openclaw.rocks/instance=<name>`.

`config/versions.yaml` `operator_ready.phase=Running` is the canonical
shared source of truth between docs and the smoke test. Bumping the
operator ref may shift this; re-verify before promoting.

### 6. Old raw control-plane path still dominates repo structure
Status: closed

The repo now treats `openclaw-operator` as the canonical lifecycle:
- `README.md` "Recommended first slice" leads with the operator path; the
  `docker compose` / `dev-up.sh` Tier 1 stack is now explicitly labelled as
  *local dev/smoke only*, not the demo path.
- `docs/runbooks/tier2-bring-up.md` is the canonical bring-up checklist
  (preflight → secrets → System B → System A → operator → instance →
  Telegram → demo task → logs).
- The previous raw `legacy/` and `scripts/legacy/` trees are removed.

`runtimes/control-plane/` is retained as the offload relay (it implements
`POST /offload` / `GET /artifacts/{ref}`) — the operator manages session
lifecycle, the control-plane only relays offload tasks to System B.

### 7. vLLM helm chart is not pinned in the repo
Status: open

The chart `setup-system-b-vllm-local.sh` installs lives in a fork the
demo doesn't redistribute (the upstream Enterprise-Inference layout at
`core/helm-charts/vllm`). The script now fails fast when `CHART_REPO`
is left as a `<your-org>` placeholder, and points at an alternative
static manifest at `k8s/system-b/vllm.yaml` that runs vLLM directly
without the chart — but that manifest leaves the image tag at `latest`
because there is no public CPU-tuned vLLM image we can validate
against. Same shape as gaps #1 and #4: an external project the demo
depends on but doesn't own.

What is still open:
- pin a known-good `CHART_REPO`/`CHART_REF` once a public mirror or
  internal fork is available, OR
- pin a CPU-tuned image tag in `k8s/system-b/vllm.yaml` once one is
  validated against the demo's hardware tier.

### 8. Job/session registry was not durable
Status: closed

`runtimes/control-plane/persistence.py` ships a SQLite-backed
`SqliteJsonStore`; both the offload-job registry (`_jobs` in app.py)
and `LocalSessionBackend._records` write through to it when
`JOBS_DB_PATH` / `SESSIONS_DB_PATH` are set. The compose file mounts
`control-plane-data:/var/lib/control-plane`; `dev-up.sh` uses
`$STATE_DIR/{jobs,sessions}.db`. A `docker compose restart
control-plane` no longer drops issued `result_ref`s or wipes the
multi-agent fan-out table.

Unit coverage: `tests/test_persistence.py` exercises both
restart-survival paths and the lazy-state-machine persisting its
terminal transitions.

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
