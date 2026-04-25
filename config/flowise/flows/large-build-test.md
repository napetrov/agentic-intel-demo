# Flow: large-build-test

Mirrors `catalog/scenarios.yaml` → `large_build_test`.

| Field | Value |
|-------|-------|
| Demo scenario | Large Build/Test |
| Execution mode | `local_large` |
| Task family | `software_engineering` |
| Backend | control-plane `POST /offload` with `task_type=shell` against a session pod created from the `large` profile |

## Intent

User asks the agent to build/test a small repo. The flow:

1. Asks the local SLM to plan a build sequence (clone → install → test).
2. Issues each step as a `shell` offload against the large profile.
3. Streams the per-step result back, stops on first non-zero exit.
4. Final summary uses cloud reasoning if the run failed, local SLM if it
   succeeded.

This flow does NOT scale up the pod at runtime — `local_large` selects the
large profile statically at session creation. The flow assumes the demo
session is already configured with that profile (see
`config/pod-profiles/profiles.yaml`).

## Nodes

1. **Chat Input** — built-in.
2. **Chat Model: ChatOpenAI (planner)**
   - Credential: `litellm-openai`
   - Model name: `system-b-vllm-qwen3-4b-default`
   - System prompt:
     > Given a repo URL and a target ("build" / "test"), output a JSON
     > array of shell commands in execution order. No prose.
3. **Custom Tool: run_step**
   - Input schema: `{ "command": "string", "step_index": "number" }`
   - Body:
     ```js
     const r = await fetch(`${$vars.CONTROL_PLANE_BASE_URL}/offload`, {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({
         task_type: 'shell',
         payload: { command: $input.command, profile_hint: 'large' },
         session_id: $flow.session_id || 'flowise-demo'
       })
     });
     const submitted = await r.json();
     for (let i = 0; i < 180; i++) {  // up to 6 min per step
       const s = await fetch(
         `${$vars.CONTROL_PLANE_BASE_URL}/offload/${submitted.job_id}`
       ).then(x => x.json());
       if (s.status === 'completed' || s.status === 'failed') {
         return { ...s, step_index: $input.step_index };
       }
       await new Promise(res => setTimeout(res, 2000));
     }
     return { status: 'timeout', step_index: $input.step_index };
     ```
4. **Sequential Agent** (or a JS Function node iterating the planner output)
   - For each command in the planner's array, call `run_step`.
   - Halt on the first `status: 'failed'` or non-zero exit code.
5. **Chat Model: ChatOpenAI (summarizer)**
   - On success: `system-b-vllm-qwen3-4b-fast`
   - On failure: `aws-bedrock-claude-sonnet` (route by an If node on the
     final step's `exit_code`).
6. **Chat Output** — built-in.

## Wiring

```
Chat Input ─▶ planner LLM ─▶ Sequential Agent (run_step ×N)
                                       │
                            success ───┼──▶ summarizer (fast SLM)
                            failure ───┴──▶ summarizer (cloud reasoning)
                                                  │
                                                  ▼
                                             Chat Output
```

## Variables

Same as the other flows: `CONTROL_PLANE_BASE_URL`, `LITELLM_BASE_URL`.

## Notes

- The control-plane today exposes `task_type=shell`; `profile_hint` is a
  hint that the operator-managed session was created with the large
  profile. Until the operator wires `profile_hint` end-to-end, treat this
  as documentation: the field is forwarded to the worker but not enforced.
- For repos that need network access, ensure the worker container has
  egress to the git remote. The compose default is wide-open egress; the
  k8s default depends on the cluster's NetworkPolicy.
