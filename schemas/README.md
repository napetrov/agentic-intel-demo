# Demo schemas

JSON Schema (Draft 2020-12) for the demo's declarative inputs.

| Schema | Validates |
|---|---|
| `scenarios.schema.json` | `catalog/scenarios.yaml` |
| `tasks.schema.json` | `catalog/tasks.yaml` |
| `architecture.schema.json` | `templates/architecture/examples/*/architecture.yaml` |

Runs in CI under the `json-schema` job in `.github/workflows/lint.yml` via
[`check-jsonschema`](https://github.com/python-jsonschema/check-jsonschema).

These cover **shape** only (required keys, enums, types). Cross-config
checks — flow.md text alignment, operator-chat-config wiring, LiteLLM
alias resolution — live in `scripts/validate-demo-templates.py`.

To validate locally:

```sh
pip install check-jsonschema
check-jsonschema --schemafile schemas/scenarios.schema.json catalog/scenarios.yaml
check-jsonschema --schemafile schemas/tasks.schema.json     catalog/tasks.yaml
check-jsonschema --schemafile schemas/architecture.schema.json \
  templates/architecture/examples/*/architecture.yaml
```
