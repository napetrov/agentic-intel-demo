# Telegram + Token Wiring Checklist for Operator-Managed OpenClaw

End-to-end checklist for getting the Telegram bot answering messages on
the operator-managed instance path. Use this for fresh setups and for
re-validation after any change to `examples/openclawinstance-intel-demo.yaml`
or `k8s/shared/intel-demo-operator-secrets.yaml.template`.

> Status: the repo wiring carries through the operator-first refactor;
> the live Tier 2 stand has not been re-validated since. Treat this
> checklist as the canonical "first time on this stand" path.

## Prerequisites

- A Tier 2 cluster reachable via `kubectl` (System A context).
  See `docs/runbooks/tier2-bring-up.md`.
- `scripts/check-tier2-environment.sh` is green.
- `scripts/check-upstream-pins.sh` is green (or you've explicitly set
  `OPENCLAW_OPERATOR_REF_VERIFIED=1` after confirming the operator
  image pulls on this stand).
- A Telegram bot token from `@BotFather`.
- The numeric Telegram chat / user id you want to whitelist (open the
  chat with the bot in a browser; the URL contains the id).

## Step 1 — render and apply the operator secret

The secret carries the bot token and the Bedrock / SambaNova / MinIO
credentials the operator-managed pod consumes via `envFromSecrets`.

```bash
export TELEGRAM_BOT_TOKEN=...        # from @BotFather
export AWS_BEARER_TOKEN_BEDROCK=...  # for the reasoning model
export SAMBANOVA_API_KEY=...         # optional, blank string if unused
export MINIO_ACCESS_KEY=...
export MINIO_SECRET_KEY=...

scripts/create-operator-secrets.sh
```

Verify (without printing values):

```bash
scripts/verify-operator-secrets.sh
kubectl get secret intel-demo-operator-secrets -n default -o jsonpath='{.data}' | jq 'keys'
```

Expected keys: `TELEGRAM_BOT_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`,
`SAMBANOVA_API_KEY`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` (template
in `k8s/shared/intel-demo-operator-secrets.yaml.template`).

## Step 2 — set the chat-id allow-list in the OpenClawInstance

Open `examples/openclawinstance-intel-demo.yaml` and update the two
allow-list places:

```yaml
spec:
  env:
    - name: TELEGRAM_ALLOWED_FROM
      value: "<your numeric chat id>"          # line 26
  config:
    openclaw.json: |
      {
        ...
        "channels": {
          "telegram": {
            "accounts": {
              "session-agent": {
                "allowFrom": ["<your numeric chat id>"],     # line 86
                "groupAllowFrom": ["<your numeric chat id>"]
              }
            }
          }
        }
      }
```

Both fields are required — the env var gates message ingest at the
operator level; the inline `allowFrom` gates which agent account
processes the message. A mismatch silently drops messages.

## Step 3 — install the operator (if not already)

```bash
scripts/install-openclaw-operator.sh
kubectl get crd openclawinstances.openclaw.rocks
kubectl get deploy -n openclaw-operator-system
```

If the operator image pull fails with `403 Forbidden` from
`ghcr.io/openclaw-rocks/openclaw:v0.30.0`, the registry is private on
this stand. Either configure an `imagePullSecret` on the
OpenClawInstance, or mirror the image to a registry the cluster can
read. Tracked as gap #4 in `docs/internal/operator-gap-analysis.md`.

## Step 4 — apply the OpenClawInstance and wait for `Running`

```bash
kubectl apply -f examples/openclawinstance-intel-demo.yaml
kubectl get openclawinstance intel-demo-operator -n default -w
```

Wait until `.status.phase == Running` (or the value declared in
`config/versions.yaml::operator_ready.phase`). The smoke test wraps
the wait:

```bash
scripts/smoke-test-operator-instance.sh
```

## Step 5 — verify env wiring inside the managed pod

Get the operator-managed pod name:

```bash
POD=$(kubectl get pods -n default -l openclaw.rocks/instance=intel-demo-operator -o jsonpath='{.items[0].metadata.name}')
```

Confirm the env vars and the rendered config:

```bash
kubectl exec -n default "$POD" -- printenv | \
  grep -E 'TELEGRAM_BOT_TOKEN|TELEGRAM_ALLOWED_FROM|AWS_BEARER_TOKEN_BEDROCK|AWS_REGION|BEDROCK_MODEL_ID'

