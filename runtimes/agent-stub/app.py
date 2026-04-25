"""
agent-stub — a tiny, self-contained agent gateway for the local demo.

The offload-worker forwards `task_type=agent_invoke` payloads to
`POST /tools/invoke` on the OpenClaw gateway. In the operator-managed
Kubernetes path that's a real OpenClaw instance. For the local
docker-compose demo the gateway doesn't exist, so `agent_invoke` returns
"unconfigured". This service stands in for the real gateway: it accepts the
same `{tool, args}` envelope and runs a small set of allow-listed tools so
the web UI can show "the agent ran a command and here is the output"
end-to-end without external dependencies.

Tools:
  echo         -> returns args verbatim
  shell        -> runs an allow-listed command in a sandboxed read-only cwd
  read_file    -> reads a file from /workspace (mounted read-only)
  list_files   -> lists files under /workspace (depth 1)
  summarize    -> deterministic heuristic summary of provided text
  command      -> entry point used by the UI; classifies free-form text
                  into one of the tools above and runs it
"""
from __future__ import annotations

import logging
import os
import re
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="agent-stub", version="0.1.0")
logger = logging.getLogger("agent-stub")

# Workspace mounted read-only by docker-compose. Tools that read/list files
# resolve paths under this root and reject anything escaping it.
WORKSPACE_DIR = Path(os.environ.get("AGENT_WORKSPACE_DIR", "/workspace")).resolve()

# Hard cap on the shell tool. Each command is one allow-listed binary plus
# bounded args; no shell metacharacters, no pipelines. Path-taking binaries
# (cat/ls/head/wc) are deliberately *not* on this list — they let the agent
# escape the /workspace boundary via absolute paths (e.g. `cat /etc/passwd`).
# Use the dedicated `read_file` / `list_files` tools instead, which resolve
# paths under WORKSPACE_DIR.
SHELL_ALLOWLIST = frozenset({
    "whoami", "date", "uname", "pwd", "echo",
})
SHELL_TIMEOUT_SECONDS = float(os.environ.get("AGENT_SHELL_TIMEOUT_SECONDS", "10"))
SHELL_MAX_OUTPUT_BYTES = int(os.environ.get("AGENT_SHELL_MAX_OUTPUT", "8192"))


class InvokeRequest(BaseModel):
    tool: str = Field(min_length=1)
    args: dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/tools/invoke")
def invoke(req: InvokeRequest) -> dict[str, Any]:
    started_at = time.time()
    try:
        result, trace = _dispatch(req.tool, req.args)
    except HTTPException:
        raise
    except ValueError as exc:
        # Bad-input errors come back as a structured 200 so the offload-worker
        # surfaces them as task_status=error rather than HTTP 5xx.
        return {
            "tool": req.tool,
            "status": "error",
            "error": str(exc),
            "elapsed_ms": int((time.time() - started_at) * 1000),
            "trace": [],
        }
    except Exception as exc:  # defensive: never leak a traceback to the UI
        logger.exception("tool %r failed", req.tool)
        return {
            "tool": req.tool,
            "status": "error",
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_ms": int((time.time() - started_at) * 1000),
            "trace": [],
        }
    return {
        "tool": req.tool,
        "status": "ok",
        "result": result,
        "trace": trace,
        "elapsed_ms": int((time.time() - started_at) * 1000),
    }


def _dispatch(tool: str, args: dict[str, Any]) -> tuple[Any, list[dict[str, Any]]]:
    """Dispatch a tool call. Returns (result, trace).

    `trace` is a small list of {step, tool, summary} entries so the UI can
    show "the agent did X then Y" rather than just one opaque blob.
    """
    if tool == "echo":
        return {"echo": args}, [{"step": 1, "tool": "echo", "summary": "returned args"}]
    if tool == "shell":
        out = _tool_shell(args)
        return out, [{
            "step": 1, "tool": "shell",
            "summary": f"ran {out['argv'][0]!r} (exit {out['exit_code']})",
        }]
    if tool == "read_file":
        out = _tool_read_file(args)
        return out, [{
            "step": 1, "tool": "read_file",
            "summary": f"read {out['path']} ({out['bytes']} bytes)",
        }]
    if tool == "list_files":
        out = _tool_list_files(args)
        return out, [{
            "step": 1, "tool": "list_files",
            "summary": f"listed {out['root']} ({len(out['entries'])} entries)",
        }]
    if tool == "summarize":
        out = _tool_summarize(args)
        return out, [{
            "step": 1, "tool": "summarize",
            "summary": f"summarized {out['input_chars']} chars",
        }]
    if tool == "command":
        return _tool_command(args)
    raise ValueError(f"unknown tool: {tool!r}")


