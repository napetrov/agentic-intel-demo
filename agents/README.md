# Agents Layout

This directory is organized around two layers:

- `scenarios/` contains guided demo flows with explicit step-by-step operator behavior
- `tasks/` contains reusable task-family instructions used by guided scenarios and chat-mode routing

Use `orchestrator.md` as the top-level control surface.
Use `context-map.md` to resolve which scenario/task files apply.

To add a new scenario, use the templates and requirements under:
- `docs/scenario-spec.md` — required fields and acceptance checklist
- `docs/architecture-variants.md` — how the architecture shifts per execution mode
- `templates/scenarios/` — copy-and-fill templates plus worked examples for the three built-in scenarios

To adapt the demo to a different topology (single-node, multi-system, or a
different mix of token providers), start from:
- `docs/architecture-spec.md` — pluggable architecture requirements
- `templates/architecture/` — architecture template and worked examples

Run `python3 scripts/validate-demo-templates.py` to check that scenarios,
tasks, and architecture files are mutually consistent.
