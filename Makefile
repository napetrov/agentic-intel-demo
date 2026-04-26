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

.PHONY: tier2-secrets-system-a
tier2-secrets-system-a: ## Tier 2: render System A Secrets from env (APPLY=1 to apply)
	APPLY=$(APPLY) SCOPE=system-a KUBECTL="kubectl --context system-a" \
	  ./scripts/create-operator-secrets.sh

.PHONY: tier2-secrets-system-b
tier2-secrets-system-b: ## Tier 2: render System B Secrets from env (APPLY=1 to apply)
	APPLY=$(APPLY) SCOPE=system-b KUBECTL="kubectl --context system-b" \
	  ./scripts/create-operator-secrets.sh

.PHONY: tier2-vllm
tier2-vllm: ## Tier 2: System B vLLM bring-up (set CHART_REPO/CHART_REF; APPLY=1 to apply)
	APPLY=$(APPLY) KUBECTL="kubectl --context system-b" \
	  ./scripts/setup-system-b-vllm-local.sh

.PHONY: tier2-operator-install
tier2-operator-install: ## Tier 2: install openclaw-operator (set OPENCLAW_OPERATOR_REF; APPLY=1 to apply)
	APPLY=$(APPLY) ./scripts/install-openclaw-operator.sh

.PHONY: tier2-instance-apply
tier2-instance-apply: ## Tier 2: apply examples/openclawinstance-intel-demo.yaml on system-a
	kubectl --context system-a apply -f examples/openclawinstance-intel-demo.yaml

.PHONY: tier2-smoke
tier2-smoke: ## Tier 2: smoke-test the operator instance lifecycle (APPLY=1 to actually run)
	APPLY=$(APPLY) ./scripts/smoke-test-operator-instance.sh

.PHONY: tier2-teardown
tier2-teardown: ## Tier 2: operator-owned teardown of the demo OpenClawInstance (APPLY=1 to apply)
	APPLY=$(APPLY) ./scripts/teardown-openclaw-instance.sh

# --- Quality gates ----------------------------------------------------------

.PHONY: lint
lint: ## Run repo-local lint suite (matches .github/workflows/lint.yml)
	@echo "[lint] bash -n on scripts/"
	@find scripts -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
	@echo "[lint] python -m py_compile"
	@find . -path ./.git -prune -o -path ./.dev-up -prune -o -name '*.py' -print | xargs -r python3 -m py_compile
	@echo "[lint] node --check on web-demo/*.js"
	@find web-demo -maxdepth 2 -name '*.js' -print | xargs -r -n1 node --check

.PHONY: test
test: ## Run unit tests (offload-worker + control-plane)
	pip install -q fastapi pydantic boto3 pytest httpx
	pytest runtimes/offload-worker/tests/ -q -k 'echo or health or invalid'
	pytest runtimes/control-plane/tests/ -q

.PHONY: validate-templates
validate-templates: ## Validate scenarios + architecture templates against the specs
	python3 scripts/validate-demo-templates.py
