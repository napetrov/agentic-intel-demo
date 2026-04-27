# Incident Recovery

How to diagnose and recover from the failures you'll actually hit during
a demo. Each section is a decision tree: start at the symptom, follow the
checks in order, stop when one of them resolves the issue.

If a check requires shell access to the control plane or a session pod,
the commands assume the Tier 2 (operator) deployment. Substitute the
docker-compose service name (`docker compose exec <svc> ...`) for the
Tier 1 path.

## Symptom: Telegram entry fails (the bot doesn't respond)

1. **Confirm the bot is connected.**
   ```bash
   kubectl logs deploy/openclaw-operator-controller-manager -n openclaw-operator-system --tail=50
   kubectl logs <operator-managed-pod> -n default --tail=50 | grep -i telegram
   ```
   Look for `telegram: connected` (or equivalent). If you see auth or
   token errors, the bot token in the secret is wrong — see
   `docs/telegram-operator-checklist.md`.
2. **Confirm the sender is allowed.** Check
   `examples/openclawinstance-intel-demo.yaml` →
   `TELEGRAM_ALLOWED_FROM`. If the chat id isn't on the list the bot
   silently ignores the message.
3. **Confirm the bot can reach Telegram.** From the operator-managed
   pod:
   ```bash
   kubectl exec -n default <operator-managed-pod> -- \
     curl -fsS https://api.telegram.org > /dev/null && echo OK
   ```
   If this fails the cluster has no egress to telegram.org — open
   firewall / proxy as needed.
4. **Last resort: restart the operator-managed pod.**
   `kubectl delete pod <operator-managed-pod> -n default`. The operator
   recreates it; the new pod re-authenticates the bot.

## Symptom: scenario starts then hangs at "Routing…"

The router can't reach LiteLLM or LiteLLM can't reach the model.

1. **Probe LiteLLM directly.**
   ```bash
   curl -fsS -H "Authorization: Bearer $LITELLM_API_KEY" \
     http://litellm.inference.svc.cluster.local:4000/health/liveliness
   ```
   - Empty / connection refused → LiteLLM pod not up.
     `kubectl get pods -n system-a` and inspect.
   - 401 → `LITELLM_API_KEY` mismatch between caller and ConfigMap.
2. **List the configured models.**
   ```bash
   curl -fsS -H "Authorization: Bearer $LITELLM_API_KEY" \
     http://litellm.inference.svc.cluster.local:4000/v1/models | jq
   ```
   The four documented aliases must be present: `fast`, `default`,
   `reasoning`, `sambanova`. If any are missing, the LiteLLM ConfigMap
   has drifted from `config/model-routing/litellm-config.yaml` — re-apply.
3. **Probe vLLM directly.**
   ```bash
   curl -fsS http://vllm.system-b.svc.cluster.local:8000/v1/models | jq
   ```
   If this fails, vLLM is down. `kubectl logs deploy/vllm -n system-b`
   usually shows OOM, model-not-found, or chart-version mismatch.
4. **Probe Bedrock.** If the scenario routes to `reasoning`, exec into
   the LiteLLM pod and try a one-shot completion against Bedrock with
   the configured `AWS_BEARER_TOKEN_BEDROCK`. Bedrock 401 means the
   bearer token is expired.

## Symptom: `local_standard` scenario fails

1. **Verify the session pod is up.** `kubectl get pods -n agents`.
   If the pod is `Pending`, scheduling failed — usually a resource
   request the cluster can't satisfy. Check `Events`.
2. **Verify the agent surface.**
   ```bash
   kubectl exec -n agents <session-pod> -- \
     curl -fsS http://localhost:8081/health
   ```
   If this 404s the session-pod template is out of date — re-apply
   the session-pod ConfigMap template (`SESSION_POD_TEMPLATE_CONFIGMAP`,
   default `session-pod-template`).
3. **Offer a session reset.** From the orchestrator: `/reset`. If the
   user is still mid-flow, suggest the scenario's `fallback_scenario`
   from the catalog (`null` for `terminal_agent` — there is no
   fallback because it IS the fallback).
4. **Offer a retry.** Same scenario id, fresh session. If it fails
   identically, the issue is in the scenario flow, not the platform —
   inspect `agents/scenarios/<id>/run.sh` for missing dependencies.

## Symptom: `local_large` scenario fails

