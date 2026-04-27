"""
Offload API — System B worker for CPU-heavy tasks.
Tasks arrive via POST /run, execute in-process, results saved to MinIO.
"""
import io
import json
import logging
import os
import subprocess
import traceback
import uuid
from pathlib import Path
from typing import Any, Optional

import boto3
import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Offload API", version="0.1.0")
logger = logging.getLogger("offload-worker")

MINIO_ENDPOINT  = os.environ["MINIO_ENDPOINT"]          # e.g. http://minio.system-b:9000
MINIO_ACCESS    = os.environ["MINIO_ACCESS_KEY"]
MINIO_SECRET    = os.environ["MINIO_SECRET_KEY"]
MINIO_BUCKET    = os.environ.get("MINIO_BUCKET", "demo-artifacts")

# Shell-task allow-list. Each scenario name maps to a script directory under
# SCENARIO_SCRIPTS_DIR; the worker only ever runs the fixed `run.sh` in that
# directory. Callers cannot pick the script — only the scenario name — so this
# task type is not a generic remote shell.
SCENARIO_SCRIPTS_DIR = Path(os.environ.get("SCENARIO_SCRIPTS_DIR", "/scenarios"))
ALLOWED_SCENARIOS = frozenset({"terminal-agent", "market-research", "large-build-test"})
SHELL_DEFAULT_TIMEOUT = float(os.environ.get("SHELL_TASK_TIMEOUT_SECONDS", "60"))
SHELL_MAX_TIMEOUT = float(os.environ.get("SHELL_TASK_MAX_TIMEOUT_SECONDS", "300"))

# OpenClaw gateway target for `agent_invoke`. Only configured in the k8s
# deployment where the operator-managed instance is reachable.
OPENCLAW_GATEWAY_URL = os.environ.get("OPENCLAW_GATEWAY_URL", "").rstrip("/")
OPENCLAW_GATEWAY_TOKEN = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
AGENT_INVOKE_DEFAULT_TIMEOUT = float(
    os.environ.get("AGENT_INVOKE_TIMEOUT_SECONDS", "60")
)
# Hard upper bound so a misbehaving caller can't tie up worker capacity.
AGENT_INVOKE_MAX_TIMEOUT = float(
    os.environ.get("AGENT_INVOKE_MAX_TIMEOUT_SECONDS", "300")
)

s3 = boto3.client(
    "s3",
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET,
    region_name="us-east-1",
)


class TaskRequest(BaseModel):
    task_type: str
    payload:   dict[str, Any]
    session_id: Optional[str] = None


class TaskResult(BaseModel):
    task_id:    str
    status:     str                 # "ok" | "error"
    result_key: Optional[str] = None   # MinIO object key when saved
    result:     Optional[Any] = None   # inline for small responses
    error:      Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run", response_model=TaskResult)
def run_task(req: TaskRequest):
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    try:
        result = dispatch(req.task_type, req.payload)

        # Save to MinIO if result is large
        result_json = json.dumps(result)
        if len(result_json) > 4096:
            key = f"offload/{req.session_id or 'anon'}/{task_id}.json"
            s3.put_object(Bucket=MINIO_BUCKET, Key=key, Body=result_json.encode())
            return TaskResult(task_id=task_id, status="ok", result_key=key)
        else:
            return TaskResult(task_id=task_id, status="ok", result=result)

    except Exception:
        # Log the full traceback server-side; return a short error to the client.
        logger.exception("task %s (%s) failed", task_id, req.task_type)
        # In DEBUG mode, return the traceback so demo-time failures are visible
        # without shelling into the worker. Off by default.
        if os.environ.get("DEBUG_TASK_ERRORS") == "1":
            return TaskResult(task_id=task_id, status="error", error=traceback.format_exc())
        return TaskResult(
            task_id=task_id,
            status="error",
            error=f"task {req.task_type!r} failed; see worker logs for task_id={task_id}",
        )


def dispatch(task_type: str, payload: dict) -> Any:
    if task_type == "echo":
        return {"echo": payload}

    elif task_type == "pandas_describe":
        import pandas as pd
        data = payload.get("data")           # list of dicts or CSV string
        if isinstance(data, str):
            df = pd.read_csv(io.StringIO(data))
        else:
            df = pd.DataFrame(data)
        return json.loads(df.describe().to_json())

    elif task_type == "sklearn_train":
        from sklearn.linear_model import LogisticRegression
        from sklearn.model_selection import cross_val_score
        import numpy as np
        X = np.array(payload["X"])
        y = np.array(payload["y"])
        clf = LogisticRegression(max_iter=500)
        scores = cross_val_score(clf, X, y, cv=min(3, len(y)))
        clf.fit(X, y)
        return {
            "cv_scores": scores.tolist(),
            "mean_accuracy": float(scores.mean()),
            "n_samples": len(y),
            "n_features": X.shape[1],
        }

    elif task_type == "shell":
        return _dispatch_shell(payload)

    elif task_type == "agent_invoke":
        return _dispatch_agent_invoke(payload)

    else:
        raise ValueError(f"Unknown task_type: {task_type!r}")


