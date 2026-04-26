# Repository Layout

```
agentic-intel-demo/
│
├── README.md
│
├── docs/
│   ├── architecture.md          # full architecture breakdown
│   ├── mvp-plan.md              # phased implementation plan
│   ├── reusable-components.md   # what to reuse, what to build
│   ├── repo-layout.md           # this file
│   ├── open-questions.md        # decisions and unknowns
│   ├── reproducibility.md       # how to redeploy from scratch
│   ├── port-map.md              # fixed NodePort values + k3s install params
│   └── single-node-validation.md # how to validate on onedal-build first
│
├── config/
│   ├── versions.yaml            # all component version pins
│   ├── env/
│   │   ├── system-a.yaml.template
│   │   └── system-b.yaml.template
│   ├── model-routing/
│   │   └── litellm-config.yaml  # LiteLLM routing rules, aliases, fallbacks
│   ├── pod-profiles/
│   │   └── profiles.yaml        # small / medium / large pod specs
│   ├── task-types/
│   │   └── task-types.yaml      # task type definitions, execution policies
│   └── offload-policies/
│       └── offload-policies.yaml
│
├── k8s/
│   ├── system-a/
│   │   ├── namespaces.yaml
│   │   ├── rbac.yaml            # ServiceAccount + RBAC for control plane
│   │   ├── control-plane.yaml   # Deployment + Service
│   │   ├── litellm.yaml         # Deployment + Service
│   │   ├── chat-gateway.yaml    # optional mapper service for external ingress
│   │   └── session-pod-template.yaml  # Pod template used by control plane
│   ├── system-b/
│   │   ├── namespaces.yaml
│   │   ├── ollama.yaml          # historical; vLLM is the canonical path. Same NodePort 30434 — bring vLLM up via scripts/setup-system-b-vllm-local.sh, not ollama.yaml.
│   │   ├── minio.yaml           # Deployment + Service + hostPath/PVC
│   │   ├── offload-api.yaml     # Deployment + Service (NodePort 30800)
│   │   └── worker-job-template.yaml
│   └── shared/
│       ├── minio-secret.yaml.template
│       └── system-b-kubeconfig-secret.yaml.template
│
├── services/
│   ├── control-plane/
│   │   ├── main.py              # FastAPI app
│   │   ├── session_manager.py   # k8s pod create/delete/status
│   │   ├── job_launcher.py      # execution job and offload dispatch
│   │   ├── artifact_client.py   # artifact relay via MinIO
│   │   ├── policy.py            # pod profile and routing resolution
│   │   ├── db.py                # SQLite session/job registry
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── offload-api/
│   │   ├── main.py              # FastAPI app
│   │   ├── job_runner.py        # k8s Job launch on System B
│   │   ├── artifact_client.py   # MinIO write helpers
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── chat-gateway/
│       ├── main.py              # optional chat_user -> session_id mapper
│       ├── requirements.txt
│       └── Dockerfile
│
├── runtimes/
│   ├── session-pod/
│   │   ├── Dockerfile           # Node.js + openclaw + tools
│   │   └── openclaw-config.yaml # agent config template
│   └── worker-images/
│       ├── analytics-worker/
│       │   ├── Dockerfile       # python:3.12-slim + pandas + sklearn + boto3
│       │   └── run.py           # worker entry point
│       └── build-test-worker/
│           ├── Dockerfile       # build tools + compilers
│           └── run.sh
│
├── agents/
│   ├── orchestrator.md          # top-level scenario routing / acknowledgements
│   └── scenarios/               # one folder per built-in scenario
│       ├── terminal-agent/
│       ├── market-research/
│       └── large-build-test/
│
├── catalog/
│   ├── scenarios.yaml           # scenario catalog consumed by the agent
│   └── tasks.yaml
│
├── examples/
│   └── openclawinstance-intel-demo.yaml   # sample OpenClawInstance manifest
│
└── scripts/
    ├── install-openclaw-operator.sh
    ├── apply-operator-chat-config.sh
    ├── check-operator-prereqs.sh
    ├── smoke-test-operator-instance.sh
    ├── setup-system-b-vllm.sh
    ├── check-system-b-vllm.sh
    ├── cleanup-system-a.sh
    ├── create-minio-bucket.sh
    ├── ci-scenario-slice.py
    ├── validate-demo-templates.py
    ├── telegram-send-menu.py
    ├── test-litellm-sambanova.sh
    └── test-sambanova-direct.sh
```

---

## Namespace layout

### System A
| Namespace | Contents |
|-----------|----------|
| `agents` | session pods, session pod ServiceAccounts |
| `inference` | LiteLLM proxy |
| `platform` | control plane service |

### System B
| Namespace | Contents |
|-----------|----------|
| `system-b` | vLLM (canonical), minio, offload API, worker jobs |

---

## Notes on layout decisions

- `config/` — tunable policies, templates, and version pins live here
- `k8s/` — separated by system for clear deployment targeting
- `services/` — only custom code lives here; everything else is deployed from upstream images
- `runtimes/` — container images only; agent logic is in OpenClaw config, not Dockerfile
- `demos/` — one folder per demo task; self-contained and runnable independently
- `scripts/` — all operational scripts; no undocumented manual steps
