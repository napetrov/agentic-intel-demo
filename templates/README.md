# Templates

Reusable starting files for demo authors.

| File / dir | Consumed by | Validated by |
|---|---|---|
| `result-summary.md` | the agent — `agents/orchestrator.md` enforces this shape on every scenario's final user-facing summary (objective, actions, state, evidence, blockers, next step). | not auto-validated; reviewed against scenario flows during PR |
| `tg-messages.md` | the orchestrator — canonical Telegram copy library (welcome, scenario openers, progress updates, completion, failure/fallback). | not auto-validated |
| `scenarios/` | demo authors adding a new guided scenario; the resulting `catalog/scenarios.yaml` entry + `agents/scenarios/<id>/` files are read at runtime by the orchestrator. | `python3 scripts/validate-demo-templates.py` (CI job `validate-templates`) — checks shape against `docs/scenario-spec.md` and cross-refs `catalog/tasks.yaml`, `agents/orchestrator.md`, and `config/operator-chat-config.template.json`. |
| `architecture/` | demo authors deploying on a non-default topology. **Spec-only** — no deploy script reads the filled-in file. See `templates/architecture/README.md` "Translating an architecture to actual manifests" for the hand-translation checklist. | `python3 scripts/validate-demo-templates.py` |

## Quick links

- New scenario → `templates/scenarios/README.md` + `docs/scenario-spec.md` + `docs/architecture-variants.md`.
- New architecture → `templates/architecture/README.md` + `docs/architecture-spec.md`.

Run `python3 scripts/validate-demo-templates.py` to check scenarios, tasks,
and architecture files for consistency. This script runs in CI as the
`validate-templates` job and is wired into `pre-commit run --all-files`.
