# Telegram + Token Wiring Checklist for Operator-Managed OpenClaw

This checklist is specific to the operator-managed instance path.

## What is already wired in repo

The operator-first artifacts now include:
- `TELEGRAM_BOT_TOKEN` in `k8s/shared/intel-demo-operator-secrets.yaml.template`
- Bedrock token wiring in the same operator secret template
- Telegram account config in `examples/openclawinstance-intel-demo.yaml`
- `allowFrom` and `groupAllowFrom` restrictions in the sample OpenClaw config

## What this means

On the repo side, the Telegram + token wiring has not been lost during the move to operator-first.

## What still must be checked live

A real cluster validation should confirm all of the following:

```bash
kubectl get secret intel-demo-operator-secrets -n default
kubectl get openclawinstance intel-demo-operator -n default -o yaml
kubectl get pods -A | grep -E 'intel-demo-operator|openclaw'
kubectl logs deploy/openclaw-operator-controller-manager -n openclaw-operator-system --tail=200
```

Then verify runtime-side env/config:

```bash
kubectl exec -n default <operator-managed-pod> -- printenv | grep -E 'TELEGRAM_BOT_TOKEN|AWS_BEARER_TOKEN_BEDROCK|AWS_REGION'
kubectl exec -n default <operator-managed-pod> -- sh -lc 'test -f /config/openclaw.json && sed -n "1,220p" /config/openclaw.json'
```

Then verify Telegram behavior:
- the bot is connected with the intended token
- the bot is allowed for the expected user/group
- sending a message from the allowed account triggers the agent
- the agent responds back in Telegram

## Current conclusion

Repo wiring: yes.

Live operator-managed Telegram validation: not yet re-confirmed after the operator-first refactor.
