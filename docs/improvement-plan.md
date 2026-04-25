# Improvement Plan

Written after a local analysis and trial run of the repo on 2026-04-21, with a follow-up k3s session on 2026-04-22. This document lists concrete, actionable improvements grouped by severity, and records what was actually executed locally vs. what only describes a remote cluster.

The repo's operator-first direction (see `docs/operator-gap-analysis.md`) is accepted as the target. This plan is about closing the gap between that stated direction and what the repo currently contains.

---

## 1. What I ran locally

Local environment: Linux sandbox, Python 3.12 venv, Node 22, Docker Hub blocked, `ghcr.io` / `registry.k8s.io` / `github.com` reachable, no remote SSH hosts.

| Component | Command | Result |
|-----------|---------|--------|
| `web-demo` | `python3 -m http.server 8080` (inside `web-demo/`) | Serves 200 for `/`, `/app.js`, `/styles.css`. |
| `web-demo/app.js` | `node --check web-demo/app.js` | **Failed before fix** — syntax error on line 281 caused by a shell-style `'\''` quote escape inside a single-quoted JS string literal. **Fixed**. After fix: passes. |
| `runtimes/offload-worker` | `uvicorn app:app` with pinned deps from the Dockerfile, dummy `MINIO_*` env | `/health` returns `{"status":"ok"}`. `echo`, `pandas_describe`, `sklearn_train` all return valid results. |
| `runtimes/offload-worker/tests/` | `pytest` (added in this change) | 7/7 pass: health, echo, pandas-from-dict, pandas-from-CSV-string, sklearn_train, unknown-task error path, 422 validation. |
| All `*.sh` in `scripts/` | `bash -n` | All pass. |
| All `*.yaml` / `*.yml` | `yaml.safe_load_all` | All parse. |
| All `*.py` | `python3 -m py_compile` | All pass. |
| `k8s/` + `examples/` manifests | `kubeconform -strict -ignore-missing-schemas -skip CustomResourceDefinition` | 35/36 valid, 1 skipped (OpenClawInstance CR — no CRD to validate against). |
| k3s v1.31.4 single node | `k3s server --disable traefik --disable metrics-server` | Came up Ready. API server / scheduler / controller-manager healthy. `envsubst` + `kubectl apply --server-side` succeeded on every manifest after the namespace fixes below. **No pod could actually start** — the sandbox's runc blocks pod-sandbox creation (`can't get final child's PID from pipe: EOF`); sandbox limit, not a repo issue. |

