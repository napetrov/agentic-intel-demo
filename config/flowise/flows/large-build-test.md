# Flow: large-build-test

Mirrors `catalog/scenarios.yaml` → `large_build_test`.

| Field | Value |
|-------|-------|
| Demo scenario | Large Build/Test |
| Execution mode | `local_large` |
| Task family | `software_engineering` |
| Backend | control-plane `POST /offload` with `task_type=shell, payload.scenario=large-build-test` |

## Important: this is not a generic remote build runner

The offload-worker's `shell` task type only runs the **allow-listed
`run.sh`** for one of `{"terminal-agent","market-research","large-build-test"}`
(see `runtimes/offload-worker/app.py` → `ALLOWED_SCENARIOS`). Free-form
clone/install/test commands authored by the LLM are rejected. This flow
therefore drives the canned `large-build-test` scenario script and uses
the LLM only to plan-around / summarize, not to author commands.

`local_large` selects the large pod profile statically at session
creation; the flow does NOT scale up at runtime. The session running this
flow must already be configured with the large profile (see
`config/pod-profiles/profiles.yaml`).

## Intent

User asks the agent to run the large build/test demo. The flow:

1. Briefly explains what the canned scenario will do (planner LLM, no tool
   call).
2. Submits `{task_type: 'shell', payload: { scenario: 'large-build-test' }}`
   to the control-plane.
3. Summarizes stdout/stderr/exit_code. On a non-zero exit, routes to the
   cloud-reasoning model for a deeper diagnosis; on success, summarizes
   with the local SLM.

## Nodes

1. **Chat Input** — built-in.
2. **Chat Model: ChatOpenAI (planner)**
   - Credential: `litellm-openai`
   - Model name: `system-b-vllm-qwen3-4b-default`
   - System prompt:
     > You are the large-build-test demo guide. Briefly tell the user the
     > canned scenario is about to run, then call the `run_scenario` tool
     > with no arguments. Do not invent commands; the worker only runs
     > the allow-listed scenario script.
3. **Custom Tool: run_scenario**
   - Input schema: `{}`
   - Body:
     ```js
     // POST /offload is synchronous: terminal status comes back on the
     // POST response. Treat `error` as the only failure status.
     const submit = await fetch(`${$vars.CONTROL_PLANE_BASE_URL}/offload`, {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({
         task_type: 'shell',
         payload: { scenario: 'large-build-test' },
         session_id: $flow.session_id || 'flowise-demo'
       })
     });
     const submitted = await submit.json();
     // The build script can run for several minutes; even though the
     // current control-plane is synchronous, give the GET loop room.
     for (let i = 0; i < 180; i++) {
       const s = await fetch(
         `${$vars.CONTROL_PLANE_BASE_URL}/offload/${submitted.job_id}`
       ).then(x => x.json());
       if (s.status === 'completed' || s.status === 'error') return s;
       await new Promise(res => setTimeout(res, 2000));
     }
     return { status: 'timeout', job_id: submitted.job_id };
     ```
4. **If/Else (or JS Function) router**
   - Inspect the tool result's `status` and (for `completed`)
     `result.exit_code`.
   - Route a successful run (`status === 'completed'` and `exit_code === 0`)
     to the fast SLM summarizer.
   - Route a failure (`status === 'error'`, or `completed` with
     `exit_code !== 0`) to the cloud-reasoning summarizer.
5. **Chat Model: ChatOpenAI (summarizer, success)**
   - Model name: `system-b-vllm-qwen3-4b-fast`
   - System prompt:
     > Summarize the build/test stdout for the user in 3 bullets. Quote
     > exit code.
6. **Chat Model: ChatOpenAI (summarizer, failure)**
   - Model name: `aws-bedrock-claude-sonnet`
   - System prompt:
     > The build/test failed. Summarize stderr, the likely root cause,
     > and one concrete next step. Quote exit code.
7. **Chat Output** — built-in.

## Wiring

```
Chat Input ─▶ planner LLM ─▶ run_scenario tool
                                  │
                          status / exit_code
                                  │
                  success ────────┼──────── failure
                     ▼                          ▼
            fast-SLM summarizer        cloud reasoning summarizer
                     │                          │
                     └──────────► Chat Output ◄─┘
```

## Variables

Same as the other flows: `CONTROL_PLANE_BASE_URL`, `LITELLM_BASE_URL`.

## Status model

Control-plane terminal states are **`completed`** and **`error`** (see
`runtimes/control-plane/app.py`). There is no `failed` state. Within a
`completed` response, a non-zero `result.exit_code` still means the build
failed — branch on both signals.

## Notes

- The large profile applies to the session running this flow, not to the
  offload-worker; the worker is sized independently. If you need the
  build to run inside the agent pod (true `local_large` semantics) rather
  than on the offload-worker, drive the canned script through OpenClaw
  instead of through Flowise. The Flowise variant runs the same script on
  the offload-worker, which is sufficient for the demo.
- For repos that need network access during the build, ensure the worker
  container has egress to the git remote. The compose default is
  wide-open egress; the k8s default depends on the cluster's NetworkPolicy.
