# Scenario Templates

This directory gives external demo authors a starting kit for adding a new
guided scenario. It pairs with `docs/scenario-spec.md` (what is required)
and `docs/architecture-variants.md` (how architecture differs per mode).

## Files

- `scenario-spec.template.yaml` — template for the `catalog/scenarios.yaml`
  entry. Copy the block into `catalog/scenarios.yaml` and fill in the slots.
- `flow.template.md` — template for `agents/scenarios/<id>/flow.md`.
- `task-brief.template.md` — template for the bounded task file under
  `agents/scenarios/<id>/`.
- `examples/` — filled-in versions of the three built-in scenarios, one per
  architecture variant. Use these as reference when filling in the templates.

Slot markers use `<...>` angle brackets. Replace every slot, including the
ones in YAML keys.

## How to add a new scenario

1. Pick the architecture variant from `docs/architecture-variants.md` that
   fits your scenario.
2. Open `scenario-spec.template.yaml` and copy ONLY the `<scenario_id>:`
   block (the indented entry), not the outer `scenarios:` line. Paste it as
   a new entry under the existing `scenarios:` map in
   `catalog/scenarios.yaml`, then fill in `id`, `label`, `execution_mode`,
   `task_family`, and the other fields listed in `docs/scenario-spec.md`.
   Never add a second top-level `scenarios:` key to `catalog/scenarios.yaml`.
3. Create `agents/scenarios/<id>/` and copy `flow.template.md` into
   `flow.md` and `task-brief.template.md` into `<task-name>.md`. Fill both in.
4. Add an entry to `agents/context-map.md` listing which files the
   orchestrator should load for the new scenario.
5. Add the Telegram triggers to the guided-triggers section of
   `agents/orchestrator.md`.
6. Walk the acceptance checklist in `docs/scenario-spec.md`.

## Examples

| Variant | Example dir | Built-in scenario |
|---------|-------------|-------------------|
| `local-standard` | `examples/terminal-agent/` | `terminal_agent` |
| `offload` | `examples/market-research/` | `market_research` |
| `local-large` | `examples/large-build-test/` | `large_build_test` |

Each example directory contains the three files produced from the templates
(`scenario-spec.yaml`, `flow.md`, and the task brief) so you can compare the
template slots against working, shipped scenarios in the repo.
