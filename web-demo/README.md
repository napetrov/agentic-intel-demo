# OpenClaw Agentic Intel Web Demo

Static web demo surface for showing:

- OpenClaw orchestration
- LiteLLM model routing
- SambaNova inference
- System A (CWF) and System B (GNR) execution paths
- run context explaining what answers where and why

## Run locally

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Run in Docker

```bash
docker build -t web-demo:local ./web-demo
docker run --rm -p 8080:8080 web-demo:local
```

The container is `nginx:alpine` serving the three static files on port 8080 with
basic security headers set.

## Deploy to Kubernetes

```bash
WEB_DEMO_IMAGE=ghcr.io/your-org/web-demo:latest \
  envsubst < k8s/shared/web-demo.yaml | kubectl apply -f -
```

This creates a `web-demo` namespace with a 2-replica Deployment and ClusterIP
Service on port 80. Expose it with the ingress of your choice.

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
