# Demo Setup — Tiered Bring-up

This repo supports three distinct bring-up tiers. **Tier 2 is the
shipped demo path** — operator-first, two-system k8s with Telegram and
real model serving. Tier 0 and Tier 1 are *local dev/smoke* only: they
exercise narrative (Tier 0) or the offload relay (Tier 1) without
running OpenClaw, LiteLLM, vLLM, or Telegram. If you are reproducing
the demo for an audience, jump straight to Tier 2 — start with the
canonical runbook in `docs/runbooks/tier2-bring-up.md`.

All tiers share the same logical architecture (System A orchestrates,
System B executes offload). What differs is how much of that architecture
is real vs. simulated.

## Tier summary

| Tier | Purpose | What runs | Needs | Verifies |
|------|---------|-----------|-------|----------|
| 0 — Web simulation | dev/smoke (narrative only) | static HTML/CSS/JS in `web-demo/` | any machine with Python or Docker | scenario flow, UX, narrative |
| 1 — Local services | dev/smoke (offload relay only) | `control-plane` + `offload-worker` + MinIO | Docker on one machine | full scenario slice: `POST /offload` → `/run` → MinIO artifact |
| 2 — Two-system k8s + operator | **shipped demo path** | full stack: `openclaw-operator`, LiteLLM, vLLM, MinIO, offload-worker, control-plane | two Intel CPU machines with k3s, Telegram bot | the full demo as shipped |

## Tier 0 — Web simulation

> **Tier 0 is dev/smoke only**, not the demo path. Use it to walk through
> the scenario narrative without compute. For the shipped demo path see
> `docs/runbooks/tier2-bring-up.md`.

**Goal:** show the demo narrative and scenario flow without any real compute
or Kubernetes.

**Runs:** `web-demo/` only. Entirely static; simulates scenario progress
client-side.

```bash
# from repo root
python3 -m http.server 8080 --directory web-demo
# open http://localhost:8080
```

Docker alternative:
```bash
docker build -t web-demo:local ./web-demo
docker run --rm -p 8080:8080 web-demo:local
```

Verification: the `web-demo-smoke` Playwright job in `.github/workflows/test.yml`
runs on every PR and confirms that each scenario card populates a timeline
of events. Run the same smoke locally:
```bash
cd web-demo
npm install && npx playwright install --with-deps chromium
python3 -m http.server 8080 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null' EXIT
BASE_URL=http://localhost:8080 npx playwright test
```

Use Tier 0 for audiences who care about the scenario catalog and UX, not
the backend.

> **Tier 0 caveat — the "Agent command" panel.** The static page has no
> `/api/*` proxy, so the Platform health rail stays "probing" and the
> Agent command panel renders "Backend not detected". That panel needs
> Tier 1 (the `docker compose up --build` stack, or `scripts/dev-up.sh`
> when registries are blocked). Same for the "Run demo" button's live
> backend mode — Tier 0 falls back to the scripted walkthrough.

## Tier 1 — Local services

> **Tier 1 is dev/smoke only**, not the demo path. It exists to test the
> offload-relay implementation locally; an audience watching this stack
> sees the offload roundtrip but no Telegram, no OpenClaw, no LiteLLM,
> no vLLM. For the shipped demo path see
> `docs/runbooks/tier2-bring-up.md`.

**Goal:** exercise the System A → System B offload path end-to-end —
control-plane relay, offload worker, and MinIO artifact storage — on one
machine. No Telegram, no OpenClaw, no vLLM.

**Runs:**
- `runtimes/control-plane/` on localhost:8090 (FastAPI offload relay:
  `POST /offload`, `GET /offload/{job_id}`, `GET /artifacts/{ref}`)
- `runtimes/offload-worker/` on localhost:8080 (FastAPI `POST /run`)
- MinIO on localhost:9000 (S3 API) and localhost:9001 (console)

The control-plane is a thin relay: it accepts `POST /offload`, forwards
to the offload-worker synchronously, tracks the result in memory, and
returns presigned MinIO URLs for large artifacts. It does not own
Kubernetes session state — that is the operator's job in Tier 2.

### Minimum bring-up (offload-worker + MinIO)

The commands below use a user-defined Docker network so the containers
resolve each other by name. This works identically on Linux, macOS
(Docker Desktop), and Windows, and avoids the `--network host` gotcha on
Docker Desktop.

