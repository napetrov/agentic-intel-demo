# Contributing to the Agentic Intel Demo

This repo ships a demo, not a product, so the contribution model is
deliberately small. The bar for a change is:

1. The change is needed to make the demo more reliable, more
   reproducible, or easier to extend.
2. The change passes the validators (`scripts/validate-demo-templates.py`)
   and the CI lint job.
3. The change is documented in the place a new contributor will look.

If your change is "let's add a flashy new feature that nobody will run
again after the demo," that's fine — but please time-box it and put it
behind a flag or a separate compose profile so the canonical path stays
boring and dependable.

## Local setup

Pick the tier that matches what you're touching:

- **Tier 0 (UI only).** `python3 -m http.server 8080 --directory web-demo`.
- **Tier 1 (full local stack).** `docker compose up --build` from the
  repo root, or `scripts/dev-up.sh` if container registries are blocked.
- **Tier 2 (operator + k8s).** Follow `docs/runbooks/tier2-bring-up.md`.

Pre-commit hooks mirror the blocking CI lint job:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

The validator is the most important check:

```bash
python3 scripts/validate-demo-templates.py
```

It cross-checks `catalog/scenarios.yaml`, `catalog/tasks.yaml`,
`agents/scenarios/<id>/`, the operator chat config, the LiteLLM router,
and the architecture templates. Run it before every commit that touches
any of those files.

## Adding a new scenario

`docs/scenario-spec.md` is the contract; this is the workflow.

1. Pick an existing scenario in `agents/scenarios/` whose architecture
   variant matches what you want, and copy the directory:
   ```bash
   cp -r agents/scenarios/terminal-agent agents/scenarios/<new-id>
   ```
2. Pick a `task_family` from `catalog/tasks.yaml` whose
   `default_execution` matches your scenario's `execution_mode`. If no
   existing family fits, add one to `catalog/tasks.yaml` first (see
   "Adding a new task family" below).
3. Add the scenario entry to `catalog/scenarios.yaml`. Use
   `templates/scenarios/scenario-spec.template.yaml` as the source of
   field names and slots. Required fields are listed in
   `docs/scenario-spec.md`.
4. Fill in `agents/scenarios/<new-id>/flow.md` and the bounded task
   brief. The `Required opening` line must echo `initial_user_message`
   from the catalog character-for-character — the validator enforces this.
5. Add the scenario to `agents/context-map.md` so the orchestrator
   knows which files to load.
6. Add the Telegram trigger to `agents/orchestrator.md` (callback
   `scenario:<id>` plus at least one natural-language phrase).
7. Update the operator chat config:
   `config/operator-chat-config.template.json`'s Telegram
   `systemPrompt` must mention `scenario:<id>` and echo the new
   `initial_user_message` verbatim. The validator enforces this too.
8. Run `python3 scripts/validate-demo-templates.py`. Iterate until green.
9. (Optional) Add fixture data under
   `agents/scenarios/<new-id>/fixtures/` and reference it via
   `fixtures_dir:` in the catalog entry, so the scenario can run
   without external network access.
10. (Optional) Annotate the catalog entry with the advisory fields
    `difficulty`, `estimated_duration_seconds`, `preferred_model_alias`.
    These do not affect routing but help operators pick a scenario for
    a given demo slot.

## Adding a new task family

`catalog/tasks.yaml` declares the families scenarios reference.

1. Add a top-level entry under `task_families:` with at least:
   - `default_execution`: one of `local_standard`, `local_large`,
     `offload_system_b`.
   - `alternate_execution`: list of additional execution modes the
     family supports (used by the routing policy in
     `docs/contracts/task-routing.md`).
   - `supported_in_chat_mode`: `true` if the family can run from the
     Telegram chat without a scenario card.
   - `capabilities`: free-form list of capability tags (advisory).
2. The family name is the YAML key — keep it `snake_case` and
   descriptive (`software_engineering`, not `se`).
