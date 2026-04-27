# Top-level developer entrypoints for the demo. Each target is a thin
# wrapper around the underlying script or docker compose call documented
# in README.md / docs/demo-setup.md. The Makefile is just so you don't
# have to memorise invocations.

WEB_DEMO_PORT ?= 8080

.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"; printf "Available targets:\n"} /^[a-zA-Z0-9_.-]+:.*##/ { printf "  %-26s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# --- Tier 0 (web simulation) ------------------------------------------------

.PHONY: tier0
tier0: ## Tier 0: serve web-demo/ statically on $(WEB_DEMO_PORT)
	python3 -m http.server $(WEB_DEMO_PORT) --directory web-demo

.PHONY: tier0-docker
tier0-docker: ## Tier 0: build + run web-demo/ container
	docker build -t web-demo:local ./web-demo
	docker run --rm -p $(WEB_DEMO_PORT):8080 web-demo:local

.PHONY: tier0-smoke
tier0-smoke: ## Tier 0: Playwright smoke tests against a running web-demo
	cd web-demo && npm install && npx playwright install --with-deps chromium
	cd web-demo && BASE_URL=http://localhost:$(WEB_DEMO_PORT) npx playwright test

# --- Tier 1 (local services) ------------------------------------------------

.PHONY: tier1-up
tier1-up: ## Tier 1: docker compose up (control-plane + offload-worker + MinIO + web)
	docker compose up --build

.PHONY: tier1-down
tier1-down: ## Tier 1: docker compose down (keep MinIO volume)
	docker compose down

.PHONY: tier1-down-volumes
tier1-down-volumes: ## Tier 1: docker compose down -v (also drop MinIO volume)
	docker compose down -v

.PHONY: tier1-up-novm
tier1-up-novm: ## Tier 1: bring up FastAPI runtimes via venv (no Docker)
	./scripts/dev-up.sh

.PHONY: tier1-down-novm
tier1-down-novm: ## Tier 1: tear down the venv runtimes started by dev-up.sh
	./scripts/dev-down.sh

.PHONY: tier1-scenario-slice
tier1-scenario-slice: ## Tier 1: run the CI scenario-slice (control-plane offload roundtrip)
	python3 scripts/ci-scenario-slice.py

# --- Tier 2 (two-system k3s + operator) -------------------------------------
# All operator-side targets pin to --context system-a explicitly; vLLM /
# System B targets pin to --context system-b. Override with
# `make ... SYSTEM_A_KUBECTL='kubectl --kubeconfig …'` if your contexts
# are named differently (single-cluster: pass the same value for both).
SYSTEM_A_KUBECTL ?= kubectl --context system-a
SYSTEM_B_KUBECTL ?= kubectl --context system-b

.PHONY: tier2-preflight
tier2-preflight: ## Tier 2: workstation preflight (kubectl/contexts/API/CRD; read-only)
	./scripts/check-tier2-environment.sh

.PHONY: tier2-pins
tier2-pins: ## Tier 2: validate upstream pins (operator ref, GHCR/vLLM image manifests; no cluster)
	./scripts/check-upstream-pins.sh

.PHONY: tier2-telegram
tier2-telegram: ## Tier 2: validate Telegram bot wiring (TELEGRAM_BOT_TOKEN required; no cluster)
	./scripts/check-telegram-routing.sh

.PHONY: tier2-tool-trace
tier2-tool-trace: ## Tier 2: scan recent session-pod logs for tool invocation (run after DM /demo)
	SYSTEM_A_KUBECTL="$(SYSTEM_A_KUBECTL)" ./scripts/check-openclaw-tools.sh

.PHONY: tier2-secrets-verify
tier2-secrets-verify: ## Tier 2: verify Secrets exist with the expected keys (no values read)
	SYSTEM_A_KUBECTL="$(SYSTEM_A_KUBECTL)" SYSTEM_B_KUBECTL="$(SYSTEM_B_KUBECTL)" \
	  ./scripts/verify-operator-secrets.sh

