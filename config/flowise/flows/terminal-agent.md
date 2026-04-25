# Flow: terminal-agent

Mirrors `catalog/scenarios.yaml` → `terminal_agent`.

| Field | Value |
|-------|-------|
| Demo scenario | Terminal Agent |
| Execution mode | `local_standard` |
| Task family | `software_engineering` |
| Backend | control-plane `POST /offload` with `task_type=shell`, `payload.scenario=terminal-agent` |

## Important: this is not a generic remote shell

The offload-worker's `shell` task type accepts only an **allow-listed scenario
name**, not a free-form command. The worker resolves `payload.scenario` to a
fixed `run.sh` under `agents/scenarios/<scenario>/run.sh` and rejects
anything not in `{"terminal-agent", "market-research", "large-build-test"}`
(see `runtimes/offload-worker/app.py` → `ALLOWED_SCENARIOS`).

This flow therefore drives the canned `terminal-agent` scenario and uses
the LLM only to acknowledge the user and present the captured output. Do
not synthesize free-form `command` strings — they will be ignored.

## Intent

User asks the agent to run the terminal-agent demo. The flow submits
`{task_type: 'shell', payload: { scenario: 'terminal-agent' }}` to the
control-plane, then summarizes the returned stdout/stderr.

## Nodes

1. **Chat Input** — built-in.
2. **Buffer Memory** — keyed on `overrideConfig.session_id`.
3. **Chat Model: ChatOpenAI**
   - Credential: `litellm-openai`
   - Base URL: `${LITELLM_BASE_URL}`
   - Model name: `system-b-vllm-qwen3-4b-default`
   - System prompt:
     > You are the terminal-agent demo guide. When the user asks to run
     > the demo, call the `run_scenario` tool with no arguments. When the
     > tool returns, summarize stdout, stderr, and exit_code in plain
     > English. Do not invent commands; the worker only runs canned
     > scenario scripts.
4. **Custom Tool: run_scenario**
   - Description: "Run the terminal-agent scenario via the demo control plane."
   - Input schema: `{}` (no arguments — the scenario name is fixed).
   - Body (JavaScript):
     ```js
     // POST /offload is synchronous in the current control-plane: the
     // response already carries the terminal status (`completed` or
     // `error`). The poll loop below is defensive in case the contract
     // ever becomes async.
     const submit = await fetch(`${$vars.CONTROL_PLANE_BASE_URL}/offload`, {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({
         task_type: 'shell',
         payload: { scenario: 'terminal-agent' },
         session_id: $flow.session_id || 'flowise-demo'
       })
     });
     const submitted = await submit.json();
     if (submitted.status === 'completed' || submitted.status === 'error') {
       const detail = await fetch(
         `${$vars.CONTROL_PLANE_BASE_URL}/offload/${submitted.job_id}`
       ).then(x => x.json());
       return detail;
     }
     for (let i = 0; i < 30; i++) {
       await new Promise(res => setTimeout(res, 1000));
       const s = await fetch(
         `${$vars.CONTROL_PLANE_BASE_URL}/offload/${submitted.job_id}`
       ).then(x => x.json());
       if (s.status === 'completed' || s.status === 'error') return s;
     }
     return { status: 'timeout', job_id: submitted.job_id };
     ```
5. **Tool Agent**
   - LLM: the ChatOpenAI node above
   - Tools: [`run_scenario`]
   - Memory: the Buffer Memory node above
6. **Chat Output** — built-in.

## Wiring

```
Chat Input ── Tool Agent ── Chat Output
                │
   ┌────────────┼─────────────────┐
   ▼            ▼                 ▼
ChatOpenAI  Buffer Memory  run_scenario tool
```

## Variables to set in Flowise

In Settings → Variables, add:
- `CONTROL_PLANE_BASE_URL` — same value as the env var of the same name.
- `LITELLM_BASE_URL` — same value as the env var of the same name.

## Status model

Control-plane terminal states are **`completed`** and **`error`** (see
`runtimes/control-plane/app.py`). There is no `failed` state. A non-zero
shell exit also surfaces as `status: 'error'` with the message in
`error`; per-step output lives in `result`.

## Verifying

Send via API:

```bash
curl -s http://localhost:3000/api/v1/prediction/<chatflow-id> \
  -H 'content-type: application/json' \
  -d '{"question":"run the terminal agent demo","overrideConfig":{"session_id":"demo-1"}}'
```

Expected: a final answer that includes the canned scenario's stdout and a
zero exit code.
