#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
INSTANCE_NAMESPACE="${INSTANCE_NAMESPACE:-default}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"

cat <<EOF
[smoke-test-operator-instance] This script validates operator-managed instance lifecycle prerequisites.

Expected manual sequence:
1. apply operator CRD/controller safely
2. apply k8s/shared/intel-demo-operator-secrets.yaml.template with real values
3. apply examples/openclawinstance-intel-demo.yaml
4. watch the instance until it reaches a healthy state

Suggested checks:
  kubectl get crd openclawinstances.openclaw.rocks
  kubectl get openclawinstance ${INSTANCE_NAME} -n ${INSTANCE_NAMESPACE} -o yaml
  kubectl get pods -A | grep -E 'openclaw|operator|${INSTANCE_NAME}'
  kubectl describe openclawinstance ${INSTANCE_NAME} -n ${INSTANCE_NAMESPACE}
  kubectl logs deploy/openclaw-operator-controller-manager -n openclaw-operator-system --tail=200

Current timeout hint: ${TIMEOUT_SECONDS}s
EOF
