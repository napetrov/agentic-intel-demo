"""Validate the optional-secret semantics of `verify-operator-secrets.sh`.

The script's hard contract for `github-token` is:

* Secret missing + `REQUIRE_GH_TOKEN=0` (default) → `[warn]`, exit 0
  → agents will run without GitHub credentials, that's allowed.
* Secret missing + `REQUIRE_GH_TOKEN=1` (or `GH_TOKEN` exported) →
  `[FAIL]`, exit 1
  → on stands where GitHub access is mandatory, missing the mirror is
  a hard error.
* Secret present with `GH_TOKEN` key → `[ok]`, exit 0.
* Secret present, `GH_TOKEN` key missing → `[FAIL]`, exit 1.

We exercise these without a cluster by replacing `kubectl` with a tiny
Python shim that simulates Secret presence/absence based on env vars.
"""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "verify-operator-secrets.sh"

# Every Secret the script checks under SCOPE=system-a. The fake kubectl
# below only "knows about" the names listed here; anything else returns
# "not found" (exit 1), which is what production-`kubectl get secret`
# would do too.
FAKE_KUBECTL_TEMPLATE = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    \"\"\"Stand-in for `kubectl` used by tests/test_verify_secrets.py.

    Args we expect (from verify-operator-secrets.sh):
      kubectl -n <ns> get secret <name>                     (presence probe)
      kubectl -n <ns> get secret <name> -o jsonpath='{.data}' (keys probe)

    The "cluster state" lives in the FAKE_KUBECTL_STATE env var as a
    semicolon-separated list of <ns>/<name>=<keys-csv> entries:
      agents/github-token=GH_TOKEN
      default/intel-demo-operator-secrets=TELEGRAM_BOT_TOKEN,...

    Anything not in the list = "not found" (exit 1).
    \"\"\"
    import json
    import os
    import sys

    state = {}
    for entry in (os.environ.get("FAKE_KUBECTL_STATE") or "").split(";"):
        entry = entry.strip()
        if not entry:
            continue
        ref, _, keys_csv = entry.partition("=")
        ns, _, name = ref.partition("/")
        keys = [k for k in keys_csv.split(",") if k]
        state[(ns, name)] = keys

    argv = sys.argv[1:]
    # Trim leading "--context X" pairs harmlessly if the caller adds them
    # (the test sets KUBECTL to just our shim, but be defensive).
    while argv and argv[0] == "--context":
        argv = argv[2:]

    # Expect: -n <ns> get secret <name> [extra ...]
    if len(argv) < 5 or argv[0] != "-n" or argv[2] != "get" or argv[3] != "secret":
        sys.stderr.write(f"fake-kubectl: unexpected args: {argv}\\n")
        sys.exit(2)
    ns = argv[1]
    name = argv[4]
    rest = argv[5:]

    keys = state.get((ns, name))
    if keys is None:
        sys.stderr.write(f"Error from server (NotFound): secrets \\"{name}\\" not found\\n")
        sys.exit(1)

    if rest and rest[0].startswith("-o"):
        # `-o jsonpath='{.data}'` form — emit a JSON object whose keys
        # are the secret's data keys (values are dummy base64 blobs;
        # the verify script only reads the key set).
        print(json.dumps({k: "dGVzdA==" for k in keys}))
    sys.exit(0)
    """
)


@pytest.fixture(scope="module")
def fake_kubectl(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Materialize the fake kubectl shim as an executable file. We use
    a real file (not in-process patching) because the script under
    test invokes kubectl as a subprocess.
    """
    path = tmp_path_factory.mktemp("fake-kubectl") / "kubectl"
    path.write_text(FAKE_KUBECTL_TEMPLATE)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return path


