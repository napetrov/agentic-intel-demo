# Flow: market-research

Mirrors `catalog/scenarios.yaml` → `market_research`.

| Field | Value |
|-------|-------|
| Demo scenario | Market Research |
| Execution mode | `offload_system_b` |
| Task family | `data_processing` |
| Backend | control-plane `POST /offload` with `task_type=pandas_describe` (analytics) **or** `task_type=shell, payload.scenario=market-research` (canned scenario script) + `GET /artifacts/{ref}` when an artifact is returned |

## Two valid offload paths

The offload-worker recognizes:
- `pandas_describe` — caller-provided `data` (list of dicts or CSV string),
  worker returns `df.describe()` JSON.
- `sklearn_train` — caller-provided `X`, `y`, worker returns CV scores.
- `shell` with `payload.scenario` in
  `{"terminal-agent","market-research","large-build-test"}` — runs the
  canned scenario `run.sh` and returns stdout/stderr/exit_code.

Generic `pandas` / free-form scripts are **not** valid task types and are
rejected by the worker (see `runtimes/offload-worker/app.py:dispatch`).
The flow below uses `pandas_describe` as the analytics path because it
demonstrates the full offload contract end-to-end with structured input.

## Intent

User asks for a market-research summary on a topic. The flow:

1. Decomposes the request and prepares a small synthetic dataset using
   cloud reasoning (the planner LLM).
2. Submits `task_type='pandas_describe'` to the control-plane with that
   dataset as `payload.data`.
3. Reads the returned describe-JSON inline (the worker returns small
   results inline; large results land in MinIO and surface as `result_ref`).
4. The local SLM summarizes the metrics for the user.

## Nodes

1. **Chat Input** — built-in.
2. **Chat Model A: ChatOpenAI (planner)**
   - Credential: `litellm-openai`
   - Base URL: `${LITELLM_BASE_URL}`
   - Model name: `reasoning`
   - System prompt:
     > Decompose the user's market-research request into a JSON object:
     > `{"topic":"...","data":[{ "metric":"...", "value":<number>, ... }, ...]}`.
     > `data` MUST be a list of dicts with at least one numeric column.
     > Output JSON only.
3. **Chat Model B: ChatOpenAI (summarizer)**
   - Credential: `litellm-openai`
   - Model name: `default`
   - System prompt:
     > Summarize the offload result for a non-technical reader. Quote
     > metric names verbatim. If an artifact URL is present, include it.
4. **Custom Tool: submit_offload**
   - Description: "Submit a pandas_describe analytics offload to System B."
   - Input schema: `{ "topic": "string", "data": "object[]" }`
   - Body:
     ```js
     // POST /offload is synchronous: the response already carries the
     // terminal status (`completed` or `error`).
     const r = await fetch(`${$vars.CONTROL_PLANE_BASE_URL}/offload`, {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({
         task_type: 'pandas_describe',
         payload: { data: $input.data },
         session_id: $flow.session_id || 'flowise-demo'
       })
     });
     return r.json();   // { job_id, status, session_id }
     ```
5. **Custom Tool: fetch_result**
   - Description: "Read a job's result; if the worker returned an artifact ref, presign and return its URL."
   - Input schema: `{ "job_id": "string" }`
   - Body:
     ```js
     // Defensive poll — POST /offload was synchronous, so the first GET
     // is normally already terminal. Treat `error` as a terminal state
     // (the control plane never sets `failed`).
     for (let i = 0; i < 60; i++) {
       const s = await fetch(
         `${$vars.CONTROL_PLANE_BASE_URL}/offload/${$input.job_id}`
       ).then(x => x.json());
       if (s.status === 'completed') {
         if (s.result_ref) {
           const a = await fetch(
             `${$vars.CONTROL_PLANE_BASE_URL}/artifacts/${s.result_ref}`
           ).then(x => x.json());
           return { status: s.status, result: s.result, artifact: a };
         }
         return { status: s.status, result: s.result, artifact: null };
       }
       if (s.status === 'error') return s;
       await new Promise(res => setTimeout(res, 2000));
     }
     return { status: 'timeout' };
     ```
6. **Tool Agent**
   - LLM: the planner ChatOpenAI
   - Tools: [`submit_offload`, `fetch_result`]
7. **LLM Chain** — feed the agent's tool result + original question into
   the summarizer ChatOpenAI.
8. **Chat Output** — built-in.

## Wiring

```
Chat Input
    │
    ▼
Tool Agent (planner LLM + 2 tools) ── tool result ──▶ LLM Chain (summarizer)
                                                            │
                                                            ▼
                                                       Chat Output
```

## Variables

Same as `terminal-agent.md`: `CONTROL_PLANE_BASE_URL`, `LITELLM_BASE_URL`.

## Status model

Control-plane terminal states are **`completed`** and **`error`** (see
`runtimes/control-plane/app.py`). There is no `failed` state.

## Verifying

```bash
curl -s http://localhost:3000/api/v1/prediction/<chatflow-id> \
  -H 'content-type: application/json' \
  -d '{"question":"summarize EU AI chip startups Q1","overrideConfig":{"session_id":"demo-2"}}'
```

Expected: a free-text summary that names the topic and metrics, plus the
describe-statistics inline. If you switch the flow to the canned scenario
path (`task_type='shell', payload.scenario='market-research'`), expect
the worker's `run.sh` stdout instead.