# ---- individual tools ---------------------------------------------------


def _tool_shell(args: dict[str, Any]) -> dict[str, Any]:
    cmd = args.get("command")
    if not isinstance(cmd, str) or not cmd.strip():
        raise ValueError("shell.args.command must be a non-empty string")
    # No shell metacharacters: we run argv directly with shell=False so a
    # rogue ';' or '$()' cannot escape the allow-list.
    if any(ch in cmd for ch in ";|&`$<>\n\r"):
        raise ValueError("shell command contains disallowed characters")
    try:
        argv = shlex.split(cmd)
    except ValueError as exc:
        raise ValueError(f"shell command not parseable: {exc}") from exc
    if not argv:
        raise ValueError("shell.args.command parsed to empty argv")
    binary = argv[0]
    if binary not in SHELL_ALLOWLIST:
        raise ValueError(
            f"shell binary {binary!r} not allowed; allow-list={sorted(SHELL_ALLOWLIST)}"
        )

    safe_env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "HOME": "/tmp",
    }
    cwd = str(WORKSPACE_DIR) if WORKSPACE_DIR.is_dir() else "/tmp"
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=SHELL_TIMEOUT_SECONDS,
            check=False,
            cwd=cwd,
            env=safe_env,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError(
            f"shell command timed out after {SHELL_TIMEOUT_SECONDS}s"
        ) from exc
    return {
        "argv": argv,
        "exit_code": proc.returncode,
        "stdout": (proc.stdout or "")[:SHELL_MAX_OUTPUT_BYTES],
        "stderr": (proc.stderr or "")[:SHELL_MAX_OUTPUT_BYTES],
        "cwd": cwd,
    }


def _resolve_under_workspace(rel: str) -> Path:
    if not isinstance(rel, str) or not rel:
        raise ValueError("path must be a non-empty string")
    candidate = (WORKSPACE_DIR / rel).resolve()
    if WORKSPACE_DIR != candidate and WORKSPACE_DIR not in candidate.parents:
        raise ValueError(f"path escapes workspace: {rel!r}")
    return candidate


def _tool_read_file(args: dict[str, Any]) -> dict[str, Any]:
    rel = args.get("path", "")
    target = _resolve_under_workspace(rel)
    if not target.is_file():
        raise ValueError(f"not a file: {rel!r}")
    max_bytes = int(args.get("max_bytes", 4096))
    if max_bytes <= 0 or max_bytes > 65536:
        raise ValueError("max_bytes must be in (0, 65536]")
    # Bounded read: don't pull the whole file into memory just to slice it.
    # Read max_bytes+1 so we can detect truncation without a stat() race.
    with target.open("rb") as fh:
        raw = fh.read(max_bytes + 1)
    truncated = len(raw) > max_bytes
    data = raw[:max_bytes]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
    return {
        "path": str(target.relative_to(WORKSPACE_DIR)),
        "bytes": len(data),
        "truncated": truncated,
        "content": text,
    }


def _tool_list_files(args: dict[str, Any]) -> dict[str, Any]:
    rel = args.get("path", ".")
    root = _resolve_under_workspace(rel)
    if not root.is_dir():
        raise ValueError(f"not a directory: {rel!r}")
    entries = []
    for child in sorted(root.iterdir()):
        try:
            kind = "dir" if child.is_dir() else "file"
            size = child.stat().st_size if kind == "file" else None
        except OSError:
            continue
        entries.append({
            "name": child.name,
            "kind": kind,
            "size": size,
        })
    return {
        "root": str(root.relative_to(WORKSPACE_DIR)) or ".",
        "entries": entries,
    }


