# Agent Tool Reference

The agent surface that the demo's offload-worker forwards
`task_type=agent_invoke` payloads to is `POST /tools/invoke`. Two
implementations satisfy that contract:

- **Tier 1 (local docker-compose / dev-up)** — `agent-stub`
  (`runtimes/agent-stub/app.py`). A small, allow-listed tool set, no
  external dependencies, deterministic fallbacks.
- **Tier 2 (operator-managed)** — a real OpenClaw instance routes the
  same envelope through its own tool registry. The Tier 1 stub mirrors
  the contract so the web UI can show "the agent ran a command and here
  is the output" end-to-end without needing the operator stack.

This doc covers the Tier 1 tool surface in detail. For the operator-managed
tool registry see `docs/contracts/task-routing.md` and the upstream
OpenClaw config in `examples/openclawinstance-intel-demo.yaml`.

## Wire format

### `POST /tools/invoke`

Request:

```json
{
  "tool": "<tool name>",
  "args": { "...": "..." }
}
```

Response (success):

```json
{
  "tool": "<tool name>",
  "status": "ok",
  "result": { "...": "..." },
  "trace": [
    { "step": 1, "tool": "<inner tool>", "summary": "<short string>" }
  ],
  "elapsed_ms": <int>
}
```

Response (bad input or tool failure):

```json
{
  "tool": "<tool name>",
  "status": "error",
  "error": "<message>",
  "trace": [],
  "elapsed_ms": <int>
}
```

Errors are returned as `200` with `status: "error"` so the offload-worker
surfaces them as `task_status=error` rather than HTTP 5xx. The only `4xx`
this endpoint emits is `422` when the request body fails Pydantic
validation (e.g. missing `tool`).

## Tools

### `echo`
Returns the args verbatim. Used by the classifier as a safe fallback.

```jsonc
// args
{ "text": "hello" }
// result
{ "echo": { "text": "hello" } }
```

### `shell`
Runs an allow-listed binary in a sandboxed, read-only working directory
(`/workspace`). Implementation: `_tool_shell` in
`runtimes/agent-stub/app.py`.

Allow-list (intentionally tiny — these binaries cannot escape `/workspace`
even if given an absolute path):

```
whoami, date, uname, pwd, echo
```

Path-taking binaries (`cat`, `ls`, `head`, `wc`) are **deliberately not**
on the list — they would let the agent read outside `/workspace` via
absolute paths. Use `read_file` and `list_files` instead.

Other guards:

- shell metacharacters (`;|&\`$<>\n\r`) reject the request before
  execution; the binary is invoked via `subprocess.run(argv, shell=False)`
- timeout: `AGENT_SHELL_TIMEOUT_SECONDS` (default 10s)
- output cap: `AGENT_SHELL_MAX_OUTPUT` (default 8192 bytes per stdout/stderr)
- env stripped to `PATH`, `LANG`, `LC_ALL`, `HOME=/tmp`

```jsonc
// args
{ "command": "uname -a" }
// result
{
  "argv": ["uname", "-a"],
  "exit_code": 0,
  "stdout": "Linux ...\n",
  "stderr": "",
  "cwd": "/workspace"
}
```

### `read_file`
Reads a file under `/workspace`. Path is resolved with `Path.resolve()`
and rejected if it escapes the workspace root
(`_resolve_under_workspace` in `runtimes/agent-stub/app.py`).

Bounds: `max_bytes` defaults to 4096, capped at 65536. Reads `max_bytes+1`
to detect truncation without a stat() race.

```jsonc
// args
{ "path": "notes/intro.md", "max_bytes": 4096 }
// result
{ "path": "notes/intro.md", "bytes": 1234, "truncated": false, "content": "..." }
```

### `list_files`
Lists immediate children of a directory under `/workspace` (depth 1).

```jsonc
// args
{ "path": "." }
// result
{
  "root": ".",
  "entries": [
    { "name": "notes", "kind": "dir", "size": null },
    { "name": "README.md", "kind": "file", "size": 1567 }
  ]
}
```

### `summarize`
Deterministic heuristic: first sentence + top-5 most frequent
non-stopword tokens. Pure Python, no LLM. A real deployment would call
the SLM here.

```jsonc
// args
{ "text": "<freeform string>" }
// result
{
  "input_chars": 423,
  "first_sentence": "...",
  "top_words": [{ "word": "...", "count": 3 }, ...]
}
```

### `command` (free-form entry point)
The demo UI sends every "Agent command" submission here. Two phases:

