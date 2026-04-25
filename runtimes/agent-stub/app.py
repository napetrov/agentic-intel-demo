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

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

app = FastAPI(title="agent-stub", version="0.1.0")
logger = logging.getLogger("agent-stub")

# Optional LLM hook for classification. When LLM_BASE_URL + LLM_MODEL are set
# the agent asks an OpenAI-compatible endpoint (LiteLLM, vLLM, OpenAI) to
# pick a tool from the allow-list. Any failure (network, bad JSON, missing
# tool) falls back to the deterministic _classify() rules so the demo still
# runs offline. Untested provider URLs aren't a regression — if they're
# unset, _classify_llm() is never called.
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_TIMEOUT_SECONDS = float(os.environ.get("LLM_TIMEOUT_SECONDS", "10"))

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
    # Inner tools raise ValueError on bad input (path-doesn't-exist,
    # binary-not-allow-listed, etc.). On a free-form "command" call we
    # don't want a misclassified verb to surface as a hard error — fall
    # back to echo with the original text and a trace entry that names the
    # underlying error so the UI is honest about what happened.
    fallback_reason: Optional[str] = None
    try:
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
    except (ValueError, FileNotFoundError) as exc:
        fallback_reason = f"{inner_tool} failed: {exc}"
        inner_tool = "echo"
        inner_args = {"text": text}
        result = {"echo": inner_args}
        trace.append({
            "step": 2,
            "tool": "fallback",
            "summary": fallback_reason,
        })
    trace.append({
        "step": len(trace) + 1,
        "tool": inner_tool,
        "summary": _trace_summary(inner_tool, result),
    })
    return {
        "input": text,
        "chosen_tool": inner_tool,
        "chosen_args": inner_args,
        "rationale": classification["rationale"]
        + (f"; fell back to echo ({fallback_reason})" if fallback_reason else ""),
        "result": result,
    }, trace


def _classify(text: str) -> dict[str, Any]:
    """Pick a tool for the input.

    If LLM_BASE_URL + LLM_MODEL are configured, ask the LLM first and
    accept any answer that names an allow-listed tool. Otherwise, or on
    any LLM failure, fall through to the deterministic rule-based path
    below. Both modes return the same shape: {tool, args, rationale}.
    """
    if LLM_BASE_URL and LLM_MODEL:
        llm = _classify_llm(text)
        if llm is not None:
            return llm
    return _classify_rules(text)


def _classify_llm(text: str) -> Optional[dict[str, Any]]:
    """Ask an OpenAI-compatible chat endpoint to pick a tool.

    Returns None on any failure so the caller falls back to rules. The
    prompt names the allow-listed tools and asks for strict JSON; we
    validate the shape before accepting it.
    """
    system = (
        "You route a free-form user request to one of these tools and emit JSON only.\n"
        "Tools:\n"
        "- shell: run an allow-listed binary in {whoami, date, uname, pwd, echo}.\n"
        "  args = {command: '<binary> [arg]'}\n"
        "- read_file: read a file under /workspace. args = {path: '<rel>'}\n"
        "- list_files: list a dir under /workspace. args = {path: '<rel>'}\n"
        "- summarize: heuristic summary. args = {text: '<text>'}\n"
        "- echo: return the input. args = {text: '<text>'}\n"
        "Respond with exactly: {\"tool\": ..., \"args\": {...}, \"rationale\": \"...\"}"
    )
    headers = {"Content-Type": "application/json"}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"
    try:
        resp = httpx.post(
            f"{LLM_BASE_URL}/chat/completions",
            json={
                "model": LLM_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": text},
                ],
                "temperature": 0,
                "max_tokens": 200,
            },
            headers=headers,
            timeout=LLM_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        body = resp.json()
        content = body["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, ValueError, IndexError) as exc:
        logger.warning("LLM classify failed (%s); falling back to rules", exc)
        return None
    # Some OpenAI-compatible providers return null or a structured
    # tool-calls payload as message.content; only the plain-string shape
    # is parseable here, anything else degrades to the rules fallback.
    if not isinstance(content, str):
        logger.warning(
            "LLM message.content is %s, not str; falling back to rules",
            type(content).__name__,
        )
        return None
    try:
        # Some models wrap JSON in ```json fences. Strip them defensively.
        stripped = content.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
            stripped = re.sub(r"\s*```$", "", stripped)
        parsed = __import__("json").loads(stripped)
    except ValueError as exc:
        logger.warning("LLM response not JSON (%s); falling back to rules", exc)
        return None
    # `parsed.get(...)` below assumes a JSON object; a list or scalar would
    # AttributeError out and skip the rules fallback, defeating the
    # graceful-degradation contract.
    if not isinstance(parsed, dict):
        logger.warning(
            "LLM JSON is %s, not object; falling back to rules",
            type(parsed).__name__,
        )
        return None
    tool = parsed.get("tool")
    args = parsed.get("args")
    if tool not in {"shell", "read_file", "list_files", "summarize", "echo"} \
       or not isinstance(args, dict):
        logger.warning("LLM returned bad shape %r; falling back to rules", parsed)
        return None
    return {
        "tool": tool,
        "args": args,
        "rationale": parsed.get("rationale") or f"LLM ({LLM_MODEL}) chose {tool}",
    }


def _classify_rules(text: str) -> dict[str, Any]:
    """Deterministic rule-based fallback. Order matters: first match wins."""
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
