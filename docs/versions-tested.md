# Versions Tested

Single source of truth for the upstream component versions this demo has
been validated against. `config/versions.yaml` is the runtime / advisory
pin file; this doc records *what combinations have actually been brought
up end-to-end*.

If you are bumping a component, add a row rather than editing an existing
one until the new combo is demonstrated green on a real stand. Old rows
stay so we know what we can roll back to.

## Tier 1 (local docker-compose / `scripts/dev-up.sh`)

The local path is the most stable; bumps here are routine.

| Date | LiteLLM | MinIO | MinIO MC | Python base | Node base | Notes |
|------|---------|-------|----------|-------------|-----------|-------|
| 2026-04-21 | `ghcr.io/berriai/litellm:main-v1.63.11-stable` | `quay.io/minio/minio:RELEASE.2024-12-18T13-15-44Z` | `quay.io/minio/mc:RELEASE.2024-11-21T17-21-54Z` | `3.12-slim` | `22-slim` | Current `config/versions.yaml`. All compose unit tests pass; `scripts/dev-up.sh` no-Docker fallback green via moto. |

## Tier 2 (operator + k8s)

The operator path depends on a private GHCR image pull and is gated by
`scripts/check-upstream-pins.sh`. Until a row here records "operator
image: pulled successfully", treat the entry as candidate.

| Date | k3s | OpenClaw operator ref | OpenClaw image | LiteLLM | vLLM chart | Local SLM | Cloud reasoning | Status |
|------|-----|-----------------------|----------------|---------|------------|-----------|-----------------|--------|
| _pending_ | `v1.31.4+k3s1` | `v0.30.0` | `ghcr.io/openclaw-rocks/openclaw:v0.30.0` | `main-v1.63.11-stable` | `core/helm-charts/vllm` (CHART_REF pinned per env) | `Qwen/Qwen3-4B-Instruct-2507` | `bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0` | **Candidate** — operator image is private (HTTP 403 from public GHCR); needs `imagePullSecret` or registry mirror before live validation. Tracked as gap #4 in `docs/operator-gap-analysis.md`. |

When the row above is validated on a real stand, append a new row with
`Status: green`, set the validation date, and set
`OPENCLAW_OPERATOR_REF_VERIFIED=1` in the install env.

## Optional integrations

These are not on the critical demo path. Validate independently and
record results here.

| Integration | Date | Pin | Status |
|-------------|------|-----|--------|
| SambaNova (`DeepSeek-V3.1`) | _pending_ | LiteLLM router alias `sambanova` -> `sambanova/DeepSeek-V3.1` | Repo wired; not yet executed live from cluster — see `docs/sambanova-integration.md`. |
| Flowise overlay | _pending_ | `docker-compose.flowise.yaml` + `config/flowise/` | Compose validates; no smoke run recorded since the operator-first refactor. |
| Open WebUI overlay | _pending_ | `docker-compose.openwebui.yaml` | Compose validates; no smoke run recorded. |

## How to bump a component

1. Pick the component in `config/versions.yaml` and update the pin.
2. If it is referenced inline in a manifest (most are — see comments at
   the top of `config/versions.yaml`), update the manifest in lock-step.
   `scripts/lib/load-versions.sh` is the canonical reader for the values
   that are actually consumed at runtime.
3. Bring up the relevant tier locally and run the smoke scripts:
   - Tier 1: `scripts/dev-up.sh && scripts/dev-down.sh` (no errors).
   - Tier 2: `scripts/check-tier2-environment.sh`,
     `scripts/check-upstream-pins.sh`,
     `scripts/smoke-test-operator-instance.sh`,
     `scripts/smoke-test-demo-task.sh`,
     `scripts/smoke-test-offload-k8s.sh`.
4. Add a new row to the table above with the date, the new pin, and the
   smoke results ("green" / specific failures).
5. If anything regressed, leave the row as a documented data point and
   open an issue rather than reverting silently.
