#!/usr/bin/env python3
"""Validate demo scenarios, tasks, and architecture templates.

Checks enforced:

Scenarios (catalog/scenarios.yaml):
- every required field per docs/scenario-spec.md is present and typed
- `execution_mode` is one of local_standard, local_large, offload_system_b
- `task_family` exists in catalog/tasks.yaml
- `fallback_scenario` is null or an existing scenario id
- the scenario's `execution_mode` is supported by at least one shipped
  architecture example
- `agents/scenarios/<id>/flow.md` exists and its "Required opening" echoes
  `initial_user_message` character-for-character
- each scenario is mentioned in agents/context-map.md and has a Telegram
  trigger (callback value) in agents/orchestrator.md

Architectures (templates/architecture/examples/*/architecture.yaml plus
any files under config/architectures/ if present):
- declares apiVersion demo.architecture/v1 and kind Architecture
- spec.topology.mode is valid and matches cluster count/role rules
- every components.*.location references a declared cluster
- every execution_backends[].location references a declared cluster with
  role execution or mixed
- every model_aliases entry resolves to a declared inference provider
- supported_execution_modes are legal for the topology

Cross-config consistency:
- operator-chat-config.template.json's Telegram systemPrompt mentions every
  scenario id as `scenario:<id>` and echoes its `initial_user_message`
  verbatim (catches "added a scenario but forgot to update the operator
  prompt and silently broke the Telegram menu")
- every customCommands[].command in the operator chat config is referenced
  as `/<command>` in agents/orchestrator.md
- every `litellm/<alias>` reference in the operator chat config + every
  `id` exposed under models.providers.litellm.models[] resolves to a real
  model_name in config/model-routing/litellm-config.yaml. The same check
  applies to examples/openclawinstance-intel-demo.yaml's embedded
  openclaw.json config.

Exits non-zero on any failure; prints a per-file diagnostic. Relies only on
the Python standard library + PyYAML.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
EXECUTION_MODES = {"local_standard", "local_large", "offload_system_b"}
TOPOLOGY_MODES = {"single_node", "two_system", "multi_system"}
CLUSTER_ROLES = {"orchestration", "execution", "mixed"}
TOPOLOGY_SUPPORTED_MODES: dict[str, set[str]] = {
    "single_node": {"local_standard", "local_large"},
    "two_system": {"local_standard", "local_large", "offload_system_b"},
    "multi_system": {"local_standard", "local_large", "offload_system_b"},
}


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    checked: list[str] = field(default_factory=list)

    def add_error(self, msg: str) -> None:
        self.errors.append(msg)

    def ok(self, msg: str) -> None:
        self.checked.append(msg)

    def failed(self) -> bool:
        return bool(self.errors)


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def validate_scenarios(report: Report, supported_modes_union: set[str]) -> None:
    scen_path = REPO_ROOT / "catalog" / "scenarios.yaml"
    tasks_path = REPO_ROOT / "catalog" / "tasks.yaml"
    context_map_path = REPO_ROOT / "agents" / "context-map.md"
    orchestrator_path = REPO_ROOT / "agents" / "orchestrator.md"

    try:
        scenarios_doc = load_yaml(scen_path) or {}
    except yaml.YAMLError as e:
        report.add_error(f"catalog/scenarios.yaml: YAML parse error: {e}")
        scenarios_doc = {}
    try:
        tasks_doc = load_yaml(tasks_path) or {}
    except yaml.YAMLError as e:
        report.add_error(f"catalog/tasks.yaml: YAML parse error: {e}")
        tasks_doc = {}
    if not isinstance(scenarios_doc, dict):
        report.add_error("catalog/scenarios.yaml: root must be a mapping")
        scenarios_doc = {}
    if not isinstance(tasks_doc, dict):
        report.add_error("catalog/tasks.yaml: root must be a mapping")
        tasks_doc = {}

    scenarios = scenarios_doc.get("scenarios") or {}
    if not isinstance(scenarios, dict):
        report.add_error("catalog/scenarios.yaml: `scenarios` must be a mapping")
        scenarios = {}
    task_families_block = tasks_doc.get("task_families") or {}
    if not isinstance(task_families_block, dict):
        report.add_error("catalog/tasks.yaml: `task_families` must be a mapping")
        task_families_block = {}
    task_families = set(task_families_block.keys())
    scenario_ids = set(scenarios.keys())

    context_map = load_text(context_map_path) if context_map_path.exists() else ""
    orchestrator = load_text(orchestrator_path) if orchestrator_path.exists() else ""

    for sid, entry in scenarios.items():
        where = f"catalog/scenarios.yaml:{sid}"
        if not isinstance(entry, dict):
            report.add_error(f"{where}: entry must be a mapping")
            continue

        required_str = ("label", "execution_mode", "task_family",
                        "initial_user_message")
        for required in (*required_str, "allowed_next_actions", "fallback_scenario"):
            if required not in entry:
                report.add_error(f"{where}: missing required field `{required}`")
        for field_name in required_str:
            val = entry.get(field_name)
            if val is not None and not isinstance(val, str):
                report.add_error(
                    f"{where}: `{field_name}` must be a string, got "
                    f"{type(val).__name__}"
                )
        ana = entry.get("allowed_next_actions")
        if ana is not None and not isinstance(ana, list):
            report.add_error(
                f"{where}: `allowed_next_actions` must be a list, got "
                f"{type(ana).__name__}"
            )

        mode = entry.get("execution_mode")
        if isinstance(mode, str):
            if mode not in EXECUTION_MODES:
                report.add_error(f"{where}: invalid execution_mode `{mode}`")
            elif mode not in supported_modes_union:
                report.add_error(
                    f"{where}: execution_mode `{mode}` is not supported by any "
                    f"shipped architecture example"
                )

        tf = entry.get("task_family")
        if isinstance(tf, str) and tf not in task_families:
            report.add_error(
                f"{where}: task_family `{tf}` not found in catalog/tasks.yaml"
            )

        fb = entry.get("fallback_scenario")
        if fb is not None and not isinstance(fb, str):
            report.add_error(
                f"{where}: `fallback_scenario` must be a string or null, got "
                f"{type(fb).__name__}"
            )
        elif isinstance(fb, str) and fb not in scenario_ids:
            report.add_error(
                f"{where}: fallback_scenario `{fb}` is not a known scenario id"
            )

        ack = entry.get("initial_user_message")
        flow_path = REPO_ROOT / "agents" / "scenarios" / sid.replace("_", "-") / "flow.md"
        # id->dir mapping in this repo: terminal_agent -> terminal-agent, etc.
        if not flow_path.exists():
            alt = REPO_ROOT / "agents" / "scenarios" / sid / "flow.md"
            if alt.exists():
                flow_path = alt
        if not flow_path.exists():
            report.add_error(
                f"{where}: expected agents/scenarios/<id>/flow.md to exist "
                f"(checked {flow_path.relative_to(REPO_ROOT)})"
            )
        else:
            flow = load_text(flow_path)
            if ack and ack not in flow:
                report.add_error(
                    f"{where}: `initial_user_message` not echoed verbatim in "
                    f"{flow_path.relative_to(REPO_ROOT)}"
                )
            report.ok(f"{where}: flow.md present and acknowledgement matches")

        if context_map:
            title_variants = {
                sid,
                sid.replace("_", "-"),
                sid.replace("_", " ").title(),
                entry.get("label") or "",
            }
            if not any(v and v in context_map for v in title_variants):
                report.add_error(
                    f"{where}: scenario not referenced in agents/context-map.md"
                )
        if orchestrator and f"scenario:{sid}" not in orchestrator:
            report.add_error(
                f"{where}: callback `scenario:{sid}` not found in "
                f"agents/orchestrator.md"
            )

        report.ok(f"{where}: required fields present")


def iter_architecture_files() -> Iterable[Path]:
    for p in (REPO_ROOT / "templates" / "architecture" / "examples").rglob("architecture.yaml"):
        yield p
    config_dir = REPO_ROOT / "config" / "architectures"
    if config_dir.exists():
        for p in config_dir.rglob("*.yaml"):
            yield p


def validate_architecture(report: Report, path: Path) -> set[str]:
    """Return the set of supported_execution_modes declared by this file."""
    where = str(path.relative_to(REPO_ROOT))
    try:
        doc = load_yaml(path) or {}
    except yaml.YAMLError as e:
        report.add_error(f"{where}: YAML parse error: {e}")
        return set()
    if not isinstance(doc, dict):
        report.add_error(
            f"{where}: root document must be a mapping, got "
            f"{type(doc).__name__}"
        )
        return set()

    if doc.get("apiVersion") != "demo.architecture/v1":
        report.add_error(
            f"{where}: apiVersion must be `demo.architecture/v1`"
        )
    if doc.get("kind") != "Architecture":
        report.add_error(f"{where}: kind must be `Architecture`")

    name = (doc.get("metadata") or {}).get("name")
    if not name or not isinstance(name, str):
        report.add_error(f"{where}: metadata.name is required")

    spec = doc.get("spec") or {}
    topo = spec.get("topology") or {}
    mode = topo.get("mode")
    if mode not in TOPOLOGY_MODES:
        report.add_error(
            f"{where}: spec.topology.mode must be one of {sorted(TOPOLOGY_MODES)}"
        )
    clusters = topo.get("clusters") or []
    cluster_names: dict[str, str] = {}
    for i, c in enumerate(clusters):
        if not isinstance(c, dict):
            report.add_error(f"{where}: spec.topology.clusters[{i}] must be a mapping")
            continue
        cn = c.get("name")
        cr = c.get("role")
        if not cn:
            report.add_error(f"{where}: spec.topology.clusters[{i}].name is required")
        if cr not in CLUSTER_ROLES:
            report.add_error(
                f"{where}: spec.topology.clusters[{i}].role must be one of "
                f"{sorted(CLUSTER_ROLES)}"
            )
        if cn:
            cluster_names[cn] = cr or ""

    if mode == "single_node" and len(clusters) != 1:
        report.add_error(f"{where}: single_node topology must declare exactly 1 cluster")
    if mode == "two_system" and len(clusters) != 2:
        report.add_error(f"{where}: two_system topology must declare exactly 2 clusters")
    if mode == "multi_system" and len(clusters) < 2:
        report.add_error(f"{where}: multi_system topology must declare >= 2 clusters")

    components = spec.get("components") or {}

    def check_location(label: str, value: str | None) -> None:
        if value is None:
            return
        if value not in cluster_names:
            report.add_error(
                f"{where}: {label} location `{value}` not declared in "
                f"spec.topology.clusters[]"
            )

    for role in ("orchestrator", "model_router"):
        block = components.get(role)
        if not isinstance(block, dict):
            report.add_error(f"{where}: spec.components.{role} is required")
            continue
        if "type" not in block:
            report.add_error(f"{where}: spec.components.{role}.type is required")
        check_location(f"spec.components.{role}.location", block.get("location"))

    providers = components.get("inference_providers") or []
    if not providers:
        report.add_error(
            f"{where}: spec.components.inference_providers[] must declare at "
            f"least one provider"
        )
    provider_names: set[str] = set()
    for i, p in enumerate(providers):
        if not isinstance(p, dict):
            report.add_error(f"{where}: inference_providers[{i}] must be a mapping")
            continue
        for key in ("name", "type", "model"):
            if key not in p:
                report.add_error(f"{where}: inference_providers[{i}].{key} is required")
        provider_names.add(p.get("name"))
        if p.get("type") in {"vllm", "ollama"}:
            check_location(f"inference_providers[{i}].location", p.get("location"))

    backends = components.get("execution_backends") or []
    for i, b in enumerate(backends):
        if not isinstance(b, dict):
            report.add_error(f"{where}: execution_backends[{i}] must be a mapping")
            continue
        loc = b.get("location")
        check_location(f"execution_backends[{i}].location", loc)
        if loc and cluster_names.get(loc) not in {"execution", "mixed"}:
            report.add_error(
                f"{where}: execution_backends[{i}].location `{loc}` must reference "
                f"a cluster with role `execution` or `mixed`"
            )

    artifact = components.get("artifact_store")
    if isinstance(artifact, dict):
        check_location("artifact_store.location", artifact.get("location"))

    aliases = spec.get("model_aliases") or {}
    for alias, target in aliases.items():
        if target not in provider_names:
            report.add_error(
                f"{where}: model_aliases.{alias} -> `{target}` not found in "
                f"inference_providers[]"
            )

    sem = spec.get("supported_execution_modes") or []
    if not isinstance(sem, list):
        report.add_error(
            f"{where}: spec.supported_execution_modes must be a list"
        )
        sem = []
    normalized_sem: set[str] = set()
    allowed = TOPOLOGY_SUPPORTED_MODES.get(mode, set())
    for m in sem:
        if not isinstance(m, str):
            report.add_error(
                f"{where}: supported_execution_modes entries must be strings, "
                f"got {type(m).__name__}"
            )
            continue
        normalized_sem.add(m)
        if m not in EXECUTION_MODES:
            report.add_error(f"{where}: supported_execution_modes entry `{m}` is unknown")
        elif m not in allowed:
            report.add_error(
                f"{where}: supported_execution_modes entry `{m}` is not legal "
                f"for topology `{mode}`"
            )

    report.ok(f"{where}: architecture structure OK")
    return normalized_sem


def _load_litellm_aliases(report: Report) -> set[str]:
    """Return the set of model_name aliases declared in the LiteLLM router."""
    path = REPO_ROOT / "config" / "model-routing" / "litellm-config.yaml"
    where = str(path.relative_to(REPO_ROOT))
    if not path.exists():
        report.add_error(f"{where}: missing — required for LiteLLM alias checks")
        return set()
    try:
        doc = load_yaml(path) or {}
    except yaml.YAMLError as e:
        report.add_error(f"{where}: YAML parse error: {e}")
        return set()
    model_list = doc.get("model_list") or []
    if not isinstance(model_list, list):
        report.add_error(f"{where}: model_list must be a list")
        return set()
    aliases: set[str] = set()
    for i, entry in enumerate(model_list):
        if not isinstance(entry, dict):
            report.add_error(f"{where}: model_list[{i}] must be a mapping")
            continue
        name = entry.get("model_name")
        if not isinstance(name, str):
            report.add_error(f"{where}: model_list[{i}].model_name missing")
            continue
        aliases.add(name)
    return aliases


def _check_chat_config_object(
    report: Report,
    where: str,
    cfg: dict,
    scenarios: dict[str, dict],
    orchestrator_text: str,
    litellm_aliases: set[str],
    require_system_prompt: bool = False,
) -> None:
    """Validate one parsed operator chat config object (JSON-shaped).

    Used for both config/operator-chat-config.template.json and the
    embedded openclaw.json string inside
    examples/openclawinstance-intel-demo.yaml — they share the same shape.

    When `require_system_prompt` is true, the absence of any
    `channels.telegram.groups.*.systemPrompt` is itself an error: the
    demo menu / acknowledgement enforcement lives inside that prompt,
    so deleting it would silently turn off the cross-config check.
    """
    if not isinstance(cfg, dict):
        report.add_error(f"{where}: chat config root must be a mapping")
        return

    # ---- Telegram systemPrompt ↔ catalog/scenarios.yaml ----
    telegram = ((cfg.get("channels") or {}).get("telegram") or {})
    groups = telegram.get("groups") or {}
    system_prompts: list[tuple[str, str]] = []
    if isinstance(groups, dict):
        for gid, gentry in groups.items():
            if isinstance(gentry, dict):
                sp = gentry.get("systemPrompt")
                if isinstance(sp, str):
                    system_prompts.append((str(gid), sp))

    if require_system_prompt and not system_prompts:
        report.add_error(
            f"{where}: no channels.telegram.groups.*.systemPrompt found — "
            f"the demo menu and acknowledgement contract live inside that "
            f"prompt, removing it disables the scenario cross-config check"
        )

    # Embedded configs (e.g. examples/openclawinstance-intel-demo.yaml)
    # don't carry a systemPrompt — that's fine, the operator chat-config
    # template is the single canonical place for it. But if any prompt
    # exists, it must mention every scenario.
    if scenarios and system_prompts:
        section_errors = 0
        for sid, entry in scenarios.items():
            callback = f"scenario:{sid}"
            ack = entry.get("initial_user_message")
            for gid, sp in system_prompts:
                missing: list[str] = []
                if callback not in sp:
                    missing.append(f"callback `{callback}`")
                if isinstance(ack, str) and ack and ack not in sp:
                    missing.append(f"initial_user_message `{ack}`")
                if missing:
                    report.add_error(
                        f"{where}: Telegram group `{gid}` systemPrompt is "
                        f"missing {', '.join(missing)} for scenario `{sid}`"
                    )
                    section_errors += 1
        if section_errors == 0:
            report.ok(f"{where}: Telegram systemPrompt covers all scenarios")

    # ---- customCommands ↔ orchestrator.md ----
    custom_commands = telegram.get("customCommands") or []
    if isinstance(custom_commands, list) and orchestrator_text:
        section_errors = 0
        for i, cc in enumerate(custom_commands):
            if not isinstance(cc, dict):
                report.add_error(
                    f"{where}: channels.telegram.customCommands[{i}] must be a mapping"
                )
                section_errors += 1
                continue
            cmd = cc.get("command")
            if not isinstance(cmd, str) or not cmd:
                report.add_error(
                    f"{where}: customCommands[{i}].command is required"
                )
                section_errors += 1
                continue
            # Match `/<cmd>` as a whole token in orchestrator.md.
            pattern = re.compile(rf"(^|\s|`)/{re.escape(cmd)}(\b|`|$)")
            if not pattern.search(orchestrator_text):
                report.add_error(
                    f"{where}: customCommands[{i}].command `/{cmd}` not "
                    f"referenced in agents/orchestrator.md"
                )
                section_errors += 1
        if custom_commands and section_errors == 0:
            report.ok(f"{where}: customCommands all referenced in orchestrator.md")

    # ---- litellm/<alias> references ↔ litellm-config.yaml ----
    if litellm_aliases:
        section_errors = 0
        # Walk every model.primary / model.fallbacks under agents.{defaults,list[]}.
        agents_block = cfg.get("agents") or {}
        targets: list[tuple[str, str]] = []  # (where_label, model_ref)

        def collect(label: str, model_obj):
            if not isinstance(model_obj, dict):
                return
            primary = model_obj.get("primary")
            if isinstance(primary, str):
                targets.append((f"{label}.primary", primary))
            for j, fb in enumerate(model_obj.get("fallbacks") or []):
                if isinstance(fb, str):
                    targets.append((f"{label}.fallbacks[{j}]", fb))

        defaults_model = (agents_block.get("defaults") or {}).get("model")
        collect("agents.defaults.model", defaults_model)
        for i, agent in enumerate(agents_block.get("list") or []):
            if isinstance(agent, dict):
                collect(f"agents.list[{i}].model", agent.get("model"))

        for label, ref in targets:
            if not ref.startswith("litellm/"):
                continue
            alias = ref.split("/", 1)[1]
            if alias not in litellm_aliases:
                report.add_error(
                    f"{where}: {label} `{ref}` references unknown LiteLLM alias "
                    f"`{alias}` (declared aliases: "
                    f"{sorted(litellm_aliases)})"
                )
                section_errors += 1

        # Also check models.providers.litellm.models[].id — these are
        # the IDs the chat surface advertises to the user; each must
        # resolve to a real router alias.
        litellm_provider = (
            (cfg.get("models") or {}).get("providers") or {}
        ).get("litellm")
        if isinstance(litellm_provider, dict):
            for i, m in enumerate(litellm_provider.get("models") or []):
                if not isinstance(m, dict):
                    continue
                mid = m.get("id")
                if isinstance(mid, str) and mid not in litellm_aliases:
                    report.add_error(
                        f"{where}: models.providers.litellm.models[{i}].id "
                        f"`{mid}` not declared in "
                        f"config/model-routing/litellm-config.yaml::model_list"
                    )
                    section_errors += 1
        if section_errors == 0:
            report.ok(f"{where}: LiteLLM alias references resolve")


def validate_chat_configs(report: Report) -> None:
    """Cross-check operator chat configs against catalog + router + orchestrator."""
    # Reload scenarios once for the chat-config checks. validate_scenarios()
    # is already running its own pass; we only need the (id, ack) map here.
    scen_path = REPO_ROOT / "catalog" / "scenarios.yaml"
    try:
        scen_doc = load_yaml(scen_path) or {}
    except (FileNotFoundError, yaml.YAMLError):
        scen_doc = {}
    scenarios = (scen_doc.get("scenarios") or {}) if isinstance(scen_doc, dict) else {}
    if not isinstance(scenarios, dict):
        scenarios = {}

    orchestrator_path = REPO_ROOT / "agents" / "orchestrator.md"
    orchestrator_text = (
        load_text(orchestrator_path) if orchestrator_path.exists() else ""
    )

    litellm_aliases = _load_litellm_aliases(report)

    # 1) Standalone operator chat config template.
    chat_path = REPO_ROOT / "config" / "operator-chat-config.template.json"
    if chat_path.exists():
        where = str(chat_path.relative_to(REPO_ROOT))
        try:
            cfg = json.loads(chat_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            report.add_error(f"{where}: JSON parse error: {e}")
        else:
            # The standalone template is the canonical source of the demo
            # systemPrompt — require it explicitly so that deleting the
            # prompt fails validation instead of silently turning the
            # scenario check off.
            _check_chat_config_object(
                report, where, cfg, scenarios, orchestrator_text, litellm_aliases,
                require_system_prompt=True,
            )

    # 2) Embedded openclaw.json inside the OpenClawInstance example.
    inst_path = REPO_ROOT / "examples" / "openclawinstance-intel-demo.yaml"
    if inst_path.exists():
        where = f"{inst_path.relative_to(REPO_ROOT)} (spec.config.openclaw.json)"
        try:
            inst = load_yaml(inst_path) or {}
        except yaml.YAMLError as e:
            report.add_error(f"{inst_path.relative_to(REPO_ROOT)}: YAML parse error: {e}")
            inst = {}
        if not isinstance(inst, dict):
            report.add_error(
                f"{inst_path.relative_to(REPO_ROOT)}: root must be a mapping, "
                f"got {type(inst).__name__}"
            )
        else:
            embedded = ((inst.get("spec") or {}).get("config") or {}).get("openclaw.json")
            if isinstance(embedded, str) and embedded.strip():
                try:
                    cfg = json.loads(embedded)
                except json.JSONDecodeError as e:
                    report.add_error(f"{where}: embedded JSON parse error: {e}")
                else:
                    _check_chat_config_object(
                        report, where, cfg, scenarios, orchestrator_text, litellm_aliases
                    )


def main() -> int:
    report = Report()

    supported_modes_union: set[str] = set()
    for path in iter_architecture_files():
        supported_modes_union |= validate_architecture(report, path)

    validate_scenarios(report, supported_modes_union)
    validate_chat_configs(report)

    for note in report.checked:
        print(f"OK  {note}")
    for err in report.errors:
        print(f"ERR {err}", file=sys.stderr)

    if report.failed():
        print(f"\n{len(report.errors)} problem(s) found", file=sys.stderr)
        return 1
    print(f"\n{len(report.checked)} check(s) passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
