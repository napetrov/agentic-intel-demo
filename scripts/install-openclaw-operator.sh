#!/usr/bin/env bash
set -euo pipefail

OPERATOR_CRD_PATH="${OPERATOR_CRD_PATH:-config/crd/bases/openclawinstances.openclaw.rocks.yaml}"
OPERATOR_MANIFESTS_PATH="${OPERATOR_MANIFESTS_PATH:-config/default}"
MODE="${MODE:-server-side-crd}"

cat <<EOF
[install-openclaw-operator] Operator-first install helper

Mode: $MODE
CRD path: $OPERATOR_CRD_PATH
Manifests path: $OPERATOR_MANIFESTS_PATH

This helper documents the required safe order:
1. apply the CRD separately
2. avoid oversized last-applied annotation on the CRD
3. apply the rest of the operator manifests
4. verify controller health

Examples:
  MODE=server-side-crd OPERATOR_CRD_PATH=$OPERATOR_CRD_PATH OPERATOR_MANIFESTS_PATH=$OPERATOR_MANIFESTS_PATH ./scripts/install-openclaw-operator.sh

Suggested commands:
  kubectl apply --server-side -f "$OPERATOR_CRD_PATH"
  kubectl apply -k "$OPERATOR_MANIFESTS_PATH"
  kubectl get crd openclawinstances.openclaw.rocks
  kubectl get pods -A | grep -E 'openclaw|operator'
EOF

case "$MODE" in
  server-side-crd)
    echo "kubectl apply --server-side -f \"$OPERATOR_CRD_PATH\""
    echo "kubectl apply -k \"$OPERATOR_MANIFESTS_PATH\""
    ;;
  create-replace-crd)
    echo "kubectl create -f \"$OPERATOR_CRD_PATH\" || kubectl replace -f \"$OPERATOR_CRD_PATH\""
    echo "kubectl apply -k \"$OPERATOR_MANIFESTS_PATH\""
    ;;
  *)
    echo "[install-openclaw-operator] unknown MODE=$MODE" >&2
    exit 1
    ;;
esac
