# Repository Layout

Snapshot of where things live in this repo. Keep this in sync with the actual
tree — drift is a known maintenance hazard.

```
agentic-intel-demo/
│
├── README.md                # entry point; "Where to start" table on top
├── CONTRIBUTING.md          # contributor workflow per change type
├── Makefile                 # `make help` lists tier0/tier1/tier2 targets
├── docker-compose.yaml                # Tier 1 base stack (control-plane + offload-worker + MinIO + web)
├── docker-compose.flowise.yaml        # opt-in Flowise overlay
├── docker-compose.openwebui.yaml      # opt-in OpenWebUI overlay
├── .env.example                       # Tier 1 env reference (Tier 2 vars live in docs/reproducibility.md)
├── .pre-commit-config.yaml
│
├── docs/
│   ├── runbooks/
│   │   ├── tier2-bring-up.md          # canonical "empty cluster → demo task"
│   │   ├── demo-checklist.md
│   │   └── incident-recovery.md
│   ├── contracts/                     # System A/B boundary contracts
│   │   ├── session-lifecycle.md
│   │   ├── task-routing.md
│   │   └── offload-result-contract.md
│   ├── internal/                      # maintainer artifacts (gap tracker, audit notes)
│   ├── archive/                       # historical / superseded docs
│   ├── architecture.md                # shipped two-system reference
│   ├── architecture-spec.md           # pluggable architecture spec
│   ├── architecture-variants.md       # local-standard / local-large / offload
│   ├── demo-overview.md               # one-page operating model
│   ├── demo-setup.md                  # tiered bring-up reference
│   ├── operator-install.md
│   ├── operator-runbook.md
│   ├── reproducibility.md             # values to fill in, secrets, recovery
│   ├── versions-tested.md             # validated combinations
│   ├── port-map.md                    # NodePort + k3s install flags
│   ├── api-reference.md               # control-plane HTTP contract
│   ├── agent-tool-reference.md        # tool registry
│   ├── health-probes.md
│   ├── flowise-integration.md
│   ├── sambanova-integration.md
│   ├── scenario-spec.md
│   ├── implementation-guide.md
│   ├── reusable-components.md
│   ├── single-node-validation.md
│   ├── repo-layout.md                 # this file
│   └── telegram-operator-checklist.md
│
├── config/
│   ├── versions.yaml                  # component pins (single source of truth)
│   ├── env/
│   │   ├── system-a.yaml.template
│   │   └── system-b.yaml.template
│   ├── model-routing/
│   │   ├── litellm-config.yaml        # k8s ConfigMap content
│   │   └── litellm-compose.yaml       # docker-compose-mode aliases
│   ├── pod-profiles/profiles.yaml     # small / medium / large session pod specs
│   ├── task-types/task-types.yaml
│   ├── flowise/flows/                 # Flowise flow specs (one md per scenario)
│   └── operator-chat-config.template.json
│
├── catalog/
│   ├── scenarios.yaml                 # scenario catalog the orchestrator consumes
│   └── tasks.yaml                     # task families referenced by scenarios
│
├── agents/
│   ├── orchestrator.md                # top-level routing / acknowledgements
│   ├── context-map.md                 # which files load per scenario
│   ├── common.md
│   ├── scenarios/                     # one folder per built-in scenario
│   │   ├── terminal-agent/
│   │   ├── market-research/
│   │   └── large-build-test/
│   └── tasks/
│       ├── engineering/
│       └── analytics/
│
├── runtimes/                          # in-repo container images
│   ├── control-plane/                 # FastAPI offload relay + sessions API
│   ├── offload-worker/                # FastAPI worker (System B execution path)
│   └── agent-stub/                    # Tier 1 stand-in for the OpenClaw gateway
│
├── k8s/
│   ├── system-a/                      # operator-target manifests (LiteLLM, control-plane, RBAC, …)
│   ├── system-b/                      # vLLM (canonical), MinIO, offload-worker, agent-stub. ollama.yaml is historical.
│   └── shared/                        # secret templates
│
├── examples/
│   └── openclawinstance-intel-demo.yaml   # the shipped OpenClawInstance spec
│
├── templates/
│   ├── README.md
│   ├── result-summary.md              # required scenario summary shape
│   ├── tg-messages.md                 # Telegram copy
│   ├── scenarios/
│   │   ├── README.md
│   │   ├── scenario-spec.template.yaml
│   │   ├── flow.template.md
│   │   ├── task-brief.template.md
│   │   └── examples/                  # filled-in versions of the three built-in scenarios
│   └── architecture/
│       ├── README.md
│       ├── architecture.template.yaml
│       └── examples/                  # single-node, two-system, multi-system, cloud-provider-mix
│
├── schemas/                           # JSON schema for templates (consumed by validate-demo-templates.py)
├── demo-workspace/                    # files staged into the OpenClawInstance workspace at boot
├── web-demo/                          # static web UI (served by Tier 0/1)
│
└── scripts/
    ├── check-tier2-environment.sh     # workstation preflight (read-only)
    ├── check-upstream-pins.sh         # validate every pinned image/tag resolves
    ├── install-openclaw-operator.sh
    ├── create-operator-secrets.sh
    ├── verify-operator-secrets.sh
    ├── apply-operator-chat-config.sh
    ├── check-operator-prereqs.sh
    ├── smoke-test-operator-instance.sh
    ├── smoke-test-demo-task.sh
    ├── smoke-test-offload-k8s.sh
    ├── teardown-openclaw-instance.sh
    ├── check-openclaw-tools.sh
    ├── check-tier2-logs.sh
    ├── check-system-b-vllm.sh
    ├── setup-system-b-vllm-local.sh   # canonical: kubectl/helm vLLM bring-up
    ├── load-offload-worker-image.sh
    ├── cleanup-system-a.sh
    ├── create-minio-bucket.sh
    ├── ci-scenario-slice.py
    ├── validate-demo-templates.py
    ├── telegram-send-menu.py
    ├── check-telegram-routing.sh
    ├── test-litellm-sambanova.sh
    ├── test-sambanova-direct.sh
    ├── load-simulate.sh
    ├── dev-up.sh                      # FastAPI venv runtimes (no Docker)
    ├── dev-down.sh
    ├── dev_web_proxy.py
    ├── flowise/                       # Flowise overlay seed scripts
    ├── lib/load-versions.sh           # canonical reader for config/versions.yaml
    ├── archive/                       # legacy scripts kept for reference (e.g. SSH-based vLLM bring-up)
    └── tests/
```

---

## Namespace layout

### System A
| Namespace | Contents |
|-----------|----------|
| `agents` | session pods, session pod ServiceAccounts |
| `inference` | LiteLLM proxy |
| `platform` | control plane service |
| `openclaw-operator-system` | the upstream operator's controller |

### System B
| Namespace | Contents |
|-----------|----------|
| `system-b` | vLLM (canonical), MinIO, offload-worker, agent-stub |

---

## Notes on layout decisions

- `config/` — tunable policies, templates, version pins. `versions.yaml` is the source of truth for component pins.
- `k8s/` — separated by system for clear deployment targeting. `k8s/system-b/ollama.yaml` is kept as a fallback for hosts that can't run vLLM but is **not** the canonical path.
- `runtimes/` — only custom container code lives here; everything else is deployed from upstream images.
- `services/` no longer exists — the FastAPI services that used to live there were consolidated under `runtimes/`.
- `legacy/` and `scripts/legacy/` were removed; historical material is now under `docs/archive/` and `scripts/archive/`.
