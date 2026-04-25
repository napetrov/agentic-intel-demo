# Flow: market-research

Mirrors `catalog/scenarios.yaml` → `market_research`.

| Field | Value |
|-------|-------|
| Demo scenario | Market Research |
| Execution mode | `offload_system_b` |
| Task family | `data_processing` |
| Backend | control-plane `POST /offload` with `task_type=pandas` (or `sklearn`) + `GET /artifacts/{ref}` |

## Intent

User asks for a market-research summary on a topic. The flow:

1. Decomposes the request into structured sub-tasks (using cloud reasoning).
2. Submits a pandas/sklearn offload to System B via control-plane.
3. Polls for completion, fetches the artifact, and uses the local SLM to
   summarize the result for the user.

## Nodes

1. **Chat Input** — built-in.
2. **Chat Model A: ChatOpenAI (planner)**
   - Credential: `litellm-openai`
   - Base URL: `${LITELLM_BASE_URL}`
   - Model name: `aws-bedrock-claude-sonnet`
   - System prompt:
     > Decompose the user's market-research request into a JSON object:
     > `{"topic": "...", "metrics": [...], "horizon_days": <int>}`. Output
     > JSON only.
3. **Chat Model B: ChatOpenAI (summarizer)**
   - Credential: `litellm-openai`
   - Model name: `system-b-vllm-qwen3-4b-default`
   - System prompt:
     > Summarize the offload result for a non-technical reader. Quote
     > metric names verbatim. Include the artifact URL.
4. **Custom Tool: submit_offload**
   - Description: "Submit a pandas analytics offload to System B."
   - Input schema: `{ "topic": "string", "metrics": "string[]", "horizon_days": "number" }`
   - Body:
     ```js
     const r = await fetch(`${$vars.CONTROL_PLANE_BASE_URL}/offload`, {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({
         task_type: 'pandas',
         payload: {
           script: 'market_research_v1',
           inputs: {
             topic: $input.topic,
             metrics: $input.metrics,
             horizon_days: $input.horizon_days
           }
         },
         session_id: $flow.session_id || 'flowise-demo'
       })
     });
     return r.json();   // { job_id, status, session_id }
     ```
5. **Custom Tool: poll_and_fetch**
   - Description: "Poll a job to completion and return the artifact body."
   - Input schema: `{ "job_id": "string" }`
   - Body:
     ```js
     for (let i = 0; i < 60; i++) {
       const s = await fetch(
         `${$vars.CONTROL_PLANE_BASE_URL}/offload/${$input.job_id}`
       ).then(x => x.json());
       if (s.status === 'completed') {
         if (s.result_ref) {
           const a = await fetch(
             `${$vars.CONTROL_PLANE_BASE_URL}/artifacts/${s.result_ref}`
           ).then(x => x.json());
           return { result: s.result, artifact: a };
         }
         return { result: s.result, artifact: null };
       }
       if (s.status === 'failed') return s;
       await new Promise(res => setTimeout(res, 2000));
     }
     return { status: 'timeout' };
     ```
6. **Tool Agent**
   - LLM: the planner ChatOpenAI
   - Tools: [`submit_offload`, `poll_and_fetch`]
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

## Verifying

```bash
curl -s http://localhost:3000/api/v1/prediction/<chatflow-id> \
  -H 'content-type: application/json' \
  -d '{"question":"summarize EU AI chip startups Q1","overrideConfig":{"session_id":"demo-2"}}'
```

Expected: a free-text summary that names the topic and metrics, plus a
follow-up message containing the artifact URL.
