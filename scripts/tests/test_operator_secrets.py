"""Validate the GH_TOKEN passthrough wiring end-to-end.

These tests do NOT need a real cluster. They run
`scripts/create-operator-secrets.sh` in dry-run mode against a fake
`kubectl` shim that just echoes its arguments, and they parse the
related YAML files directly. The goal is to lock in three contracts:

1. With `GH_TOKEN` set, the script emits a `github-token` Secret block
   in namespace `agents` and includes the key in the operator instance
   Secret render.
2. With `GH_TOKEN` unset, the script does NOT emit `github-token` AND
   prints the "would delete (revoke-by-omission)" guidance — this is
   what stops a stale PAT from staying live after un-exporting the
   variable on a re-run.
3. The session-pod template exposes the value under both `GH_TOKEN`
   AND `GITHUB_TOKEN`, and both refs are `optional: true` so the pod
   still boots when no token is wired.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "create-operator-secrets.sh"
TEMPLATE = REPO_ROOT / "k8s" / "shared" / "intel-demo-operator-secrets.yaml.template"
SESSION_POD_TEMPLATE = REPO_ROOT / "k8s" / "system-a" / "session-pod-template.yaml"

# Fake kubectl that just echoes its argv. Lets us assert what the
# script *would* do without requiring a real cluster. Process
# substitution (`--from-env-file=<(printf ...)`) means the actual key
# values land in /dev/fd/N; the echoed args don't carry them, but that
# isn't what we're verifying here — we check that the right Secret
# blocks are emitted at all, not that kubectl received the right bytes.
FAKE_KUBECTL = "echo kubectl"


def _run_script(env_overrides: dict[str, str]) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        {
            "SCOPE": "system-a",
            "APPLY": "0",
            "KUBECTL": FAKE_KUBECTL,
            # Required keys — values are arbitrary because the fake
            # kubectl never actually reads them.
            "TELEGRAM_BOT_TOKEN": "tt",
            "AWS_BEARER_TOKEN_BEDROCK": "tb",
            "SAMBANOVA_API_KEY": "sk",
            "MINIO_ACCESS_KEY": "ma",
            "MINIO_SECRET_KEY": "ms",
        }
    )
    env.update(env_overrides)
    # Ensure GH_TOKEN is genuinely unset for the "unset" case rather
    # than carrying through from the parent shell.
    if "GH_TOKEN" in env_overrides and env_overrides["GH_TOKEN"] == "":
        env.pop("GH_TOKEN", None)
    elif "GH_TOKEN" not in env_overrides:
        env.pop("GH_TOKEN", None)
    return subprocess.run(
        ["bash", str(SCRIPT)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture(scope="module")
def script_exists() -> None:
    assert SCRIPT.is_file(), f"missing script: {SCRIPT}"
    assert TEMPLATE.is_file(), f"missing template: {TEMPLATE}"
    assert SESSION_POD_TEMPLATE.is_file(), f"missing pod template: {SESSION_POD_TEMPLATE}"
    assert shutil.which("bash") is not None, "bash not on PATH"


def test_dry_run_with_gh_token_emits_github_secret(script_exists: None) -> None:
    """`GH_TOKEN=ghp_test` makes the script render the `github-token`
    Secret in namespace `agents`. Without this block the session pod's
    `secretKeyRef` would have no source and pods would boot credential-less.
    """
    proc = _run_script({"GH_TOKEN": "ghp_test_value"})
    assert proc.returncode == 0, proc.stderr
    out = proc.stdout

    # The block that emit() prints in dry-run mode.
    assert "[github token (session pod)] github-token in agents" in out

    # The actual kubectl command that would create it. We don't see
    # the env-file body (it's behind /dev/fd/N), but we DO see the
    # namespace + name in the args, which is enough to prove the
    # script is targeting the right Secret.
    assert re.search(
        r"kubectl create secret generic github-token --namespace=agents",
        out,
    ), "expected `kubectl create secret generic github-token --namespace=agents` in output"

    # The unset-path "revoke" guidance must NOT appear when wiring.
    assert "would delete secret/github-token" not in out, (
        "revoke-by-omission notice should only fire on the unset path"
    )


def test_dry_run_without_gh_token_skips_creation_and_warns_revoke(
    script_exists: None,
) -> None:
    """When `GH_TOKEN` is unset the script must (a) NOT render the
    `github-token` Secret and (b) print the "would delete … if present"
    notice. (b) is what stops a stale PAT from staying live after a
    user un-exports the variable and re-runs the script.
    """
    proc = _run_script({"GH_TOKEN": ""})
    assert proc.returncode == 0, proc.stderr
    out = proc.stdout

    # The github-token emit block must NOT appear — that's what skipping looks like.
    assert "[github token (session pod)] github-token in agents" not in out
    assert (
        "kubectl create secret generic github-token --namespace=agents"
        not in out
    ), "github-token Secret must not be emitted when GH_TOKEN is unset"

    # The revoke notice must appear in dry-run form.
    assert "would delete secret/github-token in ns/agents if present" in out, (
        "expected dry-run notice for the revoke-by-omission path"
    )
    # And the canonical "re-run with GH_TOKEN" instruction must follow,
    # so operators know how to re-wire after a deliberate revoke.
    assert "Re-run with GH_TOKEN=" in out


def test_dry_run_required_keys_unaffected_by_gh_token(script_exists: None) -> None:
    """The other secret blocks (telegram-bot, bedrock-creds,
    session-pod-artifact-creds, litellm-secrets, intel-demo-operator-secrets)
    must always be emitted regardless of whether GH_TOKEN is set.
    Otherwise a typo on GH_TOKEN could silently disable telegram or
    bedrock wiring.
    """
    for env in ({"GH_TOKEN": "ghp_test"}, {"GH_TOKEN": ""}):
        proc = _run_script(env)
        assert proc.returncode == 0, proc.stderr
        out = proc.stdout
        for required_block in (
            "[operator instance secrets] intel-demo-operator-secrets in default",
            "[litellm secrets] litellm-secrets in inference",
            "[session-pod artifact creds] session-pod-artifact-creds in agents",
            "[telegram bot token] telegram-bot in agents",
            "[bedrock bearer token (session pod)] bedrock-creds in agents",
        ):
            assert required_block in out, (
                f"required block missing for env={env}: {required_block}"
            )


def test_secrets_template_has_optional_gh_token_key(script_exists: None) -> None:
    """The shipped Secret template must expose `GH_TOKEN` as a
    placeholder so users editing the YAML directly see it as a
    first-class slot. Without it, manual-`kubectl apply` operators would
    have to know to add the key, which is exactly the path the
    operator-install doc warns is incomplete.
    """
    docs = list(yaml.safe_load_all(TEMPLATE.read_text()))
    secret = next(d for d in docs if d.get("kind") == "Secret")
    assert secret["metadata"]["name"] == "intel-demo-operator-secrets"
    assert "GH_TOKEN" in secret["stringData"], (
        "GH_TOKEN placeholder missing from the shipped Secret template"
    )


def _session_pod_spec() -> dict:
    """Pull the embedded pod manifest out of the
    `session-pod-template` ConfigMap.
    """
    docs = list(yaml.safe_load_all(SESSION_POD_TEMPLATE.read_text()))
    cm = next(
        d
        for d in docs
        if d.get("kind") == "ConfigMap"
        and d.get("metadata", {}).get("name") == "session-pod-template"
    )
    pod = yaml.safe_load(cm["data"]["pod.yaml"])
    assert pod["kind"] == "Pod"
    return pod


def test_session_pod_exposes_gh_token_and_github_token_optional(
    script_exists: None,
) -> None:
    """Both `GH_TOKEN` and `GITHUB_TOKEN` must be exposed via
    secretKeyRef on `github-token`/`GH_TOKEN` with `optional: true`.

    `optional: true` is what lets the pod boot when the operator owner
    hasn't wired a token yet — without it the pod gets stuck in
    `CreateContainerConfigError` and the demo can't run at all.
    """
    pod = _session_pod_spec()
    container = pod["spec"]["containers"][0]
    env_by_name = {e["name"]: e for e in container["env"]}

    for var_name in ("GH_TOKEN", "GITHUB_TOKEN"):
        assert var_name in env_by_name, (
            f"session-pod is missing env var {var_name} — agents won't see GitHub creds"
        )
        ref = env_by_name[var_name]["valueFrom"]["secretKeyRef"]
        assert ref["name"] == "github-token", (
            f"{var_name} must read from secret/github-token in ns/agents, got {ref}"
        )
        assert ref["key"] == "GH_TOKEN", (
            f"{var_name} must read .data.GH_TOKEN (the canonical mirror key), got {ref}"
        )
        assert ref.get("optional") is True, (
            f"{var_name} secretKeyRef must be `optional: true` so the pod still boots when no token is wired"
        )


def test_openclawinstance_documents_envfromsecrets_passthrough(
    script_exists: None,
) -> None:
    """The example OpenClawInstance must reference
    `intel-demo-operator-secrets` via `envFromSecrets`. That envelope is
    how `GH_TOKEN` reaches the gateway pod (and any other key in the
    Secret); if the binding gets dropped, the `GH_TOKEN` flow described
    in the runbook quietly stops working.
    """
    instance_path = REPO_ROOT / "examples" / "openclawinstance-intel-demo.yaml"
    instance = yaml.safe_load(instance_path.read_text())
    refs = instance["spec"]["envFromSecrets"]
    names = [r["name"] for r in refs]
    assert "intel-demo-operator-secrets" in names, (
        f"OpenClawInstance must envFromSecrets `intel-demo-operator-secrets` "
        f"so envFromSecrets-delivered GH_TOKEN reaches the runtime; got {names}"
    )


# -----------------------------------------------------------------------
# Sanity check that the test-side fixtures reflect the real shipped
# script — if someone removes the GH_TOKEN handling block we want
# CI to fail with a meaningful error rather than silently passing the
# above tests because they only check stdout strings.
# -----------------------------------------------------------------------


def test_script_handles_gh_token_branch_explicitly(script_exists: None) -> None:
    """Defense-in-depth: the script must contain both the wire-on-set
    branch and the revoke-on-unset branch. If either disappears, this
    test catches the regression even before the dry-run tests run.
    """
    body = SCRIPT.read_text()
    assert 'GH_TOKEN=$GH_TOKEN' in body, "wire-on-set branch missing"
    # The "would delete" string only exists in the dry-run revoke path.
    assert "would delete secret/$GITHUB_SECRET_NAME" in body, (
        "dry-run revoke notice missing — the unset branch is incomplete"
    )
    # The apply-mode delete must also be present, otherwise APPLY=1
    # operators wouldn't actually revoke.
    assert "delete secret \"$GITHUB_SECRET_NAME\"" in body, (
        "apply-mode delete missing — stale PATs would survive un-exporting GH_TOKEN"
    )