```bash
# one-time: shared network
docker network create demo-net 2>/dev/null || true

# MinIO (9000 S3 API, 9001 console published to the host)
docker run -d --name demo-minio --network demo-net \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# create the bucket (runs on the same network, talks to MinIO by name)
docker run --rm --network demo-net --entrypoint sh minio/mc -c '
  mc alias set local http://demo-minio:9000 minioadmin minioadmin &&
  mc mb --ignore-existing local/demo-artifacts'

# offload worker (publishes 8080 to the host for curl; resolves MinIO by name)
docker build -t offload-worker:local ./runtimes/offload-worker
docker run --rm --name demo-offload --network demo-net \
  -p 8080:8080 \
  -e MINIO_ENDPOINT=http://demo-minio:9000 \
  -e MINIO_ACCESS_KEY=minioadmin \
  -e MINIO_SECRET_KEY=minioadmin \
  -e MINIO_BUCKET=demo-artifacts \
  offload-worker:local
```

If you prefer host networking on Linux (simpler, but Linux-only), drop
`--network demo-net` and the `-p` flags and use
`MINIO_ENDPOINT=http://localhost:9000` with `--network host`. Do not use
`--network host` on Docker Desktop — containers there run in a VM and
`localhost` does not map to the host.

Verification of the System B worker:
```bash
curl localhost:8080/health
curl -X POST localhost:8080/run -H 'content-type: application/json' -d '{
  "task_type": "echo", "payload": {"hello": "world"}
}'
```

### Add the control-plane offload relay

```bash
docker build -t demo-control-plane:local ./runtimes/control-plane
docker run --rm --name demo-control-plane --network demo-net \
  -p 8090:8080 \
  -e OFFLOAD_WORKER_URL=http://demo-offload:8080 \
  -e MINIO_ENDPOINT=http://demo-minio:9000 \
  -e MINIO_ACCESS_KEY=minioadmin \
  -e MINIO_SECRET_KEY=minioadmin \
  -e MINIO_BUCKET=demo-artifacts \
  demo-control-plane:local
```

End-to-end slice (scenario route, not a raw worker call):
```bash
curl -X POST localhost:8090/offload -H 'content-type: application/json' -d '{
  "task_type": "echo", "payload": {"hello":"world"}, "session_id": "sess-1"
}'
# -> {"job_id":"job-...","status":"completed","session_id":"sess-1"}
curl localhost:8090/offload/job-XXXX
# -> full OffloadStatus with result / result_ref
```

This matches what CI runs in the `tier1-scenario-slice` job via
`scripts/ci-scenario-slice.py`.

Cleanup when done:
```bash
docker rm -f demo-minio demo-offload demo-control-plane 2>/dev/null || true
docker network rm demo-net 2>/dev/null || true
```

Unit tests that run without extra deps:
```bash
pip install fastapi pydantic boto3 pytest httpx
pytest runtimes/offload-worker/tests/ -q -k 'echo or health or invalid'
pytest runtimes/control-plane/tests/ -q
```

Pandas/sklearn-backed tests require the Docker image dependencies; CI runs
the full suite in the `offload-worker` and `tier1-scenario-slice` jobs.

Use Tier 1 when you need to show that the System B execution path actually
runs and returns artifacts — for example, to demo offload before committing
to two-system k8s setup.

## Tier 2 — Two-system k8s + operator

> **Tier 2 is the shipped demo path.** This section is the deep
> reference for individual steps; the canonical end-to-end runbook
> (preflight → secrets → System B → System A → operator → instance
> → Telegram → demo task → logs) is `docs/runbooks/tier2-bring-up.md`.

**Goal:** the full architecture: operator-managed OpenClaw instance on
System A, LiteLLM routing, vLLM on System B, MinIO, offload worker,
Telegram ingress.

**Runs:**
- System A: `openclaw-operator`, `OpenClawInstance`, LiteLLM, optional
  control-plane stub
- System B: vLLM, MinIO, offload worker

### Prerequisites

- Two Intel CPU hosts (System A and System B) with k3s (see
  `docs/port-map.md` for install flags).
- Non-overlapping pod/service CIDRs across the two clusters.
- Merged kubeconfig with contexts `system-a` and `system-b`.
- Telegram bot token + allowed-user id (see "Telegram bring-up" below).
- Bedrock access (region + bearer token + inference profile ARN) for
  the `reasoning` alias is **required** — the shipped
  `OpenClawInstance` defaults the agent's primary model to Bedrock
  Claude Sonnet.