1. **Classify** the input string into one of the tools above. If
   `LLM_BASE_URL` + `LLM_MODEL` are set the classifier asks an
   OpenAI-compatible chat endpoint first (LiteLLM, vLLM, OpenAI). On
   any failure (network error, malformed JSON, tool not in the
   allow-list) it falls back to a deterministic rule-based classifier.
2. **Run** the chosen tool. If the inner tool raises `ValueError` /
   `OSError` (e.g. path doesn't exist, binary not allow-listed) the
   call falls back to `echo` with the original text plus a `fallback`
   trace entry naming the underlying error — so the UI is honest about
   what happened instead of 500-ing on a misclassified verb.

```jsonc
// args
{ "text": "uname -a" }
// result
{
  "input": "uname -a",
  "chosen_tool": "shell",
  "chosen_args": { "command": "uname -a" },
  "rationale": "input starts with allow-listed binary 'uname'",
  "result": { "argv": [...], "exit_code": 0, "stdout": "...", ... }
}
// trace
[
  { "step": 1, "tool": "classify", "summary": "classified as shell: ..." },
  { "step": 2, "tool": "shell", "summary": "shell ran 'uname' -> exit 0" }
]
```

#### Rule-based classifier (deterministic fallback)

| Input prefix | Routes to | Notes |
|--------------|-----------|-------|
| allow-listed binary as first word | `shell` | runs the input verbatim |
| `read `, `show `, `cat ` | `read_file` | rest of line is the path |
| `ls`, `list` | `list_files` | optional path, defaults to `.` |
| `summarize `, `summary of `, `tldr ` | `summarize` | rest of line is the text |
| `echo `, `say ` | `echo` | rest of line is the text |
| anything else | `echo` | safe fallback rather than guessing into `shell` |

#### LLM-based classifier (when configured)

When `LLM_BASE_URL` and `LLM_MODEL` are set the agent sends the system
prompt below to `<LLM_BASE_URL>/chat/completions` and accepts any JSON
object naming an allow-listed tool:

> You route a free-form user request to one of these tools and emit
> JSON only. Tools: shell (allow-listed binary), read_file, list_files,
> summarize, echo. Respond with exactly:
> `{"tool": ..., "args": {...}, "rationale": "..."}`

`temperature=0`, `max_tokens=200`, timeout `LLM_TIMEOUT_SECONDS`
(default 10s). Any malformed response, unknown tool, or non-2xx
silently falls back to the rule path so the demo still runs offline.

## Environment variables

| Var | Default | Effect |
|-----|---------|--------|
| `LLM_BASE_URL` | _unset_ | If set, classifier asks this OpenAI-compatible endpoint first |
| `LLM_MODEL` | _unset_ | Model name to send to that endpoint |
| `LLM_API_KEY` | _unset_ | Bearer token for the LLM endpoint |
| `LLM_TIMEOUT_SECONDS` | `10` | Per-request LLM timeout |
| `AGENT_WORKSPACE_DIR` | `/workspace` | Read-only workspace root |
| `AGENT_SHELL_TIMEOUT_SECONDS` | `10` | Per-command shell timeout |
| `AGENT_SHELL_MAX_OUTPUT` | `8192` | Cap on stdout/stderr returned per call |

## Adding a new tool

1. Add a `_tool_<name>(args)` function in `runtimes/agent-stub/app.py`.
   Keep it pure-input → pure-output; raise `ValueError` for bad input
   so `/tools/invoke` returns a structured 200 error instead of 5xx.
2. Add a branch to `_dispatch()` in `runtimes/agent-stub/app.py`.
3. If the new tool should be reachable from the free-form `command`
   entry point, add a rule branch in `_classify_rules()` AND add the
   tool to the allow-list mentioned in the LLM system prompt in
   `_classify_llm()`. Both classifiers must list the same set so
   behaviour is the same with or without an LLM configured.
4. Update the `chosen_tool` allow-list check at the bottom of
   `_classify_llm()` (the `tool not in {...}` set).
5. Extend the unit tests under `runtimes/agent-stub/tests/`.
6. Document the tool in this file.

## Operator-managed tool surface (Tier 2)

In Tier 2, `agent_invoke` is forwarded to an OpenClaw instance whose
tool registry is configured via `examples/openclawinstance-intel-demo.yaml`.
The wire envelope is identical, but the tool set is whatever the operator
config exposes. The Tier 1 stub is intentionally a strict subset; if a
scenario relies on a tool that only exists in the operator path, document
that dependency in the scenario's `flow.md`.
