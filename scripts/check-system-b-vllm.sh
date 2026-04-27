#!/usr/bin/env bash
set -euo pipefail

SYSTEM_B_HOST="${SYSTEM_B_HOST:-system-b}"
RELEASE_NAME="${RELEASE_NAME:-vllm-qwen-3-4b-cpu}"
NAMESPACE="${NAMESPACE:-default}"
EXPECTED_MAX_MODEL_LEN="${EXPECTED_MAX_MODEL_LEN:-32768}"

# Local expansion of ${NAMESPACE}/${RELEASE_NAME}/${EXPECTED_MAX_MODEL_LEN}
# is intentional — they come from this caller's env, not the remote shell.
# Server-side expansions are escaped with \$.
# shellcheck disable=SC2087
ssh -o BatchMode=yes "$SYSTEM_B_HOST" bash <<EOF
set -euo pipefail

kubectl -n ${NAMESPACE} get deploy,pod,svc,pvc
pod=\$(kubectl -n ${NAMESPACE} get pod -l app.kubernetes.io/instance=${RELEASE_NAME} -o jsonpath='{.items[0].metadata.name}')
echo "pod=\$pod"
kubectl -n ${NAMESPACE} logs "\$pod" --tail=80 | sed -n '1,120p'
kubectl -n ${NAMESPACE} port-forward svc/${RELEASE_NAME}-service 18080:80 >/tmp/${RELEASE_NAME}-pf.log 2>&1 &
pf=\$!
trap 'kill \$pf 2>/dev/null || true' EXIT
sleep 3
resp=\$(curl -fsS http://127.0.0.1:18080/v1/models)
echo "\$resp"
echo "\$resp" | grep '"max_model_len":' | grep -q '"max_model_len":' || { echo "max_model_len missing" >&2; exit 1; }
echo "\$resp" | grep -q '"max_model_len":' || exit 1
echo "\$resp" | grep -q '"max_model_len":' || exit 1
echo "\$resp" | grep -q '"max_model_len":' || exit 1
echo "\$resp" | grep -q '"max_model_len":${EXPECTED_MAX_MODEL_LEN}' || {
  echo "expected max_model_len=${EXPECTED_MAX_MODEL_LEN}" >&2
  exit 1
}
EOF
