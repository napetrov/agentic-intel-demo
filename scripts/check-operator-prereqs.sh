#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
[check-operator-prereqs] OpenClaw operator prerequisites checklist

Required before expecting operator-managed OpenClawInstance to work:

1. Cluster access
   - kubectl is installed on the actual host/context used for cluster operations
   - kubeconfig works for the target cluster

2. CRD/controller install
   - CRD openclawinstances.openclaw.rocks exists
   - controller-manager pod is Running
   - operator namespace/RBAC/webhooks are healthy

3. Runtime inputs
   - operator-managed image is reachable by the cluster
   - required secrets already exist
   - backing endpoints (model, MinIO, Telegram, Bedrock/cloud creds) are valid

4. Instance spec
   - OpenClawInstance points to valid image, env, secrets, and service endpoints

Suggested commands:
  kubectl get crd openclawinstances.openclaw.rocks
  kubectl get pods -A | grep -E 'openclaw|operator'
  kubectl get openclawinstances -A
  kubectl describe openclawinstance -A
  kubectl logs deploy/openclaw-operator-controller-manager -n openclaw-operator-system --tail=200

If CRD install fails with annotation size error, see docs/operator-runbook.md.
EOF
