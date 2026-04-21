# Improvement Plan

Written after a local analysis and trial run of the repo on 2026-04-21. This document lists concrete, actionable improvements grouped by severity, and records what was actually executed locally vs. what only describes a remote cluster.

The repo's operator-first direction (see `docs/operator-gap-analysis.md`) is accepted as the target. This plan is about closing the gap between that stated direction and what the repo currently contains.

---

## 1. What I ran locally

Local environment: Linux sandbox, Python 3.12 venv, Node 22, no Kubernetes, no remote SSH hosts reachable.

| Component | Command | Result |
|-----------|---------|--------|
| `web-demo` | `python3 -m http.server 8080` (inside `web-demo/`) | Serves 200 for `/`, `/app.js`, `/styles.css`. |
| `web-demo/app.js` | `node --check web-demo/app.js` | **Fails before fix** — syntax error on line 281 caused by a shell-style `'\''` quote escape inside a single-quoted JS string literal. **Fixed in this change** by switching that log string to double quotes. After fix: `node --check` passes. |
| `runtimes/offload-worker` | `uvicorn app:app` in a venv with pinned deps from the Dockerfile, dummy `MINIO_*` env | `/health` returns `{"status":"ok"}`. `echo`, `pandas_describe`, `sklearn_train` tasks all return valid results with small payloads (no S3 path taken). |
| All `*.sh` in `scripts/` | `bash -n` | All pass. |
| All `*.yaml`/`*.yml` in repo | `yaml.safe_load_all` | All parse. |
| Python modules | `python3 -m py_compile` on `runtimes/offload-worker/app.py`, `scripts/telegram-send-menu.py` | Both compile. |

What I could **not** run locally:
- the `openclaw-operator` install (no cluster)
- LiteLLM / vLLM / MinIO / Telegram — all require real credentials and remote hosts
- `scripts/apply-operator-chat-config.sh` / `scripts/setup-system-b-vllm.sh` (they `ssh` into a fixed host)

---

## 2. Real bugs found

### 2.1 `web-demo/app.js` was not valid JavaScript (fixed in this change)
Line 281 used shell-style `'\''` quote escaping inside a JS string literal. The file would throw a `SyntaxError` on load in any browser, which silently breaks the "Run demo" button and every scenario renderer (`renderScenario` is never reached because the file doesn't parse). This is the most visible user-facing bug in the repo. Fixed by switching that one string to double quotes so the embedded `'1,8p'` is literal.

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
Phases 3–4 walk the reader through building a raw control plane in `legacy/services/control-plane/` and a bespoke session-pod image. Per `docs/operator-gap-analysis.md` this path is deprecated. Either (a) rewrite the plan around `openclaw-operator` install + `OpenClawInstance` apply + verify, or (b) move it under `docs/archive/` with a legacy banner.

---

## 3. Missing engineering hygiene

No CI, no tests, no linter, no formatter, no Makefile. For a repo whose stated top goal is reproducibility, the absence is loud.

Concrete, cheap wins:
1. **`.github/workflows/lint.yml`** running four checks that would have caught real bugs today:
   - `bash -n scripts/**/*.sh`
   - `python -c "import yaml; ..."` across all YAML
   - `node --check web-demo/*.js`
   - `python -m py_compile` + `ruff check` on `runtimes/` and `scripts/`
2. **Minimal `pytest` for the offload-worker** covering the three task types and unknown-task error path using FastAPI's `TestClient`. No MinIO needed if payloads stay under the 4096-byte inline threshold (which is the path we already tested).
3. **`Makefile` (or `justfile`) with the canonical verbs**: `make web-demo`, `make offload-worker`, `make lint`, `make test`. The repo currently requires a reader to discover invocation from individual shell scripts.
4. **`web-demo/package.json`** with a trivial `"check": "node --check app.js"`. This is the fastest way to keep app.js honest.

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

---

## 6. Repo layout nits

- `legacy/`, `scripts/legacy/`, `docs/archive/` all exist with slightly different "this is historical" conventions. Standardize on one (prefer `docs/archive/` + `legacy/`), add a one-line `LEGACY` banner at the top of each folder README.
- `demo-workspace/` contains operator "soul/identity/memory" files with no explanation of who reads them. One sentence in `demo-workspace/README.md` stating "these are shipped into the OpenClawInstance workspace volume, consumed at session boot by the orchestrator" would save readers ten minutes.
- `catalog/scenarios.yaml` and `catalog/tasks.yaml` both exist; `agents/orchestrator.md` references both. Worth a one-line note in `agents/README.md` describing the split.

---

## 7. Recommended execution order

If we had one engineer-day:

1. Add `.github/workflows/lint.yml` with the four cheap checks. (15 min, catches 2.1 class of bugs forever.)
2. Add `pytest` for `offload-worker` + fix 2.2 traceback leak. (45 min.)
3. Reconcile the model aliases across LiteLLM config, operator chat config, and docs. Pick one set. (1 hr.)
4. Bump `config/versions.yaml` to match the vLLM path, or delete it. (15 min.)
5. Sweep stale ollama references; either delete or banner them. (1 hr.)
6. Move `docs/mvp-plan.md` into `docs/archive/` and replace it with an operator-first minimum path (install operator → apply secret → apply `OpenClawInstance` → verify). (2 hr.)
7. Move k8s secrets to `secretKeyRef` + `scripts/create-operator-secrets.sh`. (1 hr.)

Everything beyond that is platform work that depends on actually having a cluster to talk to.

---

## 8. Appendix — exact commands I ran

```bash
# Web demo
cd web-demo && python3 -m http.server 8080 --bind 127.0.0.1 &
curl -sI http://127.0.0.1:8080/ | head -1      # HTTP/1.0 200 OK
node --check web-demo/app.js                     # FAILED before fix, passes after

# Offload worker
python3 -m venv /tmp/offload-venv
/tmp/offload-venv/bin/pip install fastapi==0.115.12 'uvicorn[standard]==0.34.2' \
  boto3==1.37.38 pandas==2.2.3 scikit-learn==1.6.1 numpy==2.2.5
cd runtimes/offload-worker
MINIO_ENDPOINT=http://localhost:9000 MINIO_ACCESS_KEY=dummy MINIO_SECRET_KEY=dummy \
  /tmp/offload-venv/bin/uvicorn app:app --host 127.0.0.1 --port 8081 &
curl -s http://127.0.0.1:8081/health
curl -s -X POST http://127.0.0.1:8081/run -H 'content-type: application/json' \
  -d '{"task_type":"echo","payload":{"msg":"hello"}}'
curl -s -X POST http://127.0.0.1:8081/run -H 'content-type: application/json' \
  -d '{"task_type":"pandas_describe","payload":{"data":[{"a":1,"b":2},{"a":3,"b":4},{"a":5,"b":6}]}}'
curl -s -X POST http://127.0.0.1:8081/run -H 'content-type: application/json' \
  -d '{"task_type":"sklearn_train","payload":{"X":[[0,0],[1,1],[0,1],[1,0],[2,2],[2,0]],"y":[0,1,0,1,1,1]}}'
```
