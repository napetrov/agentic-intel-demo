# Architecture Templates

Fill-in starting kit for describing the topology and pluggable components
of a demo deployment. Pairs with `docs/architecture-spec.md` (requirements)
and `docs/architecture-variants.md` (how `execution_mode` reshapes a
two-system topology).

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

## Provider plug points

An architecture's `inference_providers[]` is the single place you declare
which "token providers" are available to agents. Today's template ships
with slots for:

- local: `vllm`, `ollama`
- cloud: `bedrock`, `sambanova`, `openai`, `anthropic`

To add a new provider type, follow `docs/architecture-spec.md` → "Pluggable
providers" and extend `config/model-routing/litellm-config.yaml` before
referencing it from an architecture.