.PHONY: tier2-logs
tier2-logs: ## Tier 2: tail logs for every component (or pass WHICH=operator|session|gateway|litellm|vllm|offload|minio)
	SYSTEM_A_KUBECTL="$(SYSTEM_A_KUBECTL)" SYSTEM_B_KUBECTL="$(SYSTEM_B_KUBECTL)" \
	  ./scripts/check-tier2-logs.sh $(WHICH)

.PHONY: tier2-secrets-system-a
tier2-secrets-system-a: ## Tier 2: render System A Secrets from env (APPLY=1 to apply)
	APPLY=$(APPLY) SCOPE=system-a KUBECTL="$(SYSTEM_A_KUBECTL)" \
	  ./scripts/create-operator-secrets.sh

.PHONY: tier2-secrets-system-b
tier2-secrets-system-b: ## Tier 2: render System B Secrets from env (APPLY=1 to apply)
	APPLY=$(APPLY) SCOPE=system-b KUBECTL="$(SYSTEM_B_KUBECTL)" \
	  ./scripts/create-operator-secrets.sh

.PHONY: tier2-vllm
tier2-vllm: ## Tier 2: System B vLLM bring-up (set CHART_REPO/CHART_REF; APPLY=1 to apply)
	APPLY=$(APPLY) KUBECTL="$(SYSTEM_B_KUBECTL)" \
	  ./scripts/setup-system-b-vllm-local.sh

.PHONY: tier2-operator-install
tier2-operator-install: ## Tier 2: install openclaw-operator on system-a (set OPENCLAW_OPERATOR_REF; APPLY=1 to apply)
	APPLY=$(APPLY) KUBECTL="$(SYSTEM_A_KUBECTL)" \
	  ./scripts/install-openclaw-operator.sh

.PHONY: tier2-instance-apply
tier2-instance-apply: ## Tier 2: apply examples/openclawinstance-intel-demo.yaml on system-a (APPLY=1 to apply)
	@if [ "$(APPLY)" = "1" ]; then \
	  $(SYSTEM_A_KUBECTL) apply -f examples/openclawinstance-intel-demo.yaml; \
	else \
	  echo "+ $(SYSTEM_A_KUBECTL) apply -f examples/openclawinstance-intel-demo.yaml"; \
	  echo "  (dry-run; set APPLY=1 to actually apply)"; \
	fi

.PHONY: tier2-smoke
tier2-smoke: ## Tier 2: smoke-test the operator instance lifecycle on system-a (APPLY=1 to actually run)
	APPLY=$(APPLY) KUBECTL="$(SYSTEM_A_KUBECTL)" \
	  ./scripts/smoke-test-operator-instance.sh

.PHONY: tier2-demo-task-smoke
tier2-demo-task-smoke: ## Tier 2: smoke-test the live demo task (gateway/litellm/telegram-config; APPLY=1 to actually run)
	APPLY=$(APPLY) SYSTEM_A_KUBECTL="$(SYSTEM_A_KUBECTL)" \
	  ./scripts/smoke-test-demo-task.sh

.PHONY: tier2-offload-smoke
tier2-offload-smoke: ## Tier 2: smoke-test the System A → System B offload roundtrip (APPLY=1 to actually run)
	APPLY=$(APPLY) SYSTEM_A_KUBECTL="$(SYSTEM_A_KUBECTL)" \
	  ./scripts/smoke-test-offload-k8s.sh

.PHONY: tier2-teardown
tier2-teardown: ## Tier 2: operator-owned teardown of the demo OpenClawInstance on system-a (APPLY=1 to apply)
	APPLY=$(APPLY) KUBECTL="$(SYSTEM_A_KUBECTL)" \
	  ./scripts/teardown-openclaw-instance.sh

# --- Quality gates ----------------------------------------------------------

