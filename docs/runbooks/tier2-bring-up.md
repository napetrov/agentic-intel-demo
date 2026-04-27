# Tier 2 Bring-up — Canonical Runbook

This is the single canonical "from empty cluster to demo task" path.
Every other Tier 2 doc in the repo is a deeper reference for one of the
steps below; if anything contradicts this file, treat this file as the
source of truth and fix the other.

The demo path is **operator-first**. Tier 1 (`docker compose up` /
`scripts/dev-up.sh`) is local dev/smoke only — useful to exercise the
offload relay and the web UI without a cluster, but it does not run
OpenClaw, LiteLLM, vLLM, or Telegram. Anything an audience sees as "the
demo" should run through the operator on Tier 2.

---

## 0. Preflight (run on the deploy workstation)

```bash
# Verify kubectl, contexts, API reachability, namespaces, and operator
# install state — all read-only, no Secrets read, no manifests applied.
./scripts/check-tier2-environment.sh

# Verify the upstream pins this demo depends on actually resolve from
# this workstation BEFORE applying any manifests. Catches private GHCR
# images, missing release tags, and unpinned image:latest tags.
./scripts/check-upstream-pins.sh
```

`check-tier2-environment.sh` catches the four most common bring-up
failures before they waste cluster apply attempts:
- `kubectl` not on PATH on the host that drives the deploy
- `system-a` / `system-b` contexts missing from the merged kubeconfig
- API server unreachable (VPN / firewall / wrong server URL)
- CRD / controller already half-installed and confusing later steps

`check-upstream-pins.sh` catches the most common day-zero blockers:
- the operator runtime image (`ghcr.io/openclaw-rocks/openclaw:<tag>`)
  is private — the deploy needs an `imagePullSecret` referencing GHCR
  credentials. The script reports this as `HTTP 403 DENIED`.
- the operator git tag (`OPENCLAW_OPERATOR_REF`) does not exist
  upstream — set the var to a tag that does.
