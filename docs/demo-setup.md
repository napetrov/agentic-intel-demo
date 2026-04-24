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
| 1 — Local services | `offload-worker` + MinIO (+ optional `control-plane`) | Docker on one machine | real `POST /run`, artifact write to MinIO |
| 2 — Two-system k8s + operator | full stack: `openclaw-operator`, LiteLLM, vLLM, MinIO, offload-worker | two Intel CPU machines with k3s, Telegram bot | the full demo as shipped |

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

## Tier 1 — Local services

**Goal:** exercise the System B side of the architecture for real — the
offload worker, MinIO artifact storage, and (optionally) the legacy
control-plane stub — on one machine. No Telegram, no OpenClaw, no vLLM.

**Runs:**
- `runtimes/offload-worker/` on localhost:8080 (FastAPI)
- MinIO on localhost:9000 (S3 API) and localhost:9001 (console)
- optional: `legacy/services/control-plane/` on a different free port —
  for example localhost:8081 — against a local kubeconfig. Do not reuse
  9000/9001 or 8080; those are taken by MinIO and the offload worker in
  this tier. Only useful if you have a k8s target the control-plane can
  talk to.

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

Verification:
```bash
curl localhost:8080/health
curl -X POST localhost:8080/run -H 'content-type: application/json' -d '{
  "task_type": "echo", "payload": {"hello": "world"}
}'
```

Cleanup when done:
```bash
docker rm -f demo-minio demo-offload 2>/dev/null || true
docker network rm demo-net 2>/dev/null || true
```

Unit tests that run without extra deps:
```bash
pip install fastapi pydantic boto3 pytest httpx
pytest runtimes/offload-worker/tests/ -q -k 'echo or health or invalid'
```

Pandas/sklearn-backed tests require the Docker image dependencies; CI runs
the full suite in `offload-worker` GitHub Actions job.

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
- Telegram bot token and allowed-user id.
- Cloud model credentials for the reasoning alias (optional; defaults fall
  back to LiteLLM-served local SLM).

### Bring-up order

1. **Environment** — see `docs/mvp-plan.md` Phase 0.
2. **System B — model backend and storage:**
   ```bash
   scripts/setup-system-b-vllm.sh     # vLLM for Qwen3-4B at NodePort 30434
   kubectl --context system-b apply -f k8s/system-b/minio.yaml
   scripts/create-minio-bucket.sh     # demo-artifacts bucket
   kubectl --context system-b apply -f k8s/system-b/offload-worker.yaml
   ```
3. **System A — inference proxy:**
   ```bash
   kubectl --context system-a apply -f k8s/system-a/litellm.yaml
   ```
4. **System A — operator and OpenClaw instance:**
   ```bash
   scripts/check-operator-prereqs.sh
   # advisory: prints the CRD-first kubectl commands to run; it does NOT
   # apply anything itself — run the printed commands manually
   scripts/install-openclaw-operator.sh
   kubectl --context system-a apply -f examples/openclawinstance-intel-demo.yaml
   scripts/smoke-test-operator-instance.sh
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
| `large_build_test` (local-large) | simulated | partial (no scale-up surface) | partial — scale-up endpoints are planned, not implemented (see `docs/mvp-plan.md` Phase 6) |

"Fully exercised" here means the runtime path an end user would hit in
production. "Simulated" means the UX flow is shown but no real backend runs.

## What is still a gap

- `POST /offload`, `GET /offload/{job_id}`, `GET /artifacts/{ref}`, and
  `POST /sessions/{id}/scale-up` are the documented contract in
  `docs/architecture.md` but are not yet implemented in
  `legacy/services/control-plane/app.py`. Tier 2 today relies on the
  operator-managed OpenClaw instance plus direct offload-worker calls; the
  control-plane relay is planned work (see `docs/mvp-plan.md` Phase 6/7).
- Full session-lifecycle registry beyond the current `/sessions` stub.

See `docs/operator-gap-analysis.md` for the active gap list.

## Where to look next

- New scenario author: `docs/scenario-spec.md`, `templates/scenarios/`,
  `docs/architecture-variants.md`.
- Operator bring-up issues: `docs/operator-runbook.md`,
  `docs/operator-gap-analysis.md`.
- Component-by-component reuse/build decisions:
  `docs/reusable-components.md`.