What I could **not** run locally:
- Actual workloads — sandbox container runtime blocks all pod-sandbox creation
- `openclaw-operator` install — operator image ref not pinned anywhere in the repo (operator-gap #4)
- LiteLLM / vLLM / Telegram — require real credentials and remote hosts
- `scripts/apply-operator-chat-config.sh` / `scripts/setup-system-b-vllm.sh` — they `ssh` into a fixed host (`onedal-build`)
- MinIO / Ollama image pulls — images live on Docker Hub, which the sandbox can't reach

### Update (2026-04-25): no-Docker dev path closed several of these

The original blocker — "MinIO image can't be pulled, so the artifact-backed
path can't run locally" — is now bypassed. `scripts/dev-up.sh` brings up
`moto[server]` on `:9000` as a drop-in S3-compatible substitute, plus the
three FastAPI runtimes and a small static + `/api/*` proxy
(`scripts/dev_web_proxy.py`) that mirrors `web-demo/nginx.conf`. The
large-result path (`task_type=echo` >4KB → MinIO put → presigned URL →
browser fetch) was verified end-to-end against `moto`. Tear down with
`scripts/dev-down.sh`. State lives under `.dev-up/` (gitignored).

What this gets us:
- `git clone && ./scripts/dev-up.sh` works without any container runtime.
- 47 → 55 unit tests (added probe + classifier-fallback + LLM-hook tests).
- The `agent_invoke` "command" path no longer 5xx's on misclassified verbs;
  it falls back to echo with a transparent trace entry.
- The "Platform health" rail no longer lies. OpenClaw / LiteLLM / SambaNova
  probes are honest via `GET /api/probe/{name}`; unconfigured probes show
  a neutral `idle` dot instead of mirroring control-plane health.

---

## 2. Real bugs found

### 2.1 `web-demo/app.js` was not valid JavaScript (fixed independently on main)
Line 281 used shell-style `'\''` quote escaping inside a JS string literal. The file would throw a `SyntaxError` on load in any browser, which silently breaks the "Run demo" button and every scenario renderer (`renderScenario` is never reached because the file doesn't parse). This PR initially fixed it by switching the outer quotes to double quotes; main's commit `c435e66` fixed the same line by escaping the inner `sed -n` arg differently. The two fixes are equivalent — main's landed first, this branch now carries main's version via merge. Either way the file now parses.

Follow-up: a one-line check in CI (`node --check web-demo/*.js`) would have caught it.

### 2.2 `offload-worker` leaks full Python tracebacks
`runtimes/offload-worker/app.py:62` returns `traceback.format_exc()` as the `error` field in `TaskResult`. For a demo that is fine, but this is advertised as production-shaped FastAPI — the line should either log the traceback server-side and return a short error message, or be gated behind a `DEBUG` env.

### 2.3 Secrets inlined as env `value` in k8s manifests
`k8s/system-a/litellm.yaml:68-72` pushes `SAMBANOVA_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `TELEGRAM_BOT_TOKEN` (in `session-pod-template.yaml`) as `value: "${VAR}"`, which assumes an unadvertised `envsubst` pre-step and bypasses the `k8s/shared/intel-demo-operator-secrets.yaml.template` that already exists. These should move to `valueFrom: secretKeyRef`, and the apply scripts should `kubectl create secret` (or `kustomize` overlay) explicitly.

### 2.4 Version drift

| File | Says |
|------|------|
| `config/versions.yaml` | `litellm: v1.72.2-stable`, `ollama: 0.6.8`, model `qwen2.5:7b-instruct` |
| `k8s/system-a/litellm.yaml` | image `ghcr.io/berriai/litellm:main-v1.63.11-stable` |
| `README.md` / operator runbook | vLLM + `Qwen/Qwen3-4B-Instruct-2507`, 32768 context, 16 CPU / 32Gi |

`config/versions.yaml` is the wrong source of truth; it still describes the earlier ollama path. Either update it to vLLM/Qwen3 or delete it (the operator-first path embeds version info in the helm values + OpenClawInstance spec).

### 2.5 Model-alias drift across the stack
Three layers name the models differently, and none of them match:

| Layer | Names used |
|-------|-----------|
| `docs/architecture.md` | `default`, `fast`, `reasoning`, `code` |
| `k8s/system-a/litellm.yaml` model_list | `system-b-vllm-qwen3-4b-fast`, `system-b-vllm-qwen3-4b-default`, `aws-bedrock-claude-sonnet`, `sambanova-deepseek-v3-1` |
| `config/operator-chat-config.template.json` | `litellm/default`, `litellm/fast`, `litellm/sambanova` |

An agent configured with `litellm/default` will not resolve against the LiteLLM model_list as shipped. Pick one canonical set of aliases (`default`, `fast`, `reasoning`) and make LiteLLM expose them — keep the verbose names as `model_alias` targets, not as `model_name`.

### 2.6 Stale ollama references after the vLLM pivot
`docs/reusable-components.md`, `docs/port-map.md`, `docs/repo-layout.md`, `docs/architecture.md`, `docs/implementation-guide.md`, `docs/mvp-plan.md` still describe ollama as the live path. The README already calls vLLM canonical; these docs should be mechanically updated or explicitly marked historical (the `docs/archive/` pattern is already in place, use it).

### 2.7 `docs/mvp-plan.md` directly contradicts the operator-first decision
Phases 3–4 originally walked the reader through building a raw control plane and a bespoke session-pod image. The `legacy/` tree they pointed at has been removed; those phases now carry an explicit banner marking them historical and pointing at `docs/operator-install.md` / `docs/operator-runbook.md` as the canonical path. A full rewrite of mvp-plan.md around `openclaw-operator` install + `OpenClawInstance` apply + verify is still pending.

### 2.8 Manifests reference namespaces they don't create (fixed in this change)
Found by actually running `kubectl apply -f k8s/system-a/rbac.yaml` on an empty k3s cluster:

- `k8s/system-a/rbac.yaml` creates `Role` and `RoleBinding` in namespace `agents` but does not create the `agents` namespace. Fresh-cluster apply fails with `namespaces "agents" not found`.
- `k8s/system-b/offload-worker.yaml` puts its `Deployment` and `Services` in namespace `system-b` but depends on `minio.yaml` or `ollama.yaml` being applied first to create that namespace. Apply order is undocumented; running just `kubectl apply -f k8s/system-b/offload-worker.yaml` on a fresh cluster fails.

Both fixed here by adding explicit `kind: Namespace` at the top of each file. Going forward, every manifest that owns resources in a namespace should also own its own namespace declaration; kustomize overlays or a top-level `k8s/namespaces.yaml` are the two common patterns.

### 2.9 `offload-worker.yaml` hardcodes `imagePullPolicy: Never` with an undocumented image tag
`image: docker.io/library/demo-offload-worker:latest` with `imagePullPolicy: Never` means the image must already be loaded into every node's container runtime before apply. No doc or script builds/loads this image. The historical build/load path lived under `scripts/legacy/` and has been removed without a replacement, so this manifest currently has no documented way to obtain its image. Either:

1. Ship the Dockerfile and publish the image to `ghcr.io/<org>/offload-worker:<tag>` with a non-`Never` pull policy, document the publish step; or
2. Replace the Deployment with the ConfigMap-mounted `app.py` pattern (base `python:3.12-slim`, inline `pip install`, mount `runtimes/offload-worker/app.py` via ConfigMap) so it runs on any cluster without image distribution.

### 2.10 k3s smoke-test outcome
What landed successfully on a fresh k3s cluster (API server only — pod sandboxes blocked by the outer sandbox's runtime):

| Manifest | Apply result |
|----------|-------------|
| `k8s/system-a/rbac.yaml` | ✅ after 2.8 fix |
| `k8s/system-a/litellm.yaml` | ✅ |
| `k8s/system-a/control-plane.yaml` | ✅ |
| `k8s/system-a/session-pod-template.yaml` | ✅ |
| `k8s/system-b/minio.yaml` | ✅ |
| `k8s/system-b/offload-worker.yaml` | ✅ after 2.8 fix |
| `k8s/system-b/ollama.yaml` | ✅ |
| `k8s/shared/intel-demo-operator-secrets.yaml.template` | ✅ |
| `examples/openclawinstance-intel-demo.yaml` | ❌ `no matches for kind "OpenClawInstance"` — expected (CRD not installed, operator-gap #1–#2) |

---

## 3. Missing engineering hygiene (partly addressed in this change)

Added in this PR:

- **`.github/workflows/lint.yml`** — five jobs:
  1. `bash -n` on every `scripts/**/*.sh`
  2. `yaml.safe_load_all` on every `*.yaml`/`*.yml`
  3. `node --check` on every `web-demo/*.js` (the exact check that would have caught the round-1 JS bug)
  4. `python -m py_compile` on every `*.py`
  5. `kubeconform -strict -ignore-missing-schemas -skip CustomResourceDefinition` on `k8s/` and `examples/`
- **`.github/workflows/test.yml`** — runs `pytest` for `runtimes/offload-worker`.
- **`runtimes/offload-worker/tests/test_app.py`** — 7 tests using FastAPI's `TestClient`; no network, no MinIO required.

All five lint jobs and pytest pass locally before push.

Still missing, for a follow-up:

1. **`ruff check`** on `runtimes/` and `scripts/`. The py_compile gate catches syntax only; ruff catches unused imports, undefined names, etc.
2. **`Makefile` (or `justfile`)** with the canonical verbs: `make web-demo`, `make offload-worker`, `make lint`, `make test`. The repo currently requires a reader to discover invocation from individual shell scripts.
3. **`shellcheck`** on `scripts/**/*.sh` — catches quoting bugs that `bash -n` misses.
4. **`markdownlint-cli2`** on `docs/**` — consistent table formatting, link-check.
5. **k3s smoke job in CI** using `--disable traefik --disable metrics-server` to run `envsubst` + `kubectl apply` and diff status, so fresh-cluster regressions like 2.8 get caught in PR.

---

## 4. Operator-first gaps still open

These are already called out in `docs/operator-gap-analysis.md`; grouping them here so the plan is self-contained:

1. **Pin the operator source**. Current install script only prints suggested commands; add a `OPENCLAW_OPERATOR_REF=<git-sha|tag>` variable and actually `git clone --depth 1` or `kubectl apply -f <release-url>`.
2. **CRD-safe install in one command**. Wrap the two-step `kubectl apply --server-side -f <crd>` then `kubectl apply -k <manifests>` in `scripts/install-openclaw-operator.sh` — today the script only echoes commands.
3. **Secret manifest**. `k8s/shared/intel-demo-operator-secrets.yaml.template` needs the full expected key list and a `scripts/create-operator-secrets.sh` that reads from env and does `kubectl create secret generic --dry-run=client -o yaml | kubectl apply -f -`. No more ad-hoc `envsubst`.
4. **Ready criteria**. Document the exact `kubectl get openclawinstance intel-demo-operator -o jsonpath={.status...}` output that means "green". Today `smoke-test-operator-instance.sh` is a checklist, not an assertion.
5. **Image ref**. State one ref in one place; today neither `examples/openclawinstance-intel-demo.yaml` nor the runbook names it.

---

## 5. Web demo specifically

The web demo is 100% static narrative — useful as a storyboard, misleading as "a demo of the stack." Improvements, in order of cost:

- [low cost] Fix JS syntax (done here) and add `node --check` to CI so it does not regress.
- [low] Strip the hardcoded "SambaNova active", "tokens today: 24.8k" strings or drive them from a single `demoState` object at the top of `app.js` so they are obviously mock.
- [low] `currentScenario` is set but `runDemoBtn` always renders the terminal-agent steps regardless — either branch the `steps` array on `currentScenario` or remove the ambiguity.
- [medium] Optional `DEMO_LIVE=1` mode that `fetch`es a real `/health` on the offload-worker and lights the System B dot green when it answers. This is the smallest thing that turns the demo from slideware into a probe.
- ✅ Honest probes for the "Platform health" rail. `runtimes/control-plane/app.py` now exposes `GET /probe/{openclaw,litellm,sambanova}` driven by env (`OPENCLAW_GATEWAY_URL`, `LITELLM_BASE_URL`, `SAMBANOVA_PROBE_URL`); `web-demo/app.js` consumes them and renders an `idle` (neutral) dot when a target isn't configured instead of falsely reporting OK.

---

## 6. Repo layout nits

- ~~`legacy/`, `scripts/legacy/`, `docs/archive/` all exist with slightly different "this is historical" conventions.~~ — resolved: `legacy/` and `scripts/legacy/` have been removed. Historical material now lives only under `docs/archive/` and `archive/`.
- `demo-workspace/` contains operator "soul/identity/memory" files with no explanation of who reads them. One sentence in `demo-workspace/README.md` stating "these are shipped into the OpenClawInstance workspace volume, consumed at session boot by the orchestrator" would save readers ten minutes.
- `catalog/scenarios.yaml` and `catalog/tasks.yaml` both exist; `agents/orchestrator.md` references both. Worth a one-line note in `agents/README.md` describing the split.

---

## 7. Recommended execution order

If we had one engineer-day (done-in-this-PR marked ✅):

1. ✅ Add `.github/workflows/lint.yml` with the five cheap checks.
2. ✅ Add `pytest` for `offload-worker` (7 tests, no MinIO needed). Traceback leak (2.2) still open — surface in a follow-up.
3. ✅ Fix `rbac.yaml` and `offload-worker.yaml` missing-namespace bugs (2.8).
4. Reconcile the model aliases across LiteLLM config, operator chat config, and docs. Pick one set. (1 hr.)
5. Bump `config/versions.yaml` to match the vLLM path, or delete it. (15 min.)
6. Sweep stale ollama references; either delete or banner them. (1 hr.)
7. Move `docs/mvp-plan.md` into `docs/archive/` and replace it with an operator-first minimum path (install operator → apply secret → apply `OpenClawInstance` → verify). (2 hr.)
8. Move k8s secrets to `secretKeyRef` + `scripts/create-operator-secrets.sh`. (1 hr.)
9. Replace `image: docker.io/library/demo-offload-worker:latest` + `imagePullPolicy: Never` with either a published GHCR image or a ConfigMap-mounted `app.py` deploy (2.9). (1–2 hr.)

Everything beyond that is platform work that depends on actually having a cluster to talk to.

---

## 8. Appendix — exact commands I ran

```bash
# Run all commands from the repo root.

# Web demo
(cd web-demo && python3 -m http.server 8080 --bind 127.0.0.1) &
curl -sI http://127.0.0.1:8080/ | head -1      # HTTP/1.0 200 OK
node --check web-demo/app.js                    # FAILED before fix, passes after

# Offload worker
python3 -m venv /tmp/offload-venv
/tmp/offload-venv/bin/pip install fastapi==0.115.12 'uvicorn[standard]==0.34.2' \
  boto3==1.37.38 pandas==2.2.3 scikit-learn==1.6.1 numpy==2.2.5
(cd runtimes/offload-worker && \
  MINIO_ENDPOINT=http://localhost:9000 MINIO_ACCESS_KEY=dummy MINIO_SECRET_KEY=dummy \
  /tmp/offload-venv/bin/uvicorn app:app --host 127.0.0.1 --port 8081) &
curl -s http://127.0.0.1:8081/health
curl -s -X POST http://127.0.0.1:8081/run -H 'content-type: application/json' \
  -d '{"task_type":"echo","payload":{"msg":"hello"}}'
curl -s -X POST http://127.0.0.1:8081/run -H 'content-type: application/json' \
  -d '{"task_type":"pandas_describe","payload":{"data":[{"a":1,"b":2},{"a":3,"b":4},{"a":5,"b":6}]}}'
curl -s -X POST http://127.0.0.1:8081/run -H 'content-type: application/json' \
  -d '{"task_type":"sklearn_train","payload":{"X":[[0,0],[1,1],[0,1],[1,0],[2,2],[2,0]],"y":[0,1,0,1,1,1]}}'

# Offload worker tests
(cd runtimes/offload-worker && \
  MINIO_ENDPOINT=http://localhost:9000 MINIO_ACCESS_KEY=dummy MINIO_SECRET_KEY=dummy \
  pytest -v)    # 7 passed

# k3s cluster smoke
curl -sL -o /opt/kube/k3s \
  "https://github.com/k3s-io/k3s/releases/download/v1.31.4%2Bk3s1/k3s"
curl -sL -o /opt/kube/kubectl \
  "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x /opt/kube/{k3s,kubectl}
/opt/kube/k3s server --disable traefik --disable metrics-server \
  --write-kubeconfig /etc/rancher/k3s/k3s.yaml --write-kubeconfig-mode 644 &
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
/opt/kube/kubectl get nodes   # vm Ready

# Dry-run every manifest (after envsubst with dummy creds)
export TELEGRAM_BOT_TOKEN=dummy SAMBANOVA_API_KEY=dummy AWS_BEARER_TOKEN_BEDROCK=dummy \
  AWS_REGION=us-east-1 SYSTEM_B_VLLM_ENDPOINT=http://system-b:31000/v1 \
  SYSTEM_B_MINIO_ENDPOINT=http://system-b:30900 \
  MINIO_ACCESS_KEY=minio-dummy MINIO_SECRET_KEY=minio-dummy-secret-1234 \
  CONTROL_PLANE_TOKEN=dummy SESSION_IMAGE=ghcr.io/ex/session:x \
  CONTROL_IMAGE=ghcr.io/ex/control:x BEDROCK_MODEL_ID=x \
  ANTHROPIC_DEFAULT_SONNET_MODEL=x TELEGRAM_ALLOWED_FROM=0
for f in k8s/system-a/*.yaml k8s/system-b/*.yaml k8s/shared/*.template examples/*.yaml; do
  envsubst < "$f" | /opt/kube/kubectl apply --server-side --dry-run=server -f -
done

# kubeconform schema check
/tmp/kubeconform -strict -ignore-missing-schemas -skip CustomResourceDefinition \
  k8s/ examples/   # 35 valid, 1 skipped (OpenClawInstance)
```
