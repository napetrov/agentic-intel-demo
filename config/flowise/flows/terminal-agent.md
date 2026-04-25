# Flow: terminal-agent

Mirrors `catalog/scenarios.yaml` → `terminal_agent`.

| Field | Value |
|-------|-------|
| Demo scenario | Terminal Agent |
| Execution mode | `local_standard` |
| Task family | `software_engineering` |
| Backend | control-plane `POST /offload` with `task_type=shell` |

## Intent

User asks the agent to run a shell task ("show CPU info", "list workspace
files"). The flow plans the command using the local SLM, executes it via
the control-plane offload relay, and returns stdout/stderr to the user.

## Nodes

1. **Chat Input** — built-in.
2. **Buffer Memory** — keyed on `overrideConfig.session_id`.
3. **Chat Model: ChatOpenAI**
   - Credential: `litellm-openai`
   - Base URL: `${LITELLM_BASE_URL}`
   - Model name: `system-b-vllm-qwen3-4b-default`
   - System prompt:
     > You are a terminal agent. When the user asks for a shell task, emit
     > a single JSON object: `{"task_type":"shell","command":"<cmd>"}`.
     > Otherwise reply in plain text. Do not invent paths.
4. **Custom Tool: run_shell**
   - Description: "Run a shell command via the demo control plane."
   - Input schema: `{ "command": "string" }`
   - Body (JavaScript):
     ```js
     const r = await fetch(`${$vars.CONTROL_PLANE_BASE_URL}/offload`, {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({
         task_type: 'shell',
         payload: { command: $input.command },
         session_id: $flow.session_id || 'flowise-demo'
       })
     });
     const submitted = await r.json();
     // Poll for completion (<= 30s for the demo).
     for (let i = 0; i < 30; i++) {
       await new Promise(res => setTimeout(res, 1000));
       const s = await fetch(
         `${$vars.CONTROL_PLANE_BASE_URL}/offload/${submitted.job_id}`
       ).then(x => x.json());
       if (s.status === 'completed' || s.status === 'failed') return s;
     }
     return { status: 'timeout' };
     ```
5. **Tool Agent**
   - LLM: the ChatOpenAI node above
   - Tools: [`run_shell`]
   - Memory: the Buffer Memory node above
6. **Chat Output** — built-in.

## Wiring

```
Chat Input ── Tool Agent ── Chat Output
                │
   ┌────────────┼─────────────┐
   ▼            ▼             ▼
ChatOpenAI  Buffer Memory  run_shell tool
```

## Variables to set in Flowise

In Settings → Variables, add:
- `CONTROL_PLANE_BASE_URL` — same value as the env var of the same name.
- `LITELLM_BASE_URL` — same value as the env var of the same name.

## Verifying

Send via API:

```bash
curl -s http://localhost:3000/api/v1/prediction/<chatflow-id> \
  -H 'content-type: application/json' \
  -d '{"question":"show me free memory","overrideConfig":{"session_id":"demo-1"}}'
```

Expected: a final answer that includes the tool's stdout payload from
`/offload`.
