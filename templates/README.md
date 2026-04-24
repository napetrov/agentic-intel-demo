# Templates

Reusable starting files for demo authors.

- `result-summary.md` — the required shape for every scenario's final
  user-facing summary (objective, actions, state, evidence, blockers, next
  step).
- `tg-messages.md` — canonical Telegram copy (welcome, scenario openers,
  progress updates, completion, failure/fallback).
- `scenarios/` — scenario authoring kit: copy-and-fill templates plus one
  worked example per architecture variant (`local-standard`, `local-large`,
  `offload`). Start here when adding a new demo scenario. See
  `docs/scenario-spec.md` for the requirements and acceptance checklist and
  `docs/architecture-variants.md` for how to pick the variant.
- `architecture/` — architecture authoring kit: copy-and-fill architecture
  template and worked examples for `single-node`, `two-system`,
  `multi-system`, and `cloud-provider-mix` topologies. Start here when
  deploying on a topology other than the shipped two-system reference or
  with a different mix of token providers. See `docs/architecture-spec.md`
  for the requirements.

Run `python3 scripts/validate-demo-templates.py` to check scenarios, tasks,
and architecture files for consistency. This script runs in CI as the
`validate-templates` job.