1. **Verify the `large` profile is available.**
   ```bash
   kubectl get sessions -n agents -o wide
   curl -fsS http://control-plane.platform.svc.cluster.local:8080/sessions/profiles | jq
   ```
   Confirm the `large` profile exists and the cluster has nodes that
   can satisfy its CPU/memory requests.
2. **Inspect the Job.**
   ```bash
   kubectl describe job <session-id>-job -n agents
   kubectl logs job/<session-id>-job -n agents
   ```
   Common failures: image pull error (likely a private registry — see
   `imagePullSecret` in `docs/operator-config-checklist.md`), OOMKilled
   (bump the profile or shrink the workload).
3. **Fall back to Terminal Agent.** `large_build_test`'s
   `fallback_scenario` is `terminal_agent`. The orchestrator should
   offer it explicitly with one short message describing what changed.

## Symptom: `offload_system_b` scenario fails (offload returns error)

1. **Check the relay's view.**
   ```bash
   curl -fsS http://control-plane.platform.svc.cluster.local:8080/offload/<job_id> | jq
   ```
   - `status: "error"` with `error: "offload-worker unreachable: ..."` →
     the worker is down or unreachable. Continue to step 2.
   - `status: "error"` with a worker-side error → continue to step 3.
2. **Verify offload-worker reachability.**
   ```bash
   curl -fsS http://offload-worker.system-b.svc.cluster.local:8080/health
   kubectl get pods -n system-b -l app=offload-worker
   ```
   If readiness is failing the worker can't reach its own dependencies
   (MinIO, vLLM, etc.). `kubectl describe pod` shows the failed probe.
3. **Inspect offload-worker logs.**
   ```bash
   kubectl logs deploy/offload-worker -n system-b --tail=200
   ```
   Look for the `task_id` from the relay response; the worker logs
   every task with that id. Common causes: MinIO 403 (bucket policy or
   credentials), vLLM 5xx (model under load — check HPA), Bedrock 401
   (token expired).
4. **Offer the fallback scenario.** `market_research`'s
   `fallback_scenario` is `terminal_agent`. The orchestrator should
   surface it with the offload `job_id` for later debugging.

## Symptom: artifacts panel shows "unknown artifact ref"

The control plane only mints presigned URLs for refs it has seen come
back from `/offload`. `404 unknown artifact ref` means either:

1. The job never reported a `result_ref` (the worker never wrote one) —
   inspect the job entry: `GET /offload/{job_id}` should show
   `result_ref: null`.
2. The control-plane process restarted and the in-memory job registry
   was lost. Verify `JOBS_DB_PATH` is set to a persistent path
   (compose / dev-up sets it; bare `uvicorn` runs do NOT).
3. The MinIO key was deleted out-of-band. Confirm with
   `mc ls demo-artifacts/` (or the `:9001` MinIO console).

## Symptom: multi-agent fan-out shows "backend: probing…" forever

1. **Confirm `/sessions` actually responds.**
   ```bash
   curl -fsS http://control-plane.platform.svc.cluster.local:8080/sessions
   ```
   If this hangs or 5xx's, the `SessionBackend` could not initialise —
   check the control-plane startup logs for the `session backend: ...`
   line. If absent, the process crashed on startup; usually a missing
   `KUBECONFIG` for the kube backend.
2. **Verify backend selection.** `SESSION_BACKEND=local` runs
   in-memory. `SESSION_BACKEND=kube` requires service-account RBAC for
   `batch/v1.Jobs` in the `agents` namespace; if the SA is
   missing, every `POST /sessions` returns 502 with a kube ApiException.

## Platform-health rail interpretation

The five dots in the web demo's "Platform health" rail map directly to
the control plane's `/probe/{name}` endpoint. See `docs/health-probes.md`
for the full state table. Quick reference:

| Dot colour | Meaning | Action |
|------------|---------|--------|
| Yellow | First probe pending OR static-only mode | None |
| Green | Target healthy | None |
| Red | Target unreachable / non-2xx | Run that target's recovery section |
| Grey | No URL configured for the probe | Set the env var, or accept "not wired" |

## Last-resort checklist

If everything is on fire and you have ten minutes before the demo:

1. Switch to Tier 1: `docker compose down && docker compose up --build`.
   Tier 1 is offline-friendly and has no operator dependencies.
2. Run only `terminal_agent`. It has no offload, no LLM dependency in
   the rule classifier path, and no fallback because it IS the fallback.
3. Use the static-only walkthrough: `python3 -m http.server 8080 --directory web-demo`.
   The "Run demo" button has a scripted-fallback path that runs without
   any backend at all.