kubectl exec -n default "$POD" -- sh -lc \
  'test -f /config/openclaw.json && head -c 4000 /config/openclaw.json'
```

Expected:
- `TELEGRAM_BOT_TOKEN` resolves to a real token (`123:ABC...` shape).
- `TELEGRAM_ALLOWED_FROM` matches the chat id you set above.
- `/config/openclaw.json` exists and the `channels.telegram.accounts.session-agent`
  block has the bot token interpolated (no literal `${TELEGRAM_BOT_TOKEN}`
  remains).

## Step 6 — verify the bot answers

From the allow-listed Telegram account:

1. `/start` — bot should reply with the demo menu (the operator chat
   config systemPrompt is what generates this; see
   `config/operator-chat-config.template.json`).
2. Tap "Terminal Agent". The bot should echo the
   `initial_user_message` from `catalog/scenarios.yaml`
   (`Starting isolated engineering demo`) verbatim and start the flow.
3. Tap "Market Research". The bot should echo
   `Starting market research demo` and submit an offload via the
   control plane.
4. Tap "Large Build/Test". The bot should echo
   `Starting large build/test demo` and start a large session.

If any echo doesn't match the catalog string character-for-character,
either `catalog/scenarios.yaml` and the operator systemPrompt have
drifted (the validator catches this — re-run
`python3 scripts/validate-demo-templates.py`), or the operator pod is
running a stale config (delete the pod to force a refresh).

## Step 7 — verify routing end-to-end

Run the demo task smoke test:

```bash
scripts/smoke-test-demo-task.sh
```

This walks: instance phase, gateway reachability, LiteLLM model list,
Telegram config presence, tool registry, env-var wiring. Failures point
at which step regressed.

## Step 8 — record the result

Add a row to `docs/versions-tested.md` under "Tier 2 (operator + k8s)"
with today's date, the operator ref/image, the LiteLLM tag, and the
smoke results. Set `OPENCLAW_OPERATOR_REF_VERIFIED=1` in the install
env going forward so the candidate-pin notice goes away.

## Failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `kubectl apply` returns CRD-not-found | operator not installed | `scripts/install-openclaw-operator.sh` |
| OpenClawInstance stays in `Pending` | image pull failure | inspect events; private registry → `imagePullSecret` |
| Bot online but ignores messages | chat id not in allow-list | step 2: update both `TELEGRAM_ALLOWED_FROM` and `allowFrom` |
| Bot echoes wrong scenario opening | catalog ↔ operator-config drift | run validator; bump operator pod |
| Bot says "model unreachable" on reasoning | Bedrock token missing/expired | re-run `scripts/create-operator-secrets.sh` with new `AWS_BEARER_TOKEN_BEDROCK` |
| Bot replies but offload scenarios time out | control-plane / offload-worker not reachable from operator pod | `docs/runbooks/incident-recovery.md` → "offload_system_b scenario fails" |

## Repo-side state (what you're starting from)

The operator-first artifacts already include:
- `TELEGRAM_BOT_TOKEN` slot in `k8s/shared/intel-demo-operator-secrets.yaml.template`
- Bedrock token slot in the same template
- Telegram account config + `allowFrom` / `groupAllowFrom` in
  `examples/openclawinstance-intel-demo.yaml`
- `TELEGRAM_ALLOWED_FROM` env on the OpenClawInstance pod
- Cross-config validator that requires the operator systemPrompt to
  reference every scenario in `catalog/scenarios.yaml`

What is NOT yet in the repo and must be filled in per stand:
- The actual bot token (operator secret)
- The actual chat id allow-list (`TELEGRAM_ALLOWED_FROM` + inline
  `allowFrom`)
- A successful live validation row in `docs/versions-tested.md`