.PHONY: lint
lint: ## Run repo-local lint suite (mirrors .github/workflows/lint.yml)
	@echo "[lint] bash -n on scripts/ + agents/"
	@find scripts agents -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
	@echo "[lint] shellcheck (blocking; matches CI)"
	@if command -v shellcheck >/dev/null 2>&1; then \
	  find scripts agents -type f -name '*.sh' -print0 \
	    | xargs -0 shellcheck -S warning; \
	else \
	  echo "  shellcheck not installed; skipping (apt-get install shellcheck)"; \
	fi
	@echo "[lint] python -m py_compile"
	@find . -path ./.git -prune -o -path ./.dev-up -prune -o -path ./.test-venv -prune -o -name '*.py' -print \
	  | while IFS= read -r f; do python3 -m py_compile "$$f"; done
	@echo "[lint] ruff check (blocking; F + E9 — matches CI)"
	@if command -v ruff >/dev/null 2>&1; then \
	  ruff check --select=F,E9 runtimes/ scripts/; \
	else \
	  echo "  ruff not installed; skipping (pip install ruff)"; \
	fi
	@echo "[lint] node --check on web-demo/*.js + lib/*.js"
	@find web-demo -maxdepth 3 -name '*.js' -not -path '*/node_modules/*' -print \
	  | while IFS= read -r f; do node --check "$$f"; done
	@echo "[lint] check-jsonschema on catalog + architecture"
	@if command -v check-jsonschema >/dev/null 2>&1; then \
	  check-jsonschema --schemafile schemas/scenarios.schema.json catalog/scenarios.yaml; \
	  check-jsonschema --schemafile schemas/tasks.schema.json catalog/tasks.yaml; \
	  check-jsonschema --schemafile schemas/architecture.schema.json templates/architecture/examples/*/architecture.yaml; \
	else \
	  echo "  check-jsonschema not installed; skipping (pip install check-jsonschema)"; \
	fi

.PHONY: test
test: ## Run unit tests (offload-worker + control-plane + web-demo unit)
	python3 -m venv .test-venv
	.test-venv/bin/python -m pip install -q --upgrade pip
	.test-venv/bin/python -m pip install -q fastapi pydantic boto3 pytest pytest-cov httpx
	.test-venv/bin/python -m pytest runtimes/offload-worker/tests/ -q -k 'echo or health or invalid'
	.test-venv/bin/python -m pytest runtimes/control-plane/tests/ -q --cov --cov-report=term-missing
	@if [ -d web-demo/node_modules ]; then \
	  cd web-demo && npm run test:unit; \
	else \
	  echo "[test] web-demo/node_modules not found — run 'cd web-demo && npm install' first to enable Vitest"; \
	fi

.PHONY: validate-templates
validate-templates: ## Validate scenarios + architecture templates against the specs
	python3 scripts/validate-demo-templates.py

.PHONY: docker-build-check
docker-build-check: ## Build every Dockerfile (no push) — mirrors CI docker-build job
	docker build -f web-demo/Dockerfile                web-demo                -t web-demo:check
	docker build -f runtimes/offload-worker/Dockerfile runtimes/offload-worker -t offload-worker:check
	docker build -f runtimes/control-plane/Dockerfile  runtimes/control-plane  -t control-plane:check
	docker build -f runtimes/agent-stub/Dockerfile     runtimes/agent-stub     -t agent-stub:check

.PHONY: docker-compose-check
docker-compose-check: ## Validate every docker-compose file — mirrors CI docker-compose-config job
	docker compose -f docker-compose.yaml config -q
	# Overlays reference base services, so combine -f base + -f overlay.
	# Stub creds satisfy the `${VAR:?}` "must be set" guards; never used
	# at runtime — `make tier1-up` reads real values from .env.
	FLOWISE_USERNAME=ci-stub FLOWISE_PASSWORD=ci-stub FLOWISE_SECRETKEY_OVERWRITE=ci-stub \
	  docker compose -f docker-compose.yaml -f docker-compose.flowise.yaml config -q
	docker compose -f docker-compose.yaml -f docker-compose.openwebui.yaml config -q