def _run_verify(
    fake_kubectl: Path,
    state: dict[tuple[str, str], list[str]],
    *,
    require_gh_token: bool = False,
    gh_token_in_env: bool = False,
) -> subprocess.CompletedProcess[str]:
    state_str = ";".join(
        f"{ns}/{name}={','.join(keys)}" for (ns, name), keys in state.items()
    )
    env = os.environ.copy()
    env["SCOPE"] = "system-a"
    env["SYSTEM_A_KUBECTL"] = str(fake_kubectl)
    # Don't probe System B in these tests — the script ALSO requires
    # SYSTEM_B_KUBECTL to be on PATH at startup, but only when SCOPE
    # touches system-b. SCOPE=system-a skips that probe.
    env["FAKE_KUBECTL_STATE"] = state_str
    if require_gh_token:
        env["REQUIRE_GH_TOKEN"] = "1"
    else:
        env.pop("REQUIRE_GH_TOKEN", None)
    if gh_token_in_env:
        env["GH_TOKEN"] = "ghp_test"
    else:
        env.pop("GH_TOKEN", None)
    return subprocess.run(
        ["bash", str(SCRIPT)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


# Common "all required Secrets present" baseline. We override
# `agents/github-token` per test.
BASELINE_STATE = {
    ("default", "intel-demo-operator-secrets"): [
        "TELEGRAM_BOT_TOKEN",
        "AWS_BEARER_TOKEN_BEDROCK",
        "SAMBANOVA_API_KEY",
        "MINIO_ACCESS_KEY",
        "MINIO_SECRET_KEY",
    ],
    ("inference", "litellm-secrets"): [
        "AWS_BEARER_TOKEN_BEDROCK",
        "SAMBANOVA_API_KEY",
    ],
    ("agents", "session-pod-artifact-creds"): [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ],
    ("agents", "telegram-bot"): ["TELEGRAM_BOT_TOKEN"],
    ("agents", "bedrock-creds"): ["AWS_BEARER_TOKEN_BEDROCK"],
}


def test_github_token_missing_and_optional_warns_but_passes(
    fake_kubectl: Path,
) -> None:
    """REQUIRE_GH_TOKEN=0 (default) + missing Secret = `[warn]`, exit 0.
    This is the normal "no GitHub access wired" stand state and it
    must NOT fail verification.
    """
    proc = _run_verify(fake_kubectl, dict(BASELINE_STATE), require_gh_token=False)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "[warn]" in proc.stdout
    assert "secret/github-token in ns/agents not present" in proc.stdout
    # Crucially, it must NOT be reported as a FAIL.
    assert "secret/github-token in ns/agents MISSING" not in proc.stdout
    assert "all required Secrets present" in proc.stdout


def test_github_token_missing_with_require_flag_fails(fake_kubectl: Path) -> None:
    """REQUIRE_GH_TOKEN=1 upgrades the warn to a hard FAIL — required
    on stands where agents push to GitHub and the demo is broken
    without a token.
    """
    proc = _run_verify(fake_kubectl, dict(BASELINE_STATE), require_gh_token=True)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "[FAIL]" in proc.stdout
    assert "REQUIRE_GH_TOKEN=1" in proc.stdout
    assert "secret/github-token in ns/agents MISSING" in proc.stdout


def test_github_token_missing_with_gh_token_exported_fails(fake_kubectl: Path) -> None:
    """Exporting `GH_TOKEN` should auto-imply `REQUIRE_GH_TOKEN=1`.
    Rationale: if you bothered to export the var to wire it, missing
    the mirror is almost certainly a bug worth surfacing as a FAIL.
    """
    proc = _run_verify(
        fake_kubectl, dict(BASELINE_STATE), gh_token_in_env=True
    )
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "[FAIL]" in proc.stdout
    assert "secret/github-token in ns/agents MISSING" in proc.stdout


def test_github_token_present_with_correct_key_passes(fake_kubectl: Path) -> None:
    """Happy path: github-token Secret exists with key GH_TOKEN. The
    verify script must report `[ok]` and exit 0.
    """
    state = dict(BASELINE_STATE)
    state[("agents", "github-token")] = ["GH_TOKEN"]
    proc = _run_verify(fake_kubectl, state, require_gh_token=False)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "[ok]    ns/agents secret/github-token has all required keys: GH_TOKEN" in proc.stdout
    # "all required Secrets present." appears only on a clean run.
    assert "all required Secrets present" in proc.stdout


def test_github_token_present_with_wrong_key_fails(fake_kubectl: Path) -> None:
    """Defensive: if someone creates `agents/github-token` with the
    wrong data key (e.g. `GITHUB_TOKEN` instead of `GH_TOKEN`), the
    verify script must FAIL — the session pod's secretKeyRef hard-codes
    `key: GH_TOKEN` and would otherwise mount nothing.
    """
    state = dict(BASELINE_STATE)
    state[("agents", "github-token")] = ["WRONG_KEY"]
    proc = _run_verify(fake_kubectl, state)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "MISSING keys: GH_TOKEN" in proc.stdout