- the vLLM image is `latest` (gap #7) — pin it before promoting past
  dry-run.

If you run on a single cluster, override the contexts:
```bash
SYSTEM_A_CONTEXT=mycluster SYSTEM_B_CONTEXT=mycluster \
  ./scripts/check-tier2-environment.sh
```

You should see `[ok]` for kubectl + both contexts + API reachability.
Missing namespaces are warnings (created by later steps); missing CRD
or controller is a warning unless you've already run step 4.

---

## 1. Gather inputs

The values below are not pinned in the repo and must come from your
environment. The full table is in `docs/reproducibility.md` "Values to
fill in"; the *minimum* set for a Tier 2 bring-up is:

| Variable | Required for | Where to obtain |
|----------|-------------|-----------------|
| `OPENCLAW_OPERATOR_REF` | step 4 (operator install) | `https://github.com/openclaw-rocks/openclaw-operator` releases — pin a tag/SHA. The repo defaults to `v0.30.0` as a candidate (see "Pin status" below). |
| `TELEGRAM_BOT_TOKEN` | step 2 (System A secrets) | BotFather → `/newbot` |
| `TELEGRAM_ALLOWED_FROM` | step 4 instance manifest | `@userinfobot` returns your numeric id |
| `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `ANTHROPIC_DEFAULT_SONNET_MODEL` | step 2 secrets, step 3 LiteLLM, step 4 instance | AWS Bedrock console → enabled inference profile |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | steps 2, 3, MinIO bucket | choose any (these create the MinIO root user) |
| `SYSTEM_B_IP` | step 3 (LiteLLM → vLLM) | `kubectl --context system-b get nodes -o wide` → INTERNAL-IP |
| `SAMBANOVA_API_KEY` | optional | SambaNova Cloud → API keys. Leave empty if you don't use SambaNova; the `sambanova` LiteLLM alias will surface as `unconfigured`. |
| `GH_TOKEN` | optional | A GitHub PAT (classic or fine-grained) that agents inside the OpenClaw session pod use **internally** for `git clone/push`, `gh pr create`, issue triage, and private GHCR pulls. Never exposed on the gateway API. See "GitHub token (`GH_TOKEN`) wiring" below. |

### GitHub token (`GH_TOKEN`) wiring

`GH_TOKEN` is consumed entirely inside the OpenClaw instance. It is never
returned by the gateway, never rendered into `openclaw.json`, and never
required for the demo to boot. Wire it when the scenarios you run touch
GitHub from tool calls — for example, an agent that pushes a branch and
opens a PR, or a workflow that pulls a private GHCR image.

How the value flows:

1. You export `GH_TOKEN` and re-run `scripts/create-operator-secrets.sh`
   (System A scope). The script writes the token into two Secrets, both
   via `kubectl create secret --dry-run=client -o yaml | kubectl apply -f -`
   so plaintext never lands on disk:
   - `intel-demo-operator-secrets` (namespace `default`) — picked up by
     the operator gateway via `envFromSecrets` in
     `examples/openclawinstance-intel-demo.yaml`.
   - `github-token` (namespace `agents`) — picked up by the session pod
     via `secretKeyRef` in `k8s/system-a/session-pod-template.yaml`.
     The mirror is necessary because `secretKeyRef` cannot cross
     namespaces.
2. Inside the session pod, the value is exposed under **both**
   `GH_TOKEN` and `GITHUB_TOKEN` (same value), so tools that look for
   either name find it. Both env vars are marked `optional: true` on the
   `secretKeyRef`, so omitting the Secret does not block pod startup —
   the agent just boots without a credential and `gh auth status` fails
   loudly, which is the intended "no GitHub access wired" signal.
3. Tools running inside the agent (`git`, `gh`, the OpenClaw exec
   plugin, container pulls invoked by scenarios) read the env var
   directly. Nothing is added to `openclaw.json`; the gateway has no
   GitHub-related endpoint and never returns the token.

To rotate or remove the token:

```bash
# rotate
APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
  TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... \
  SAMBANOVA_API_KEY="${SAMBANOVA_API_KEY:-}" \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  GH_TOKEN=ghp_NEW... \
  ./scripts/create-operator-secrets.sh
kubectl --context system-a delete pods -n agents -l role=session-pod

# remove (drop GitHub access entirely)
kubectl --context system-a delete secret github-token -n agents
# also re-run create-operator-secrets.sh WITHOUT GH_TOKEN exported so
# the operator-namespace Secret stops carrying the key:
APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
  TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... \
  SAMBANOVA_API_KEY="${SAMBANOVA_API_KEY:-}" \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh
```

To verify presence without ever reading the value:

```bash
SCOPE=system-a ./scripts/verify-operator-secrets.sh
# A wired stand prints: [ok] ns/agents secret/github-token has all required keys: GH_TOKEN
# An unwired stand prints: [warn] secret/github-token in ns/agents not present — agents will run without GitHub credentials.
# Set REQUIRE_GH_TOKEN=1 (or export GH_TOKEN before running the verify script) to upgrade the [warn] to a [FAIL].
```

### Sensitive-data handling

Throughout this runbook:
- never paste secret material into committed YAML or chat. The values
  flow through env vars + `kubectl create secret --dry-run=client -o
  yaml | kubectl apply -f -`, so plaintext never lands on disk.
- never run `kubectl get secret <name> -o yaml` (or `-o json`) — that
  prints base64-encoded values and they will end up in shell history,
  CI logs, and screenshots. Use `scripts/verify-operator-secrets.sh`
  to confirm presence + key set without ever reading values.
- `examples/openclawinstance-intel-demo.yaml` does not embed secret
  values — `${TELEGRAM_BOT_TOKEN}` is expanded by the OpenClaw runtime
  at session-pod boot from `intel-demo-operator-secrets`, not by
  `envsubst` at apply time.

---

## 2. System B — model backend + storage

```bash
APPLY=1 SCOPE=system-b KUBECTL="kubectl --context system-b" \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh

# vLLM. Two paths — pick one:
#   (a) helm chart from your fork (canonical):
APPLY=1 \
  CHART_REPO=https://github.com/<your-org>/Enterprise-Inference.git \
  CHART_REF=<tag|sha> \
  KUBECTL="kubectl --context system-b" \
  ./scripts/setup-system-b-vllm-local.sh
#   (b) static manifest (no helm). The shipped image tag is `latest`
#       which is NOT validated for CPU. Pin the image first; see
#       comments in k8s/system-b/vllm.yaml. Tracked as gap #7. The
#       manifest intentionally requests cpu=4 and memory=24Gi, matching
#       the validated System B capacity; raising this can make redeploys
#       unschedulable on the demo node.
# kubectl --context system-b apply -f k8s/system-b/vllm.yaml

# If the stand uses nri-resource-policy-balloons, keep the reserved pool
# aligned with the validated System B shape before applying workloads:
# reservedResources.cpu=cpuset:0,1,2,3 and minCPUs=4. Older values such
# as cpuset:0,1,2,3,16,17,18,19 or minCPUs=24 can fail validation or
# starve scheduling on the demo node.

kubectl --context system-b apply -f k8s/system-b/minio.yaml
MINIO_ROOT_USER="$MINIO_ACCESS_KEY" MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
  ./scripts/create-minio-bucket.sh
# agent_invoke is handled by this persistent gateway service. It is not a
# per-request Job; offload-worker forwards to agent-stub:8080.
kubectl --context system-b apply -f k8s/system-b/agent-stub.yaml
kubectl --context system-b apply -f k8s/system-b/offload-worker.yaml
```

Verify (read-only):
```bash
SYSTEM_B_IP=$(kubectl --context system-b get nodes \
  -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
curl -fsS "http://${SYSTEM_B_IP}:30434/v1/models" | head -20
SCOPE=system-b ./scripts/verify-operator-secrets.sh
```

`/v1/models` should list the vLLM-served model id (default
`Qwen/Qwen3-4B-Instruct-2507`).

---

## 3. System A — secrets + LiteLLM

```bash
APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
  TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... \
  SAMBANOVA_API_KEY="${SAMBANOVA_API_KEY:-}" \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  GH_TOKEN="${GH_TOKEN:-}" \
  ./scripts/create-operator-secrets.sh
# `GH_TOKEN` is optional. When set, the script also creates the
# `github-token` Secret in namespace `agents` so the session pod
# exposes it as GH_TOKEN/GITHUB_TOKEN to internal tools (git, gh,
# private GHCR pulls). Leave it unset to skip — the demo runs fine
# without GitHub credentials. See "GitHub token (`GH_TOKEN`) wiring"
# above for the full flow.

SYSTEM_B_VLLM_ENDPOINT="http://${SYSTEM_B_IP}:30434/v1" \
  AWS_REGION=us-east-2 \
  envsubst < k8s/system-a/litellm.yaml \
  | kubectl --context system-a apply -f -
```

> **SambaNova is optional.** Leave `SAMBANOVA_API_KEY` empty (or unset)
> if you don't use SambaNova; LiteLLM will accept the empty key in
> `litellm-secrets`, the `sambanova` alias will simply 401 on use, and
> nothing else breaks. To validate end-to-end when you DO use it,
> `scripts/test-sambanova-direct.sh` hits SambaNova directly and
> `scripts/test-litellm-sambanova.sh` hits the LiteLLM alias once
> System A is up.

Verify:
```bash
SCOPE=system-a ./scripts/verify-operator-secrets.sh

# Confirm LiteLLM answers all four aliases that the demo expects (skip
# any alias you don't have credentials for):
kubectl --context system-a -n inference port-forward svc/litellm 4000:4000 &
PF_PID=$!
LITELLM_BASE_URL=http://127.0.0.1:4000 LITELLM_MODEL=fast      ./scripts/test-litellm-sambanova.sh
LITELLM_BASE_URL=http://127.0.0.1:4000 LITELLM_MODEL=default   ./scripts/test-litellm-sambanova.sh
LITELLM_BASE_URL=http://127.0.0.1:4000 LITELLM_MODEL=reasoning ./scripts/test-litellm-sambanova.sh
LITELLM_BASE_URL=http://127.0.0.1:4000 LITELLM_MODEL=sambanova ./scripts/test-litellm-sambanova.sh   # optional
kill "$PF_PID"
```

---

## 4. System A — operator + OpenClawInstance

```bash
./scripts/check-operator-prereqs.sh

APPLY=1 OPENCLAW_OPERATOR_REF=v0.30.0 \
  KUBECTL="kubectl --context system-a" \
  ./scripts/install-openclaw-operator.sh
# (set OPENCLAW_OPERATOR_REF_VERIFIED=1 once you've validated v0.30.0
#  end-to-end on your stand — silences the "candidate ref" notice.)

# examples/openclawinstance-intel-demo.yaml ships a concrete spec
# (Bedrock ARN, AWS region, Telegram allow-id, model list). The only
# ${VAR} token in the file is ${TELEGRAM_BOT_TOKEN} inside the embedded
# openclaw.json — that's expanded at session-pod runtime by the operator
# from intel-demo-operator-secrets, not by envsubst at apply time. Edit
# the YAML in place if you need different region / Bedrock ARN /
# allow-from values.
kubectl --context system-a apply -f examples/openclawinstance-intel-demo.yaml

APPLY=1 KUBECTL="kubectl --context system-a" \
  ./scripts/smoke-test-operator-instance.sh
```

The smoke test waits for `.status.phase=Running` (canonical for
`v0.30.0`), then probes the gateway service for `/healthz`. On failure
it dumps the OpenClawInstance description, controller logs, and instance
pods.

### Pin status

| Pin | File | Verified? | What "verified" means |
|-----|------|-----------|----------------------|
| `OPENCLAW_OPERATOR_REF=v0.30.0` | `scripts/install-openclaw-operator.sh`, `config/versions.yaml` | **Candidate (not verified end-to-end on this demo's stand).** | After running step 4 against your cluster, set `OPENCLAW_OPERATOR_REF_VERIFIED=1` in the deploy env to silence the candidate-ref notice. Re-validate before bumping the default. |
| `OpenClawInstance.spec.image.tag=v0.30.0` | `examples/openclawinstance-intel-demo.yaml` | **Candidate.** | Confirm `ghcr.io/openclaw-rocks/openclaw:v0.30.0` resolves and the controller drives the instance to `.status.phase=Running`. |
| `READY_JSONPATH={.status.phase}` accepting `Running` | `scripts/smoke-test-operator-instance.sh`, `config/versions.yaml` | **Candidate.** | Confirmed only on the operator ref above; bumping the ref may shift the canonical Ready value. |
| vLLM helm chart `CHART_REPO`/`CHART_REF` | `scripts/setup-system-b-vllm-local.sh` | **Not pinned.** | Bring your own fork URL + tag, or use the static `k8s/system-b/vllm.yaml` (image tag is `latest` — pin it before promoting). Gap #7. |
| `k8s/system-b/vllm.yaml` image | `k8s/system-b/vllm.yaml` | **Not pinned (`latest`).** | No public CPU-tuned vLLM image we can validate against. Pin to a known-good tag once you have one. |

---

## 5. Telegram + demo task verification

```bash
# 5a. Register the slash-command menu and validate bot wiring before
#     touching the cluster. check-telegram-routing.sh confirms the
#     token works (getMe), the demo menu is registered (getMyCommands),
#     and that the long-poll queue is in a sane state.
TELEGRAM_BOT_TOKEN=... ./scripts/telegram-send-menu.py
TELEGRAM_BOT_TOKEN=... ./scripts/check-telegram-routing.sh

# 5b. End-to-end "the demo can actually run a task" check. Both smokes
#     read SYSTEM_A_KUBECTL (not the generic KUBECTL the older scripts
#     use) so one process invocation can drive system-a + system-b
#     cleanly.
APPLY=1 SYSTEM_A_KUBECTL="kubectl --context system-a" \
  ./scripts/smoke-test-demo-task.sh

# 5c. (optional) System A → System B → MinIO offload roundtrip:
APPLY=1 SYSTEM_A_KUBECTL="kubectl --context system-a" \
  ./scripts/smoke-test-offload-k8s.sh
```

`smoke-test-demo-task.sh` covers the six things
`smoke-test-operator-instance.sh` intentionally doesn't:
1. instance phase is `Running`
2. gateway `/healthz` is 200 over a port-forward
3. LiteLLM `POST /v1/chat/completions` returns a non-empty completion
   for `LITELLM_ALIAS` (default `fast`; switch to `reasoning` to
   exercise Bedrock, `sambanova` to exercise SambaNova)
4. Telegram channel is enabled with non-empty `allowFrom` in the
   rendered `openclaw.json` — proves the operator-managed config got
   to the runtime, without ever reading `TELEGRAM_BOT_TOKEN`
5. `tools.exec.security=full, ask=off` is present in that same
   rendered config — proves shell tools won't be silently blocked
6. Session pod env-var **names** include the required set
   (default `AWS_BEARER_TOKEN_BEDROCK`, `TELEGRAM_BOT_TOKEN`) — proves
   secrets reached the live pod, without ever reading their values

Then DM the bot:
- `/demo` should render the scenario menu
- pick `Terminal Agent` and confirm it produces a tool-call trace
- pick `Market Research` and confirm the offload roundtrip lands a
  `result_ref` (visible in the offload-worker logs).

After at least one tool-running scenario, audit that tools actually
ran end-to-end:

```bash
# Greps the session pod logs for canonical tool-call signatures
# (tool.invoke, tools.exec, tool_call, exec_result, ...). Read-only.
SINCE=10m SYSTEM_A_KUBECTL="kubectl --context system-a" \
  ./scripts/check-openclaw-tools.sh
```

The "old generic onboarding flow" failure mode (DM sent to a generic
agent rather than the demo router) is caught by step 4 of
`smoke-test-demo-task.sh` and by inspecting `check-tier2-logs.sh
session` while you DM the bot.

---

## 6. Live logs checklist

```bash
# everything (System A + System B), 100 most recent lines per component:
./scripts/check-tier2-logs.sh

# zoom in on one component:
./scripts/check-tier2-logs.sh operator   # controller — reconcile loops
./scripts/check-tier2-logs.sh session    # OpenClaw session pod — Telegram updates, tool calls
./scripts/check-tier2-logs.sh gateway    # gateway service — /healthz + auth
./scripts/check-tier2-logs.sh litellm    # LiteLLM proxy — chat completion routing
./scripts/check-tier2-logs.sh vllm       # vLLM — model loading, token throughput
./scripts/check-tier2-logs.sh offload    # offload-worker — task execution + MinIO put
./scripts/check-tier2-logs.sh minio      # MinIO — bucket access
```

Each block prints the full `kubectl logs ...` invocation it ran, so you
can copy-paste the working command into your shell to follow logs live
(`kubectl logs ... -f`).

Healthy signals to expect:
- `operator`: "reconcile loop ... successful", no Error events.
- `session`: `telegram update_id=... user_id=...` per DM, then tool
  invocation traces and a Bedrock/LiteLLM call line.
- `gateway`: `GET /healthz 200` per readiness tick.
- `litellm`: `POST /v1/chat/completions 200` for the alias the demo used.
- `vllm`: `GET /v1/models 200`; per-request generation lines.
- `offload`: `POST /run 200`, MinIO `put_object` lines, `result_ref`
  returned.
- `minio`: bucket access lines for `demo-artifacts`, no 4xx.

---

## 7. Recovery quick-reference

The canonical "smallest fix per symptom" table is in `docs/demo-setup.md`
"Recovery playbook (Tier 2)". The most common operator-managed cases:

```bash
# OpenClawInstance stuck in Provisioning — almost always a missing key
SCOPE=system-a ./scripts/verify-operator-secrets.sh
# (re-run create-operator-secrets.sh with the missing values, then:)
APPLY=1 KUBECTL="kubectl --context system-a" \
  ./scripts/teardown-openclaw-instance.sh
kubectl --context system-a apply -f examples/openclawinstance-intel-demo.yaml

# Telegram bot not replying — token rotated or allow-id mismatch
./scripts/check-tier2-logs.sh session    # look for "Unauthorized" or no update_id
# rotate token via BotFather, then:
APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
  TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... SAMBANOVA_API_KEY=... \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  ./scripts/create-operator-secrets.sh
kubectl --context system-a delete pods -n agents -l role=session-pod
```

For full component recovery (delete+reapply secrets, wipe artifact
bucket, restart control-plane), see `docs/reproducibility.md`
"Recovery / reset".

---

## 8. Tear down

```bash
APPLY=1 KUBECTL="kubectl --context system-a" \
  ./scripts/teardown-openclaw-instance.sh
APPLY=1 KUBECTL="kubectl --context system-a" \
  ./scripts/cleanup-system-a.sh   # drop System A demo resources
# System B: kubectl --context system-b delete -f k8s/system-b/
```

---

## Where to look next

- Pin status / known-unknowns: `docs/internal/operator-gap-analysis.md`,
  `docs/demo-setup.md` "Known unknowns".
- Full reference for environment values: `docs/reproducibility.md`.
- Operator-specific troubleshooting (CRD annotation size, install
  modes): `docs/operator-runbook.md`.
- Authoring a new demo scenario: `docs/scenario-spec.md`,
  `templates/scenarios/`.
