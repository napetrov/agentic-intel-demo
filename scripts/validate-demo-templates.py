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

Exits non-zero on any failure; prints a per-file diagnostic. Relies only on
the Python standard library + PyYAML.
"""
from __future__ import annotations

import sys
import re
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

    scenarios_doc = load_yaml(scen_path) or {}
    tasks_doc = load_yaml(tasks_path) or {}
    scenarios = scenarios_doc.get("scenarios", {})
    task_families = set((tasks_doc.get("task_families") or {}).keys())
    scenario_ids = set(scenarios.keys())

    context_map = load_text(context_map_path) if context_map_path.exists() else ""
    orchestrator = load_text(orchestrator_path) if orchestrator_path.exists() else ""

    for sid, entry in scenarios.items():
        where = f"catalog/scenarios.yaml:{sid}"
        if not isinstance(entry, dict):
            report.add_error(f"{where}: entry must be a mapping")
            continue

        for required in ("label", "execution_mode", "task_family",
                         "initial_user_message", "allowed_next_actions",
                         "fallback_scenario"):
            if required not in entry:
                report.add_error(f"{where}: missing required field `{required}`")

        mode = entry.get("execution_mode")
        if mode and mode not in EXECUTION_MODES:
            report.add_error(f"{where}: invalid execution_mode `{mode}`")
        elif mode and mode not in supported_modes_union:
            report.add_error(
                f"{where}: execution_mode `{mode}` is not supported by any "
                f"shipped architecture example"
            )

        tf = entry.get("task_family")
        if tf and tf not in task_families:
            report.add_error(
                f"{where}: task_family `{tf}` not found in catalog/tasks.yaml"
            )

        fb = entry.get("fallback_scenario")
        if fb is not None and fb not in scenario_ids:
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
    allowed = TOPOLOGY_SUPPORTED_MODES.get(mode, set())
    for m in sem:
        if m not in EXECUTION_MODES:
            report.add_error(f"{where}: supported_execution_modes entry `{m}` is unknown")
        elif m not in allowed:
            report.add_error(
                f"{where}: supported_execution_modes entry `{m}` is not legal "
                f"for topology `{mode}`"
            )

    report.ok(f"{where}: architecture structure OK")
    return set(sem)


def main() -> int:
    report = Report()

    supported_modes_union: set[str] = set()
    for path in iter_architecture_files():
        supported_modes_union |= validate_architecture(report, path)

    validate_scenarios(report, supported_modes_union)

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
