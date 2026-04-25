#!/usr/bin/env bash
# Tear down an operator-managed OpenClawInstance and its operator-owned pods.
#
# Operator-first rule (docs/operator-gap-analysis.md): instance deletion must
# happen through the operator's CR, not direct kubectl-delete-pod. The
# operator owns the gateway/service/storage cleanup. This script wraps the
# canonical delete path so demos can drop pods reliably between runs.
#
# Usage:
#   APPLY=1 ./scripts/teardown-openclaw-instance.sh
#   APPLY=1 INSTANCE_NAME=foo INSTANCE_NAMESPACE=default \
#     ./scripts/teardown-openclaw-instance.sh
#   ./scripts/teardown-openclaw-instance.sh   # dry-run, prints commands
#
# Optional knobs:
#   ALSO_DELETE_SECRET=1   delete the referenced Secret too
#   ALSO_DELETE_PVCS=1     delete leftover PVCs labelled by the operator
#   WAIT_TIMEOUT_SECONDS   how long to wait for finalizers (default 180)
set -euo pipefail

INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
INSTANCE_NAMESPACE="${INSTANCE_NAMESPACE:-default}"
SECRET_NAME="${SECRET_NAME:-intel-demo-operator-secrets}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
ALSO_DELETE_SECRET="${ALSO_DELETE_SECRET:-0}"
ALSO_DELETE_PVCS="${ALSO_DELETE_PVCS:-0}"
APPLY="${APPLY:-0}"
KUBECTL="${KUBECTL:-kubectl}"

cat <<EOF
[teardown-openclaw-instance] Operator-managed instance teardown
  instance:      $INSTANCE_NAME
  namespace:     $INSTANCE_NAMESPACE
  secret:        $SECRET_NAME (delete=$ALSO_DELETE_SECRET)
  delete pvcs:   $ALSO_DELETE_PVCS
  wait timeout:  ${WAIT_TIMEOUT_SECONDS}s
  apply:         $APPLY (set APPLY=1 to actually run kubectl)
EOF

run() {
  echo "+ $*"
  if [ "$APPLY" = "1" ]; then
    "$@"
  fi
}

run_allow_fail() {
  echo "+ $*"
  if [ "$APPLY" = "1" ]; then
    "$@" || true
  fi
}

if [ "$APPLY" = "1" ]; then
  command -v "$KUBECTL" >/dev/null 2>&1 \
    || { echo "[teardown-openclaw-instance] $KUBECTL not found" >&2; exit 127; }
fi

# 1. Delete the CR. The operator owns gateway/service/pod cleanup via
#    OwnerReferences, so this is the only step that should normally be needed.
run_allow_fail "$KUBECTL" delete openclawinstance "$INSTANCE_NAME" \
  -n "$INSTANCE_NAMESPACE" \
  --ignore-not-found \
  --wait=true \
  --timeout="${WAIT_TIMEOUT_SECONDS}s"

# 2. Verify the CR is gone.
if [ "$APPLY" = "1" ]; then
  if "$KUBECTL" get openclawinstance "$INSTANCE_NAME" -n "$INSTANCE_NAMESPACE" \
        >/dev/null 2>&1; then
    echo "[teardown-openclaw-instance] WARNING: $INSTANCE_NAME still present" >&2
    echo "                              check finalizers:" >&2
    echo "                              kubectl get openclawinstance $INSTANCE_NAME -n $INSTANCE_NAMESPACE -o yaml" >&2
  else
    echo "[teardown-openclaw-instance] CR deleted."
  fi
fi

# 3. Optional: drop leftover PVCs that the operator labels for this instance.
if [ "$ALSO_DELETE_PVCS" = "1" ]; then
  run_allow_fail "$KUBECTL" delete pvc \
    -n "$INSTANCE_NAMESPACE" \
    -l "openclaw.rocks/instance=$INSTANCE_NAME" \
    --ignore-not-found
fi

# 4. Optional: drop the operator-instance Secret (created by
#    create-operator-secrets.sh). Off by default so secrets survive a
#    reset-and-recreate loop.
if [ "$ALSO_DELETE_SECRET" = "1" ]; then
  run_allow_fail "$KUBECTL" delete secret "$SECRET_NAME" \
    -n "$INSTANCE_NAMESPACE" \
    --ignore-not-found
fi

cat <<EOF

[teardown-openclaw-instance] done.
To re-create the instance:
  APPLY=1 ./scripts/create-operator-secrets.sh           # if secret was dropped
  $KUBECTL apply -f examples/openclawinstance-intel-demo.yaml
EOF