3. Re-run the validator. It checks that every scenario's `task_family`
   resolves to a real family.

## Adding a new model alias

The LiteLLM router (`config/model-routing/litellm-config.yaml`, mirrored
into `k8s/system-a/litellm.yaml`) is the single source of truth for the
aliases (`fast`, `default`, `reasoning`, `sambanova`).

1. Add the entry to `config/model-routing/litellm-config.yaml` under
   `model_list:`. Use an existing entry as the template.
2. Mirror the same entry into `k8s/system-a/litellm.yaml`'s
   `litellm-config` ConfigMap. Both files must list the same aliases —
   the docker-compose path reads the first, the k8s path reads the second.
3. If you want the operator chat config to expose the new alias as a
   user-pickable model, add it under
   `config/operator-chat-config.template.json` →
   `models.providers.litellm.models[]`. The validator checks that every
   `id` here resolves to a real `model_name` in the router.
4. Add the alias to `config/versions.yaml` under `litellm_aliases:`
   (advisory documentation, not consumed at runtime).
5. Document the alias in `docs/api-reference.md` if it changes the
   model picker the UI surfaces.

## Adding a new agent tool (Tier 1 stub)

`runtimes/agent-stub/app.py` implements the agent surface used by the
local demo. To add a tool:

1. Add a `_tool_<name>(args)` function. Raise `ValueError` for bad input.
2. Add a branch to `_dispatch()` (`runtimes/agent-stub/app.py:116`).
3. If the tool should be reachable from the free-form `command` entry
   point, add a rule in `_classify_rules()` AND add the tool to the
   allow-lists referenced inside `_classify_llm()` so behaviour is
   identical with or without a configured LLM.
4. Add tests under `runtimes/agent-stub/tests/`.
5. Document the tool in `docs/agent-tool-reference.md`.

For the Tier 2 operator path, the tool registry lives in the operator
config (`examples/openclawinstance-intel-demo.yaml`); the Tier 1 stub is
intentionally a strict subset.

## Adding a new offload task type

The control plane forwards `POST /offload` payloads to the offload-worker;
the contract is in `docs/contracts/offload-result-contract.md`.

1. Add a handler in `runtimes/offload-worker/app.py` for the new
   `task_type` string.
2. Document the payload schema and result shape in
   `docs/contracts/offload-result-contract.md`.
3. Add tests under `runtimes/offload-worker/tests/`.
4. If a scenario needs the new task type, set
   `offload_task_type: <name>` in its catalog entry.

## CI gates

Pull requests must pass:

- `lint` — `pre-commit run --all-files`, `python3 -m yamllint .`,
  `python3 scripts/validate-demo-templates.py`, ruff on the runtime
  packages.
- `test` — `pytest` against `runtimes/control-plane/tests/`,
  `runtimes/offload-worker/tests/`, `runtimes/agent-stub/tests/`, plus
  the `web-demo/tests/` Playwright smoke job.
- `docker-build-check` — every `Dockerfile` under `runtimes/` and
  `web-demo/` builds.
- `compose-validate` — `docker compose config` succeeds for the base
  compose file and every overlay.

Heavier checks (kubeconform on `k8s/`, broken-link scan via lychee on
`docs/`) run in CI only — not in the local pre-commit hook.

## Documentation expectations

- Doc that explains a code contract lives next to the code, not as
  prose: `docs/api-reference.md` mirrors the FastAPI routes,
  `docs/agent-tool-reference.md` mirrors the tool dispatch table, etc.
- New runbooks go under `docs/runbooks/`. Keep them step-by-step —
  every command that has to run, with no implicit context.
- Validated-version data goes in `docs/versions-tested.md`. Add a row,
  do not edit existing rows; we want to be able to roll back.
- Old or superseded docs go to `docs/archive/`. Banner the original
  with `> Archived: see <new doc>`.