def _coerce_bool(value: Any) -> bool:
    """Permissive truthy check for JSON-shaped payload flags.

    Accepts native booleans, the strings "1"/"true"/"yes"/"on" (case-insensitive),
    and the integer 1. Anything else — including missing keys, None, "0", and
    arbitrary strings — is treated as false so a typo can't accidentally flip a
    behavior switch.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value == 1
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def _dispatch_shell(payload: dict) -> dict:
    """Run a fixed scenario script and return stdout/stderr/exit_code.

    The caller picks `scenario` (allow-listed); the script path is server-side.
    Output is truncated to keep responses small — full transcripts go through
    the MinIO threshold in run_task() automatically when over 4 KB.
    """
    scenario = payload.get("scenario")
    if scenario not in ALLOWED_SCENARIOS:
        raise ValueError(
            f"unknown scenario: {scenario!r}; allowed={sorted(ALLOWED_SCENARIOS)}"
        )
    script = SCENARIO_SCRIPTS_DIR / scenario / "run.sh"
    # `resolve(strict=True)` both checks existence and prevents a symlink in
    # SCENARIO_SCRIPTS_DIR from escaping into a different on-disk path.
    try:
        resolved = script.resolve(strict=True)
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"scenario script missing: {script}") from exc
    base = SCENARIO_SCRIPTS_DIR.resolve()
    if base not in resolved.parents:
        raise ValueError(f"scenario script escapes base dir: {resolved}")

    raw_timeout = payload.get("timeout_seconds", SHELL_DEFAULT_TIMEOUT)
    try:
        timeout = float(raw_timeout)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"timeout_seconds must be a number, got {raw_timeout!r}") from exc
    if timeout <= 0 or timeout > SHELL_MAX_TIMEOUT:
        raise ValueError(
            f"timeout_seconds must be in (0, {SHELL_MAX_TIMEOUT}]; got {timeout}"
        )

    # Don't propagate worker secrets (OPENCLAW_GATEWAY_TOKEN, MinIO creds,
    # etc.) into the scenario subprocess — a buggy script could echo them and
    # they'd land in the response body or MinIO. Pass only what bash needs.
    safe_env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "HOME": "/tmp",
    }

    # Optional narration toggle: when the caller sets payload.quiet=true (or
    # the worker is started with DEMO_QUIET=1 in the environment) the scenario
    # scripts skip [scenario]/[step] narration lines and emit only real
    # command output + the structured result fragment. Useful when the demo
    # is wired to an end-user screen that should look like a real shell run
    # rather than a guided walkthrough.
    if _coerce_bool(payload.get("quiet")) or os.environ.get("DEMO_QUIET") == "1":
        safe_env["DEMO_QUIET"] = "1"

    try:
        proc = subprocess.run(
            ["/bin/bash", str(resolved)],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            cwd=str(resolved.parent),
            env=safe_env,
        )
    except subprocess.TimeoutExpired as exc:
        # A timeout is a task failure, not a successful run. Raise so run_task
        # marks the result status="error" (the control plane forwards that
        # status to the client). Stash partial output in the message so it
        # surfaces under DEBUG_TASK_ERRORS=1.
        partial = (exc.stdout or "")[-512:] if isinstance(exc.stdout, str) else ""
        raise TimeoutError(
            f"shell scenario {scenario!r} timed out after {timeout}s; "
            f"partial stdout tail={partial!r}"
        ) from exc

    if proc.returncode != 0:
        # Same rationale as the timeout path: a non-zero exit means the
        # scenario failed, so run_task must surface status="error" instead
        # of reporting a "completed" job with a failure payload. Include the
        # stderr tail in the message so DEBUG_TASK_ERRORS=1 still shows it.
        raise RuntimeError(
            f"shell scenario {scenario!r} exited with code {proc.returncode}; "
            f"stderr tail={(proc.stderr or '')[-512:]!r}"
        )

    return {
        "scenario": scenario,
        "exit_code": proc.returncode,
        "timed_out": False,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


def _dispatch_agent_invoke(payload: dict) -> dict:
    """Forward a tool call to the OpenClaw gateway.

    The gateway URL/token are configured via env so the worker can run
    standalone in compose (without OpenClaw) and still serve other task types.
    """
    if not OPENCLAW_GATEWAY_URL:
        raise RuntimeError(
            "agent_invoke not configured: set OPENCLAW_GATEWAY_URL on the worker"
        )
    tool = payload.get("tool")
    if not isinstance(tool, str) or not tool:
        raise ValueError("agent_invoke payload requires a non-empty 'tool' string")
    args = payload.get("args", {})
    if not isinstance(args, dict):
        raise ValueError("agent_invoke 'args' must be an object")

    raw_timeout = payload.get("timeout_seconds", AGENT_INVOKE_DEFAULT_TIMEOUT)
    try:
        timeout = float(raw_timeout)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"timeout_seconds must be a number, got {raw_timeout!r}") from exc
    if timeout <= 0 or timeout > AGENT_INVOKE_MAX_TIMEOUT:
        raise ValueError(
            f"timeout_seconds must be in (0, {AGENT_INVOKE_MAX_TIMEOUT}]; got {timeout}"
        )

    headers = {"Content-Type": "application/json"}
    if OPENCLAW_GATEWAY_TOKEN:
        headers["Authorization"] = f"Bearer {OPENCLAW_GATEWAY_TOKEN}"

    resp = httpx.post(
        f"{OPENCLAW_GATEWAY_URL}/tools/invoke",
        json={"tool": tool, "args": args},
        headers=headers,
        timeout=timeout,
    )
    # Surface non-2xx as a normal error (caught by run_task and reported in
    # the response body, not as an HTTP 500 on /run).
    resp.raise_for_status()
    try:
        return {"tool": tool, "response": resp.json()}
    except ValueError:
        return {"tool": tool, "response_text": resp.text}
