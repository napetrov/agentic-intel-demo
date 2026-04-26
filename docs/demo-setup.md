# Demo Setup — Tiered Bring-up

This repo supports three distinct bring-up tiers. Pick the smallest tier
that demonstrates what you need; each higher tier adds real services at the
cost of more environment requirements.

All tiers share the same logical architecture (System A orchestrates,
System B executes offload). What differs is how much of that architecture
is real vs. simulated.

## Tier summary

| Tier | What runs | Needs | Verifies |
|------|-----------|-------|----------|
| 0 — Web simulation | static HTML/CSS/JS in `web-demo/` | any machine with Python or Docker | scenario flow, UX, narrative |
| 1 — Local services | `control-plane` + `offload-worker` + MinIO | Docker on one machine | full scenario slice: `POST /offload` → `/run` → MinIO artifact |
| 2 — Two-system k8s + operator | full stack: `openclaw-operator`, LiteLLM, vLLM, MinIO, offload-worker, control-plane | two Intel CPU machines with k3s, Telegram bot | the full demo as shipped |

## Tier 0 — Web simulation

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
- Telegram bot token + allowed-user id.
- Bedrock access (region + bearer token + inference profile ARN) for
  the `reasoning` alias, and/or a SambaNova API key for the `sambanova`
  alias. `k8s/system-a/litellm.yaml` maps `reasoning` → Bedrock Claude
  Sonnet and `sambanova` → SambaNova DeepSeek; provision each key
  against the alias it actually serves.
- A reachable upstream `openclaw-operator` ref pinned via
  `OPENCLAW_OPERATOR_REF`.

Full list of values you need to gather (`OPENCLAW_OPERATOR_REF`,
`BEDROCK_MODEL_ID`, `system_b_node_ip`, …) lives in
`docs/reproducibility.md` under "Values to fill in".

### Bring-up order

The exact list of values you need to gather first
(`OPENCLAW_OPERATOR_REF`, `BEDROCK_MODEL_ID`, `system_b_node_ip`, …)
lives in `docs/reproducibility.md` under "Values to fill in".

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

   APPLY=1 SCOPE=system-b KUBECTL="kubectl --context system-b" \
     MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
     ./scripts/create-operator-secrets.sh

   kubectl --context system-b apply -f k8s/system-b/minio.yaml
   SYSTEM_B_IP=<system-b-node-ip> \
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

   SYSTEM_B_VLLM_ENDPOINT=http://<system-b-node-ip>:30434/v1 \
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

Refer to `docs/operator-runbook.md` and `docs/operator-gap-analysis.md` as
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
  now implemented in `runtimes/control-plane/` and exercised end-to-end
  by the `tier1-scenario-slice` CI job (process-level) and by
  `tier2-offload-smoke` (k3d-level). The control-plane is a thin relay:
  in-memory job registry, synchronous forwarding to the offload-worker.
  A durable registry is still TODO.
- `POST /sessions/{id}/scale-up` has been dropped. `large_build_test` now
  runs on a statically-sized `large` session pod selected at
  `OpenClawInstance` creation time (see `docs/architecture-variants.md`,
  `local-large` variant).
- Full session-lifecycle registry beyond the current `/sessions` stub
  and operator-managed OpenClaw instance.

See `docs/operator-gap-analysis.md` for the active gap list.

## Where to look next

- New scenario author: `docs/scenario-spec.md`, `templates/scenarios/`,
  `docs/architecture-variants.md`.
- Deploying on a different topology (single-node, multi-system, alternative
  token providers): `docs/architecture-spec.md`, `templates/architecture/`.
- Operator bring-up issues: `docs/operator-runbook.md`,
  `docs/operator-gap-analysis.md`.
- Component-by-component reuse/build decisions:
  `docs/reusable-components.md`.
- Validate scenarios + architecture files for consistency with the specs:
  `python3 scripts/validate-demo-templates.py` (also runs in CI as the
  `validate-templates` job).