def _tool_summarize(args: dict[str, Any]) -> dict[str, Any]:
    """Heuristic summary: first sentence + N most frequent non-trivial words.

    No LLM. The point is to give the demo a deterministic agent-style result
    when wired through `command` ("summarize <text>"). A real deployment
    would call the SLM here.
    """
    text = args.get("text", "")
    if not isinstance(text, str):
        raise ValueError("summarize.args.text must be a string")
    text = text.strip()
    if not text:
        raise ValueError("summarize.args.text is empty")
    head = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    words = re.findall(r"[A-Za-z][A-Za-z\-']{2,}", text.lower())
    stop = {"the", "and", "for", "with", "that", "this", "from", "are", "but",
            "you", "your", "have", "has", "was", "were", "all", "into", "out"}
    freq: dict[str, int] = {}
    for w in words:
        if w in stop:
            continue
        freq[w] = freq.get(w, 0) + 1
    top = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    return {
        "input_chars": len(text),
        "first_sentence": head,
        "top_words": [{"word": w, "count": c} for w, c in top],
    }


def _tool_command(args: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Free-form entry point used by the demo UI.

    Classifies the input string into a real tool and runs it. The trace
    captures the classification step and the inner tool call so the UI can
    show "agent decided to use shell.uname, here is the output".
    """
    text = args.get("text", "")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("command.args.text must be a non-empty string")
    text = text.strip()
    classification = _classify(text)
    trace: list[dict[str, Any]] = [{
        "step": 1,
        "tool": "classify",
        "summary": f"classified as {classification['tool']}: {classification['rationale']}",
    }]
    inner_tool = classification["tool"]
    inner_args = classification["args"]
    if inner_tool == "echo":
        result = {"echo": inner_args}
    elif inner_tool == "shell":
        result = _tool_shell(inner_args)
    elif inner_tool == "read_file":
        result = _tool_read_file(inner_args)
    elif inner_tool == "list_files":
        result = _tool_list_files(inner_args)
    elif inner_tool == "summarize":
        result = _tool_summarize(inner_args)
    else:
        raise ValueError(f"classifier produced unknown tool: {inner_tool!r}")
    trace.append({
        "step": 2,
        "tool": inner_tool,
        "summary": _trace_summary(inner_tool, result),
    })
    return {
        "input": text,
        "chosen_tool": inner_tool,
        "chosen_args": inner_args,
        "rationale": classification["rationale"],
        "result": result,
    }, trace


def _classify(text: str) -> dict[str, Any]:
    """Tiny rule-based classifier. Deterministic, no LLM.

    Order matters: the first matching rule wins. This keeps the trace
    explainable in the UI ("classified as shell.whoami because the
    input started with 'whoami'").
    """
    low = text.lower().strip()
    # Direct shell verbs — match the start of the input against the allow-list.
    first_word = low.split()[0] if low.split() else ""
    if first_word in SHELL_ALLOWLIST:
        return {
            "tool": "shell",
            "args": {"command": text},
            "rationale": f"input starts with allow-listed binary {first_word!r}",
        }
    if low.startswith(("read ", "show ", "cat ")):
        path = text.split(None, 1)[1].strip()
        return {
            "tool": "read_file",
            "args": {"path": path},
            "rationale": f"verb 'read'/'show'/'cat' followed by path",
        }
    if low.startswith(("ls", "list ", "list")):
        rest = text.split(None, 1)[1].strip() if " " in text else "."
        return {
            "tool": "list_files",
            "args": {"path": rest or "."},
            "rationale": "verb 'list'/'ls' classifies as list_files",
        }
    if low.startswith(("summarize ", "summary of ", "tldr ")):
        rest = text.split(None, 1)[1].strip()
        return {
            "tool": "summarize",
            "args": {"text": rest},
            "rationale": "verb 'summarize'/'tldr' classifies as summarize",
        }
    if low.startswith(("echo ", "say ")):
        rest = text.split(None, 1)[1].strip()
        return {
            "tool": "echo",
            "args": {"text": rest},
            "rationale": "verb 'echo'/'say' classifies as echo",
        }
    # Fallback: echo. Better than guessing into shell with arbitrary input.
    return {
        "tool": "echo",
        "args": {"text": text},
        "rationale": "no rule matched; echoing input back",
    }


def _trace_summary(tool: str, result: dict[str, Any]) -> str:
    if tool == "shell":
        return f"shell ran {result['argv'][0]!r} -> exit {result['exit_code']}"
    if tool == "read_file":
        return f"read_file {result['path']} ({result['bytes']} bytes)"
    if tool == "list_files":
        return f"list_files {result['root']} ({len(result['entries'])} entries)"
    if tool == "summarize":
        return f"summarize -> {len(result['top_words'])} top words"
    if tool == "echo":
        return "echo returned input"
    return tool
