# Architecture Specification

This document defines what a **demo architecture** is, so that an external
user can stand up the demo on any topology — single-node, two-system (the
shipped reference), or multi-system — using pluggable model providers and
execution backends.

It is the architecture-level counterpart to `docs/scenario-spec.md` (which
defines what a demo scenario must specify to run on top of an architecture).

The shipped reference architecture (`templates/architecture/examples/two-system/`)
is one concrete instance of this spec. `docs/architecture.md` describes that
specific instance in prose; `docs/architecture-variants.md` describes how
`execution_mode` reshapes it. Other topologies live in
`templates/architecture/examples/`.

## Core idea

A demo architecture is a set of **roles** filled by pluggable components,
placed on one or more **clusters**. Scenarios (`catalog/scenarios.yaml`) do
not reference hardware; they reference `execution_mode`s. The architecture
binds those modes to concrete clusters and components.

| Role | Purpose | Shipped default |
|------|---------|-----------------|
| orchestrator | session lifecycle, routing, user-visible status | `openclaw` managed by `openclaw-operator` |
| model_router | single endpoint for all agent model calls | `litellm` |
| inference_providers (1..N) | backends the router dispatches to (local + cloud) | `vllm` (local), `bedrock`, `sambanova` |
| execution_backends (0..N) | where offload / scale-up jobs run | System B worker job |
| artifact_store | shared object store for inputs/outputs/logs | `minio` |
| chat_adapters (1..N) | user-facing ingress | `telegram` |

Every role except `execution_backends` and `artifact_store` is mandatory.

## Topology

An architecture declares one or more clusters. A cluster has a `role`:

- `orchestration` — hosts the orchestrator and model router
- `execution` — hosts execution backends and/or artifact store
- `mixed` — does both (required for `single_node` topology)

Supported `topology.mode` values:

| Mode | Clusters | Use when |
|------|----------|----------|
| `single_node` | 1 (role: mixed) | laptops, CI, demos without offload |
| `two_system` | 2 (orchestration + execution) | the shipped reference |
| `multi_system` | 1 orchestration + N execution | fleet offload, specialized hardware per backend |

All topologies assume Kubernetes (k3s / kind / k3d / managed k8s). A
non-Kubernetes runtime is allowed on `single_node` for local development;
it must still honor the same role boundaries.

## Required fields

Every architecture instance MUST declare these fields (see
`templates/architecture/architecture.template.yaml` for the authoring shape):

| Field | Purpose |
|-------|---------|
| `apiVersion: demo.architecture/v1` | schema version |
| `kind: Architecture` | discriminator |
| `metadata.name` | unique identifier |
| `spec.topology.mode` | `single_node` \| `two_system` \| `multi_system` |
| `spec.topology.clusters[]` | list of clusters with `name`, `role`, `runtime` |
| `spec.components.orchestrator` | `type` + `location` (cluster name) |
| `spec.components.model_router` | `type` + `location` |
| `spec.components.inference_providers[]` | 1..N providers, each with `name`, `type`, `model`; local providers also carry `location`; cloud providers carry `auth` and optional `credential_ref` |
| `spec.components.artifact_store` | `type` + `location` (omit only if no scenario writes artifacts) |
| `spec.components.chat_adapters[]` | 1..N adapters |
| `spec.model_aliases` | map of agent-visible aliases (`default`, `fast`, `reasoning`, `code`) to provider `name`s |
| `spec.supported_execution_modes[]` | subset of `local_standard`, `local_large`, `offload_system_b` |

## Pluggable providers

Inference providers are the "token providers" that agents ultimately hit.
Any mix is legal as long as at least one is declared and each alias in
`spec.model_aliases` resolves to a declared provider.

Shipped provider types:

| `type` | Where it runs | Required fields |
|--------|---------------|-----------------|
| `vllm` | local cluster | `location`, `model`, `context_length` |
| `ollama` | local cluster | `location`, `model` |
| `bedrock` | cloud (AWS) | `model`, `auth: aws-sdk`, `region` |
| `sambanova` | cloud (SambaNova) | `model`, `auth: api-key`, `credential_ref` |
| `openai` | cloud | `model`, `auth: api-key`, `credential_ref` |
| `anthropic` | cloud | `model`, `auth: api-key`, `credential_ref` |

Adding a new provider type means:
1. declaring it here with required fields,
2. adding a routing entry to `config/model-routing/litellm-config.yaml`,
3. referencing it in the architecture's `inference_providers[]`.

`credential_ref` points at a Kubernetes Secret key (e.g.
`intel-demo-operator-secrets/OPENAI_API_KEY`); never embed keys in the
architecture file.

## Execution modes supported per topology

| Execution mode | `single_node` | `two_system` | `multi_system` |
|----------------|---------------|--------------|----------------|
| `local_standard` | yes | yes | yes |
| `local_large` | yes (same cluster) | yes (System A) | yes (orchestration cluster) |
| `offload_system_b` | no (same cluster has nowhere to offload to) | yes (System B) | yes (any execution cluster) |

A scenario's `execution_mode` must appear in the target architecture's
`supported_execution_modes`; otherwise the scenario is unrunnable on that
architecture.

## Validation

`scripts/validate-demo-templates.py` validates that:

- each architecture file parses and declares all required fields,
- `spec.components.*.location` references exist in `spec.topology.clusters[]`,
- every entry in `spec.model_aliases` resolves to a declared provider,
- every `spec.supported_execution_modes` entry is legal for the topology,
- scenarios in `catalog/scenarios.yaml` declare `execution_mode`s that are
  supported by at least one shipped architecture example.

CI runs this validator on every PR; see `.github/workflows/test.yml` job
`validate-templates`.

## Authoring a new architecture

1. Copy `templates/architecture/architecture.template.yaml` to
   `config/architectures/<your-name>.yaml` (or wherever you keep
   deployment config) and fill in the slots.
2. Cross-reference the closest example in
   `templates/architecture/examples/` to see how the slots are populated.
3. Run `python3 scripts/validate-demo-templates.py` to confirm consistency.
4. If you introduce a new provider type or runtime, extend this spec and
   `config/model-routing/litellm-config.yaml` before landing scenarios that
   depend on them.
