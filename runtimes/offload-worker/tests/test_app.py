"""Smoke tests for the offload-worker API.

Small payloads only so the S3/MinIO put_object path is not exercised. That keeps
the test self-contained — no moto, no local MinIO. Environment variables
(MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY) are consumed by app.py at
import time but boto3 creates the client lazily, so any non-empty values work.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MINIO_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "dummy")
os.environ.setdefault("MINIO_SECRET_KEY", "dummy")
# Point the shell-task allow-list at the repo's real scenario scripts so the
# tests exercise the same paths compose mounts at /scenarios.
REPO_ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault("SCENARIO_SCRIPTS_DIR", str(REPO_ROOT / "agents" / "scenarios"))

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_echo_returns_payload_inline():
    r = client.post(
        "/run",
        json={"task_type": "echo", "payload": {"msg": "hi"}, "session_id": "s1"},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"] == {"echo": {"msg": "hi"}}
    assert body["result_key"] is None
    assert body["task_id"].startswith("task-")


def test_pandas_describe():
    r = client.post(
        "/run",
        json={
            "task_type": "pandas_describe",
            "payload": {"data": [{"a": 1, "b": 2}, {"a": 3, "b": 4}, {"a": 5, "b": 6}]},
        },
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["a"]["mean"] == 3.0
    assert body["result"]["b"]["mean"] == 4.0


def test_pandas_describe_from_csv_string():
    r = client.post(
        "/run",
        json={
            "task_type": "pandas_describe",
            "payload": {"data": "a,b\n1,2\n3,4\n5,6\n"},
        },
    )
    assert r.json()["status"] == "ok"


def test_sklearn_train():
    r = client.post(
        "/run",
        json={
            "task_type": "sklearn_train",
            "payload": {
                "X": [[0, 0], [1, 1], [0, 1], [1, 0], [2, 2], [2, 0]],
                "y": [0, 1, 0, 1, 1, 1],
            },
        },
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["n_samples"] == 6
    assert body["result"]["n_features"] == 2
    assert 0.0 <= body["result"]["mean_accuracy"] <= 1.0


def test_unknown_task_type_returns_error():
    r = client.post(
        "/run",
        json={"task_type": "does-not-exist", "payload": {}},
    )
    body = r.json()
    assert r.status_code == 200  # endpoint shape: errors are in the body
    assert body["status"] == "error"
    assert body["error"] is not None


def test_validation_error_for_bad_request():
    # missing required field "payload"
    r = client.post("/run", json={"task_type": "echo"})
    assert r.status_code == 422


# ---- shell task type ----------------------------------------------------

@pytest.mark.parametrize(
    "scenario",
    ["terminal-agent", "market-research", "large-build-test", "taskflow-pull"],
)
def test_shell_runs_known_scenario(scenario):
    r = client.post(
        "/run",
        json={"task_type": "shell", "payload": {"scenario": scenario}},
    )
    body = r.json()
    assert body["status"] == "ok", body
    # Small scenarios are returned inline — keeps the demo path simple.
    assert body["result"]["scenario"] == scenario
    assert body["result"]["exit_code"] == 0
    assert body["result"]["timed_out"] is False
    assert "stdout" in body["result"]
    assert f"[scenario] {scenario}" in body["result"]["stdout"]


@pytest.mark.parametrize(
    "scenario",
    ["terminal-agent", "market-research", "large-build-test", "taskflow-pull"],
)
def test_shell_quiet_flag_suppresses_narration(scenario):
    """payload.quiet=true must drop the [scenario]/[step] narration lines.

    Real command output (uname/date/pwd, ls, the JSON result fragment) and the
    `--- task-brief ---` headers stay on, so the recipient sees actual shell
    output rather than guided demo text. This is the inverse of
    test_shell_runs_known_scenario, which asserts the narration is present
    when quiet is unset.
    """
    r = client.post(
        "/run",
        json={
            "task_type": "shell",
            "payload": {"scenario": scenario, "quiet": True},
        },
    )
    body = r.json()
    assert body["status"] == "ok", body
    out = body["result"]["stdout"]
    assert f"[scenario] {scenario}" not in out
    assert "[step " not in out
    # The structured result fragment is real output, not narration — it must
    # survive the quiet flag so callers can still parse the scenario verdict.
    assert f'"scenario":"{scenario}"' in out


def test_shell_rejects_unknown_scenario():
    r = client.post(
        "/run",
        json={"task_type": "shell", "payload": {"scenario": "../etc/passwd"}},
    )
    body = r.json()
    assert body["status"] == "error"
    assert "unknown scenario" in body["error"] or "see worker logs" in body["error"]


def test_shell_rejects_missing_scenario():
    r = client.post("/run", json={"task_type": "shell", "payload": {}})
    body = r.json()
    assert body["status"] == "error"


def test_shell_rejects_out_of_range_timeout():
    r = client.post(
        "/run",
        json={
            "task_type": "shell",
            "payload": {"scenario": "terminal-agent", "timeout_seconds": -1},
        },
    )
    assert r.json()["status"] == "error"


def test_shell_timeout_reports_error_not_ok(monkeypatch, tmp_path):
    """A scenario that exceeds its timeout must surface as status=error.

    Otherwise the control-plane forwards "ok" → "completed" and a stuck
    scenario looks like a successful demo run.
    """
    sleep_dir = tmp_path / "sleep-scenario"
    sleep_dir.mkdir()
    (sleep_dir / "run.sh").write_text("#!/usr/bin/env bash\nsleep 5\n")
    monkeypatch.setattr(app_module, "SCENARIO_SCRIPTS_DIR", tmp_path)
    monkeypatch.setattr(
        app_module, "ALLOWED_SCENARIOS", frozenset({"sleep-scenario"})
    )
    r = client.post(
        "/run",
        json={
            "task_type": "shell",
            "payload": {"scenario": "sleep-scenario", "timeout_seconds": 0.5},
        },
    )
    body = r.json()
    assert body["status"] == "error"
    assert body["result"] is None


def test_shell_nonzero_exit_reports_error(monkeypatch, tmp_path):
    """A scenario that exits non-zero must be surfaced as status=error."""
    fail_dir = tmp_path / "fail-scenario"
    fail_dir.mkdir()
    (fail_dir / "run.sh").write_text(
        "#!/usr/bin/env bash\necho on stdout\n>&2 echo on stderr\nexit 7\n"
    )
    monkeypatch.setattr(app_module, "SCENARIO_SCRIPTS_DIR", tmp_path)
    monkeypatch.setattr(
        app_module, "ALLOWED_SCENARIOS", frozenset({"fail-scenario"})
    )
    r = client.post(
        "/run",
        json={"task_type": "shell", "payload": {"scenario": "fail-scenario"}},
    )
    body = r.json()
    assert body["status"] == "error"
    assert body["result"] is None


def test_shell_forwards_taskflow_api_url_only_when_configured(monkeypatch, tmp_path):
    """taskflow-pull needs TASKFLOW_API_URL, but worker secrets stay scrubbed."""
    env_dir = tmp_path / "env-scenario"
    env_dir.mkdir()
    (env_dir / "run.sh").write_text(
        "#!/usr/bin/env bash\n"
        "echo TASKFLOW_API_URL=${TASKFLOW_API_URL:-missing}\n"
        "echo MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-missing}\n"
    )
    monkeypatch.setattr(app_module, "SCENARIO_SCRIPTS_DIR", tmp_path)
    monkeypatch.setattr(app_module, "ALLOWED_SCENARIOS", frozenset({"env-scenario"}))
    monkeypatch.setenv("TASKFLOW_API_URL", "https://taskflow.example.test")
    monkeypatch.setenv("MINIO_SECRET_KEY", "should-not-leak")

    r = client.post(
        "/run",
        json={"task_type": "shell", "payload": {"scenario": "env-scenario"}},
    )

    body = r.json()
    assert body["status"] == "ok", body
    out = body["result"]["stdout"]
    assert "TASKFLOW_API_URL=https://taskflow.example.test" in out
    assert "MINIO_SECRET_KEY=missing" in out
    assert "should-not-leak" not in out

    monkeypatch.delenv("TASKFLOW_API_URL", raising=False)
    r2 = client.post(
        "/run",
        json={"task_type": "shell", "payload": {"scenario": "env-scenario"}},
    )

    body2 = r2.json()
    assert body2["status"] == "ok", body2
    out2 = body2["result"]["stdout"]
    assert "TASKFLOW_API_URL=missing" in out2
    assert "MINIO_SECRET_KEY=missing" in out2
    assert "should-not-leak" not in out2


# ---- agent_invoke task type --------------------------------------------

class _FakeResp:
    def __init__(self, status_code=200, json_body=None, text=""):
        self.status_code = status_code
        self._json = json_body
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError(
                f"{self.status_code}", request=None, response=None
            )

    def json(self):
        if self._json is None:
            raise ValueError("no json")
        return self._json


def test_agent_invoke_unconfigured_returns_error(monkeypatch):
    monkeypatch.setattr(app_module, "OPENCLAW_GATEWAY_URL", "")
    r = client.post(
        "/run",
        json={
            "task_type": "agent_invoke",
            "payload": {"tool": "message", "args": {"text": "hi"}},
        },
    )
    body = r.json()
    assert body["status"] == "error"


def test_agent_invoke_forwards_to_gateway(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["timeout"] = timeout
        return _FakeResp(200, {"ok": True, "echoed": json})

    monkeypatch.setattr(
        app_module, "OPENCLAW_GATEWAY_URL", "http://openclaw.test:18789"
    )
    monkeypatch.setattr(app_module, "OPENCLAW_GATEWAY_TOKEN", "tok-xyz")
    monkeypatch.setattr(app_module.httpx, "post", fake_post)

    r = client.post(
        "/run",
        json={
            "task_type": "agent_invoke",
            "payload": {"tool": "message", "args": {"text": "hi"}},
        },
    )
    body = r.json()
    assert body["status"] == "ok", body
    assert captured["url"] == "http://openclaw.test:18789/tools/invoke"
    assert captured["json"] == {"tool": "message", "args": {"text": "hi"}}
    assert captured["headers"]["Authorization"] == "Bearer tok-xyz"
    assert body["result"]["tool"] == "message"
    assert body["result"]["response"]["ok"] is True


def test_agent_invoke_rejects_missing_tool(monkeypatch):
    monkeypatch.setattr(
        app_module, "OPENCLAW_GATEWAY_URL", "http://openclaw.test:18789"
    )
    r = client.post(
        "/run",
        json={"task_type": "agent_invoke", "payload": {"args": {}}},
    )
    assert r.json()["status"] == "error"
