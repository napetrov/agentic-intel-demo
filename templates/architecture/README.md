# Architecture Templates

Fill-in starting kit for describing the topology and pluggable components
of a demo deployment. Pairs with `docs/architecture-spec.md` (requirements)
and `docs/architecture-variants.md` (how `execution_mode` reshapes a
two-system topology).

> **Spec-only files.** `architecture.template.yaml` and the four worked
> examples under `examples/` are validated for shape by
> `scripts/validate-demo-templates.py`, but **no deploy script consumes
> them**. The shipped deploy path pins to the two-system topology directly
> in `examples/openclawinstance-intel-demo.yaml`, `k8s/system-{a,b}/`,
> `config/model-routing/litellm-config.yaml`, and
> `config/env/system-{a,b}.yaml.template`. To stand the demo up on a
> different topology you must hand-translate the slots in your filled-in
> architecture file into those deploy artifacts. Treat this directory as
> the contract / target shape, not as a deployable manifest.

## Files

- `architecture.template.yaml` — pluggable template. Copy, fill slots, and
  validate.
- `examples/single-node/` — one k8s cluster, everything co-located. Best
  for laptops and CI.
- `examples/two-system/` — the shipped reference (System A + System B).
- `examples/multi-system/` — one orchestration cluster, multiple execution
  clusters (e.g., analytics on GNR, build/test on a separate CPU cluster).
- `examples/cloud-provider-mix/` — two-system with multiple cloud providers
  (Bedrock + SambaNova + local vLLM fronted by LiteLLM).

## How to author

1. Pick the example closest to your target topology.
2. Copy `architecture.template.yaml` (not the example) and fill in the
   slots. Use the example as reference when you are unsure which value goes
   where.
3. Run:
   ```bash
   python3 scripts/validate-demo-templates.py
   ```
4. Ensure each scenario's `execution_mode` in `catalog/scenarios.yaml`
   appears in your architecture's `spec.supported_execution_modes`.

## Translating an architecture to actual manifests

The validator only checks shape; it does **not** generate deploy artifacts.
After your architecture file is green, hand-translate every slot into the
files below. Until rendering is automated, this checklist is the contract
between an architecture spec and a working stand.

| Slot in your architecture file | Lands in (edit by hand) |
|---|---|
| `spec.components.orchestrator.location`, `spec.components.orchestrator.type` | `examples/openclawinstance-intel-demo.yaml` (`spec.image`, namespace), `k8s/system-a/` (which manifests apply where) |
| `spec.components.model_router.location` | `k8s/system-a/litellm.yaml` (and `config/model-routing/litellm-config.yaml` for the docker-compose path) |
| `spec.components.inference_providers[]` | `config/model-routing/litellm-config.yaml` `model_list:` and the mirrored `litellm-config` ConfigMap inside `k8s/system-a/litellm.yaml` |
| `spec.components.execution_backends[]` | `k8s/system-b/offload-worker.yaml` (location, replicas, resources) |
| `spec.components.artifact_store.bucket` / `.location` | `k8s/system-b/minio.yaml` + `scripts/create-minio-bucket.sh` |
| `spec.components.chat_adapters[]` | `examples/openclawinstance-intel-demo.yaml` (`channels.*` inside the embedded `openclaw.json`) |
| `spec.model_aliases.*` | `config/model-routing/litellm-config.yaml` and `config/operator-chat-config.template.json` (`models.providers.litellm.models[]`) |
| `spec.supported_execution_modes` | declarative — make sure every `execution_mode` referenced from `catalog/scenarios.yaml` is in this list |
| `spec.topology.clusters[].runtime` (k3s/kind/k3d) | `docs/port-map.md` install flags + your kubeconfig `contexts:` |

After the hand-translation pass, run:

```bash
python3 scripts/validate-demo-templates.py
./scripts/check-tier2-environment.sh
./scripts/check-upstream-pins.sh
```

— and only then attempt `APPLY=1 ./scripts/install-openclaw-operator.sh`.

Automating this rendering is a known gap (see
`docs/internal/operator-gap-analysis.md`).

## Provider plug points

An architecture's `inference_providers[]` is the single place you declare
which "token providers" are available to agents. Today's template ships
with slots for:

- local: `vllm`, `ollama`
- cloud: `bedrock`, `sambanova`, `openai`, `anthropic`

To add a new provider type, follow `docs/architecture-spec.md` → "Pluggable
providers" and extend `config/model-routing/litellm-config.yaml` before
referencing it from an architecture.
