# First Green Path

This is the shortest path to the first fully green operator-managed OpenClaw instance.

## Goal

Get to this state:
- operator installed
- CRD applied safely
- controller healthy
- secrets applied
- `OpenClawInstance` applied
- instance becomes healthy enough to handle a Telegram message

## Step 1 — Pin and install the operator

Use a pinned operator source/ref and apply the CRD separately.

Required outcome:
- `openclawinstances.openclaw.rocks` exists
- controller pod is Running

## Step 2 — Apply the operator-managed secret contract

Fill and apply:
- `k8s/shared/intel-demo-operator-secrets.yaml.template`

Required outcome:
- Telegram token present
- Bedrock token present if used
- SambaNova token present if used
- MinIO credentials present if used

## Step 3 — Validate the instance spec against the real CRD

Apply:
- `examples/openclawinstance-intel-demo.yaml`

Required outcome:
- manifest is accepted by the live CRD without schema errors

## Step 4 — Verify instance runtime health

Check:
- instance status
- operator logs
- operator-managed pod logs
- runtime env injection for secrets

Required outcome:
- instance moves beyond `Provisioning`
- runtime has expected token/env values

## Step 5 — Send one Telegram message

From the allowed account, send one simple test message.

Required outcome:
- message reaches the instance
- agent produces a response back to Telegram

## First green definition

The path is green only when Step 5 passes.

Everything before that is preparation, not proof.
