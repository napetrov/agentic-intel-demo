# OpenClaw Agentic Intel Web Demo

Static web demo surface for showing:

- OpenClaw orchestration
- LiteLLM model routing
- SambaNova inference
- System A (CWF) and System B (GNR) execution paths
- run context explaining what answers where and why

## Which path do I want?

This `web-demo/` is the static front-end only. Two panels in the UI —
"Run demo" (live backend mode) and "Agent command" — need a real
control-plane on `/api/*`. Without a backend, the Platform health rail
stays "probing" and Agent command renders "Backend not detected".

Pick one:

- **Static-only (Tier 0 — UX walkthrough, no backend).** Run this
  directory with any static server. The Run demo button falls back to
  the scripted walkthrough; Agent command is disabled.
- **Full local stack (Tier 1 — recommended).** From the repo root, run
  `docker compose up --build` (or `scripts/dev-up.sh` when container
  registries are blocked). That brings up MinIO, the agent-stub, the
  offload-worker, and the control-plane behind this UI's `/api`
  proxy. See the repo root `README.md` for prerequisites, ports, and
  teardown.

## Run static-only (Tier 0)

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Run static-only in Docker

```bash
docker build -t web-demo:local ./web-demo
docker run --rm -p 8080:8080 web-demo:local
```

The container is `nginx:alpine` serving the static files on port 8080 with
basic security headers set. In compose, the same image is the front-end
and `nginx.conf` reverse-proxies `/api/*` to the control-plane service.
Override `WEB_DEMO_CONTROL_PLANE_URL` when the UI must talk to an
already-running control-plane, for example
`WEB_DEMO_CONTROL_PLANE_URL=http://127.0.0.1:31001` for the System A
`control-plane-offload` NodePort.

## Deploy to Kubernetes

```bash
WEB_DEMO_IMAGE=ghcr.io/your-org/web-demo:latest \
  envsubst < k8s/shared/web-demo.yaml | kubectl apply -f -
```

This creates a `web-demo` namespace with a 2-replica Deployment and ClusterIP
Service on port 80. By default `/api/*` is proxied to
`http://control-plane-offload.platform.svc.cluster.local:8080`, so a public
production/demo deployment exercises `web-demo -> System A control-plane-offload
-> System B offload-worker` rather than a developer-local worker. Override the
`WEB_DEMO_CONTROL_PLANE_URL` env var in the Deployment if your System A
control-plane is exposed through a different FQDN or through the NodePort
(`http://<system-a-host>:31001`). Expose the web-demo Service with the ingress
of your choice.

## Smoke tests

A small Playwright suite validates that the page loads, each scenario card
populates the tool activity panel with ≥3 rows, and the walkthrough completes
end-to-end.

```bash
cd web-demo
npm install
npx playwright install --with-deps chromium
python3 -m http.server 8080 &
BASE_URL=http://localhost:8080 npx playwright test
```

The same suite runs in CI on every PR (`.github/workflows/test.yml`,
`web-demo-smoke` job).