- A SambaNova API key for the `sambanova` alias is **optional**: leave
  `SAMBANOVA_API_KEY` empty (or unset) and the alias surfaces as
  `unconfigured`. The demo's golden path (terminal + market research)
  doesn't require it. To validate end-to-end when you DO use it, run
  `scripts/test-sambanova-direct.sh` against `api.sambanova.ai/v1` and
  `scripts/test-litellm-sambanova.sh` against the LiteLLM alias once
  System A is up. SambaNova-specific notes live in
  `docs/sambanova-integration.md`.
- `k8s/system-a/litellm.yaml` maps `reasoning` → Bedrock Claude Sonnet
  and `sambanova` → SambaNova DeepSeek; provision each key against
  the alias it actually serves.
- A reachable upstream `openclaw-operator` ref pinned via
  `OPENCLAW_OPERATOR_REF`.
- `envsubst` (from the `gettext` package) on the deploy workstation —
  Step 3 below renders `k8s/system-a/litellm.yaml` through it before
  applying. See `docs/reproducibility.md` for the full tool list.

### Hardware and network requirements

System A sizing depends on which scenarios you actually run; System B's
vLLM pod alone reserves 16 CPU / 32Gi for the Qwen3-4B context window.

| Host | Min CPU | Min RAM | Min disk | Notes |
|------|---------|---------|----------|-------|
| System A — base bring-up | 4 cores | 8 GiB | 40 GiB | operator + LiteLLM + `small`/`medium` session profiles. Enough for `terminal_agent` and `market_research`. |
| System A — full scenario coverage | 36+ cores | 72+ GiB | 40 GiB | `large_build_test` runs on the `large` session profile (32 CPU / 64Gi from `config/pod-profiles/profiles.yaml`); System A also needs operator + LiteLLM headroom on top. Either size the host accordingly or downgrade `large_build_test` to a smaller pod profile. |
| System B | 20 cores | 40 GiB | 80 GiB | vLLM 16/32 + offload-worker 4/4 + MinIO + headroom. Drop to a smaller model / shorter `--max-model-len` in `scripts/setup-system-b-vllm-local.sh` if you need to fit on less. |

Network reachability that must be open between the two hosts (NodePorts
from `docs/port-map.md`):

| Direction | Port | Purpose |
|-----------|------|---------|
| System A → System B | TCP 30434 | LiteLLM → vLLM (`SYSTEM_B_VLLM_ENDPOINT`) |
| System A → System B | TCP 30900 | Control-plane / offload-worker → MinIO S3 API |
| System A → System B | TCP 30800 | Control-plane → offload-worker (when offload runs out-of-cluster) |
| Operator/admin → System A | TCP 6443 | `kubectl --context system-a` |
| Operator/admin → System B | TCP 6443 | `kubectl --context system-b` |
| Session pods → Telegram | TCP 443 | outbound `api.telegram.org` |
| Session pods → Bedrock | TCP 443 | outbound `bedrock-runtime.${AWS_REGION}.amazonaws.com` |
| Session pods → SambaNova | TCP 443 | outbound `api.sambanova.ai` |

Verify CIDRs don't overlap before bring-up — the easiest way is to use
the install flags from `docs/port-map.md` verbatim (System A on
`10.42.0.0/16` + `10.96.0.0/16`, System B on `10.43.0.0/16` +
`10.97.0.0/16`).

### Telegram bring-up

The `OpenClawInstance` reads `TELEGRAM_BOT_TOKEN` from
`intel-demo-operator-secrets`, and the embedded `openclaw.json`
allow-lists exactly one numeric Telegram user id via
`TELEGRAM_ALLOWED_FROM`. Both must be set before
`scripts/create-operator-secrets.sh` runs.

1. **Create the bot.** DM
   [@BotFather](https://t.me/BotFather) → `/newbot` → choose name +
   username → save the `123456:ABC-...` HTTP API token. This is
   `TELEGRAM_BOT_TOKEN`.
2. **Find your numeric user id.** DM
   [@userinfobot](https://t.me/userinfobot) → it replies with your
   `Id: 123456789`. This is `TELEGRAM_ALLOWED_FROM`. The demo only
   accepts messages from this id; everything else is dropped.
3. **(Optional) Bind a group.** Add the bot to a group, send any
   message there, then resolve the negative chat id via
   `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates` and
   put it under `channels.telegram.groups` in
   `config/operator-chat-config.template.json` before applying.
4. **Register the slash-command menu** after the operator instance is
   Ready (uses `setMyCommands` against the bot token from your shell):
   ```bash
   TELEGRAM_BOT_TOKEN=... scripts/telegram-send-menu.py
   ```
   The menu shipped is `/demo`, `/start`, `/status`, `/reset` (matches
   `customCommands` in the operator chat config).

### Bring-up order

The exact list of values you need to gather first
(`OPENCLAW_OPERATOR_REF`, `BEDROCK_MODEL_ID`, `SYSTEM_B_IP`, …)
lives in `docs/reproducibility.md` under "Values to fill in".

0. **Preflight** the workstation:
   ```bash
   ./scripts/check-tier2-environment.sh
   ```
   Verifies kubectl + `system-a`/`system-b` contexts + API
   reachability. Read-only — never reads Secrets, never applies
   manifests. Fails loudly if `kubectl` isn't on PATH or a context is
   missing, which are the two most common bring-up blockers.

1. **Environment** — k3s on both systems with the flags from
   `docs/port-map.md`. Make sure `kubectl` resolves both contexts
   (`kubectl config get-contexts | grep -E 'system-[ab]'`).

2. **System B — model backend and storage:**
   ```bash
   # vLLM bring-up via kubectl/helm against the current context
   # (replaces the SSH-into-onedal-build path).
   APPLY=1 \
     CHART_REPO=https://github.com/<your-org>/Enterprise-Inference.git \
     CHART_REF=<tag|sha> \
     KUBECTL="kubectl --context system-b" \
     ./scripts/setup-system-b-vllm-local.sh

   # Export these so they persist for the bucket-creation step below;
   # an inline `KEY=VAL ./script` only sets the variable for that one
   # process. SYSTEM_B_IP is the canonical placeholder for the System B
   # node's reachable address — see docs/reproducibility.md "Values to
   # fill in".
   export SYSTEM_B_IP=...
   export MINIO_ACCESS_KEY=...
   export MINIO_SECRET_KEY=...
   APPLY=1 SCOPE=system-b KUBECTL="kubectl --context system-b" \
     ./scripts/create-operator-secrets.sh

   kubectl --context system-b apply -f k8s/system-b/minio.yaml
   MINIO_ROOT_USER="$MINIO_ACCESS_KEY" \
     MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
     ./scripts/create-minio-bucket.sh
   kubectl --context system-b apply -f k8s/system-b/offload-worker.yaml
   ```

   The default offload-worker image is
   `ghcr.io/napetrov/agentic-intel-demo/offload-worker:main`, published
   by `.github/workflows/publish-offload-worker.yml`. For local k3s/k3d
   without GHCR access, use `./scripts/load-offload-worker-image.sh` and
   apply the manifest with the printed `sed` patch.

3. **System A — inference proxy + secrets:**
   ```bash
   APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
     TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... \
     SAMBANOVA_API_KEY=... \
     MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
     ./scripts/create-operator-secrets.sh

   SYSTEM_B_VLLM_ENDPOINT="http://${SYSTEM_B_IP}:30434/v1" \
     AWS_REGION=us-east-2 \
     envsubst < k8s/system-a/litellm.yaml \
     | kubectl --context system-a apply -f -
   ```

4. **System A — operator and OpenClaw instance:**
   ```bash
   ./scripts/check-operator-prereqs.sh

   APPLY=1 OPENCLAW_OPERATOR_REF=<tag|sha> \
     ./scripts/install-openclaw-operator.sh

   # examples/openclawinstance-intel-demo.yaml ships a concrete spec
   # (Bedrock ARN, AWS region, Telegram allow-id, model list). The only
   # ${VAR} token in the file is ${TELEGRAM_BOT_TOKEN} inside the
   # embedded openclaw.json — that's expanded at session-pod runtime by
   # the OpenClaw operator from intel-demo-operator-secrets, not by
   # envsubst at apply time. Edit the YAML in place if you need different
   # values for region / allow-from / Bedrock profile.
   kubectl --context system-a apply \
     -f examples/openclawinstance-intel-demo.yaml

   APPLY=1 ./scripts/smoke-test-operator-instance.sh
   ```

5. **Telegram menu:**
   ```bash
   scripts/telegram-send-menu.py
   ```

6. **Demo-task smoke** (proves the demo can actually run a task, not
   just that the lifecycle is healthy):
   ```bash
   APPLY=1 SYSTEM_A_KUBECTL="kubectl --context system-a" \
     ./scripts/smoke-test-demo-task.sh
   APPLY=1 ./scripts/smoke-test-offload-k8s.sh   # optional: full offload roundtrip
   ```
   Inspect logs with `./scripts/check-tier2-logs.sh` (per-component
   filters: `operator`, `session`, `gateway`, `litellm`, `vllm`,
   `offload`, `minio`).

Refer to `docs/operator-runbook.md` and `docs/internal/operator-gap-analysis.md` as
the source of truth for operator bring-up and known blockers.

Use Tier 2 when you need to reproduce the shipped demo end-to-end.

## Tier-to-scenario matrix

Not every scenario in `catalog/scenarios.yaml` is exercised by every tier.

| Scenario | Tier 0 | Tier 1 | Tier 2 |
|----------|--------|--------|--------|
| `terminal_agent` (local-standard) | simulated | partial (no OpenClaw agent) | fully exercised |
| `market_research` (offload) | simulated | fully exercised on System B path | fully exercised |
| `large_build_test` (local-large) | simulated | partial (runs inline, not on a sized pod) | fully exercised via a statically-sized `large` session pod (no runtime scale-up step) |

"Fully exercised" here means the runtime path an end user would hit in
production. "Simulated" means the UX flow is shown but no real backend runs.

## What is still a gap

- `POST /offload`, `GET /offload/{job_id}`, `GET /artifacts/{ref}` are
  implemented in `runtimes/control-plane/` and exercised end-to-end
  by the `tier1-scenario-slice` CI job (process-level) and by
  `tier2-offload-smoke` (k3d-level). The job registry is now durable:
  set `JOBS_DB_PATH=/var/lib/control-plane/jobs.db` (the compose file
  does this; dev-up.sh too) so a relay restart doesn't drop issued
  `result_ref`s. Unset (or `:memory:`) keeps the legacy in-memory mode.
- `POST /sessions/{id}/scale-up` has been dropped. `large_build_test` now
  runs on a statically-sized `large` session pod selected at
  `OpenClawInstance` creation time (see `docs/architecture-variants.md`,
  `local-large` variant).
- `LocalSessionBackend` now persists via `SESSIONS_DB_PATH` so the
  multi-agent fan-out table survives a control-plane restart. The
  `kube` backend reads from k8s and never needed a local cache.
- Full operator-managed OpenClaw instance lifecycle still depends on
  upstream pins — see `docs/internal/operator-gap-analysis.md` gaps #1, #4, #5,
  #7 for the four candidate pins (operator ref, runtime image, Ready
  phase, vLLM chart).

See `docs/internal/operator-gap-analysis.md` for the active gap list.

## Known unknowns (must be supplied by the deployer)

These values are not pinned in the repo and must come from the deployer
or the surrounding environment. They are the most common reason a fresh
Tier 2 bring-up doesn't reach Ready.

| Value | Why it isn't pinned | Where to get it |
|-------|---------------------|-----------------|
| `OPENCLAW_OPERATOR_REF` | upstream project. Now defaults to `v0.30.0` as a candidate (latest upstream release at repo-pin time); `scripts/install-openclaw-operator.sh` prints a "candidate ref" notice unless `OPENCLAW_OPERATOR_REF_VERIFIED=1`. Gap #1. | tag/SHA from `https://github.com/openclaw-rocks/openclaw-operator` releases. |
| `OpenClawInstance.spec.image` | runtime image published independently from the operator binary. Now defaults to `ghcr.io/openclaw-rocks/openclaw:v0.30.0` in `examples/openclawinstance-intel-demo.yaml`. Gap #4. | pick the operator-runtime tag that matches `OPENCLAW_OPERATOR_REF`; edit the YAML in place if it diverges. |
| `READY_JSONPATH` | upstream phase value depends on operator ref. Defaults to `{.status.phase}` and accepts `Running` (canonical for v0.30.0); set to empty to fall through to the legacy heuristic. Gap #5. | confirm via `kubectl get openclawinstance <name> -o yaml` once the controller settles. |
| `CHART_REPO` for vLLM | upstream Enterprise-Inference fork the demo doesn't redistribute. `scripts/setup-system-b-vllm-local.sh` fails fast on `<your-org>` placeholders; the static fallback is `kubectl apply -f k8s/system-b/vllm.yaml`. Gap #7. | your fork URL + tag, OR the static manifest. |
| `BEDROCK_MODEL_ID` / `ANTHROPIC_DEFAULT_SONNET_MODEL` | depends on which Bedrock inference profile *your* AWS account has enabled. | AWS console → Bedrock → "Inference profiles" → copy the profile id and the `arn:aws:bedrock:...:inference-profile/...` ARN. |
| `AWS_REGION` | the region of the inference profile above. | same console step (top-right region selector). |
| `SambaNova model id` | the demo defaults to `sambanova/DeepSeek-V3.1`; SambaNova ships and rotates models independently. | confirm against `https://api.sambanova.ai/v1/models` for your key. Adjust `model_name: sambanova` in `k8s/system-a/litellm.yaml` if needed. |
| `SYSTEM_B_IP` | per-cluster LAN address. | `kubectl --context system-b get nodes -o wide` → `INTERNAL-IP`. |

A single canonical Ready jsonpath for `OpenClawInstance` is now baked
into `scripts/smoke-test-operator-instance.sh` (`READY_JSONPATH` defaults
to `{.status.phase}`, with `Running` as the canonical Ready value for
upstream v0.30.0). Set `READY_JSONPATH=` (empty) to fall through to the
legacy `condition=Ready` + `.status.phase ∈ {Ready,Running,Active,Healthy}`
heuristic, or override `READY_JSONPATH` to a different shape if you bump
to a ref that surfaces Ready elsewhere.

## Recovery playbook (Tier 2)

Common failure modes and the smallest reset that fixes them. For full
component recovery (delete+reapply secrets, wipe artifact bucket, etc.)
see `docs/reproducibility.md` "Recovery / reset".

| Symptom | First check | Smallest fix |
|---------|-------------|--------------|
| Telegram bot doesn't reply | `kubectl --context system-a logs -n agents -l role=session-pod --tail=200` for `Unauthorized` (token rotated) or no `update_id` arriving (allow-id mismatch). | Re-run `scripts/create-operator-secrets.sh` with the correct `TELEGRAM_BOT_TOKEN`, then `kubectl --context system-a delete pods -n agents -l role=session-pod` to pick the new secret up. |
| Operator instance stuck in `Provisioning` | `kubectl --context system-a describe openclawinstance intel-demo-operator` and controller logs (`-n openclaw-operator-system logs deploy/openclaw-operator-controller-manager`). | Most often a missing Secret key — re-run `scripts/create-operator-secrets.sh` with `SCOPE=system-a`, then `APPLY=1 ./scripts/teardown-openclaw-instance.sh && kubectl apply -f examples/openclawinstance-intel-demo.yaml`. |
| LiteLLM 502 on `/v1/chat/completions` | `kubectl --context system-a logs -n inference deploy/litellm --tail=100` for the failing alias. | If `reasoning`/`sambanova` — re-issue the upstream key and re-apply `litellm-secrets`. If `fast`/`default` — check `SYSTEM_B_VLLM_ENDPOINT` from System A: `curl http://${SYSTEM_B_IP}:30434/v1/models`. |
| vLLM OOM / restart loop on System B | `kubectl --context system-b logs -n inference deploy/vllm --previous` for `CUDA out of memory` or process kill. | Reduce `--max-model-len` or switch to a smaller model in `scripts/setup-system-b-vllm-local.sh` (Qwen3-4B at 32768 reserves ~24Gi; drop to 8192 to fit in less). Re-run the script with `APPLY=1`. |
| `offload-worker` 5xx, `result_ref` not produced | `kubectl --context system-b logs -n system-b deploy/offload-worker --tail=200`. | Usually MinIO bucket missing — `MINIO_ROOT_USER=... MINIO_ROOT_PASSWORD=... ./scripts/create-minio-bucket.sh` recreates `demo-artifacts` idempotently. |
| MinIO bucket lost / artifacts purged | `mc ls local/demo-artifacts` from inside the cluster. | Re-create with the script above. Old `result_ref` URLs from prior sessions become 404; the demo recovers by re-running the offload step. |
| CRD apply fails with `metadata.annotations: Too long` | `kubectl get events -A \| grep openclawinstances`. | Use the server-side path baked into `scripts/install-openclaw-operator.sh` (`MODE=server-side-crd`, the default); see `docs/operator-runbook.md` "Working recovery strategy". |

## Where to look next

- New scenario author: `docs/scenario-spec.md`, `templates/scenarios/`,
  `docs/architecture-variants.md`.
- Deploying on a different topology (single-node, multi-system, alternative
  token providers): `docs/architecture-spec.md`, `templates/architecture/`.
- Operator bring-up issues: `docs/operator-runbook.md`,
  `docs/internal/operator-gap-analysis.md`.
- Component-by-component reuse/build decisions:
  `docs/reusable-components.md`.
- Validate scenarios + architecture files for consistency with the specs:
  `python3 scripts/validate-demo-templates.py` (also runs in CI as the
  `validate-templates` job).
