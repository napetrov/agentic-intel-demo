#!/usr/bin/env bash
# Install the upstream openclaw-operator into the current kube context.
#
#   APPLY=1 ./scripts/install-openclaw-operator.sh   # actually run kubectl
#   ./scripts/install-openclaw-operator.sh           # dry-run: print commands only
#
# Pin OPENCLAW_OPERATOR_REF to a tag or commit SHA in your environment (or
# CI) so reinstalls are reproducible. The default `main` is intentionally
# unstable.
set -euo pipefail

OPENCLAW_OPERATOR_REPO="${OPENCLAW_OPERATOR_REPO:-https://github.com/openclaw-rocks/openclaw-operator.git}"
OPENCLAW_OPERATOR_REF="${OPENCLAW_OPERATOR_REF:-main}"

OPERATOR_CRD_PATH="${OPERATOR_CRD_PATH:-config/crd/bases/openclawinstances.openclaw.rocks.yaml}"
OPERATOR_MANIFESTS_PATH="${OPERATOR_MANIFESTS_PATH:-config/default}"
MODE="${MODE:-server-side-crd}"
APPLY="${APPLY:-0}"
KUBECTL="${KUBECTL:-kubectl}"

case "$MODE" in
  server-side-crd|create-replace-crd) ;;
  *) echo "[install-openclaw-operator] unknown MODE=$MODE" >&2; exit 1 ;;
esac

cat <<EOF
[install-openclaw-operator] Operator-first install helper
  repo:       $OPENCLAW_OPERATOR_REPO
  ref:        $OPENCLAW_OPERATOR_REF
  CRD path:   $OPERATOR_CRD_PATH
  manifests:  $OPERATOR_MANIFESTS_PATH
  mode:       $MODE
  apply:      $APPLY (set APPLY=1 to actually run kubectl)
EOF

if [ "${OPENCLAW_OPERATOR_REF}" = "main" ]; then
  echo "[install-openclaw-operator] WARNING: OPENCLAW_OPERATOR_REF=main is not reproducible." >&2
  echo "                            Set OPENCLAW_OPERATOR_REF=<tag|commit-sha> to pin it." >&2
fi

run() {
  echo "+ $*"
  if [ "$APPLY" = "1" ]; then
    "$@"
  fi
}

if [ "$APPLY" = "1" ]; then
  command -v "$KUBECTL" >/dev/null 2>&1 \
    || { echo "[install-openclaw-operator] $KUBECTL not found" >&2; exit 127; }
  command -v git >/dev/null 2>&1 \
    || { echo "[install-openclaw-operator] git not found" >&2; exit 127; }
fi

WORKDIR="${OPERATOR_WORKDIR:-$(mktemp -d -t openclaw-operator-XXXXXX)}"
echo "[install-openclaw-operator] using workdir: $WORKDIR"
cleanup() {
  if [ "${KEEP_WORKDIR:-0}" != "1" ] && [ -z "${OPERATOR_WORKDIR:-}" ]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

run git clone "$OPENCLAW_OPERATOR_REPO" "$WORKDIR/src"
run git -C "$WORKDIR/src" fetch origin "$OPENCLAW_OPERATOR_REF"
run git -C "$WORKDIR/src" checkout "$OPENCLAW_OPERATOR_REF"

CRD_FULL="$WORKDIR/src/$OPERATOR_CRD_PATH"
MANIFESTS_FULL="$WORKDIR/src/$OPERATOR_MANIFESTS_PATH"

if [ "$APPLY" = "1" ] && [ ! -f "$CRD_FULL" ]; then
  echo "[install-openclaw-operator] CRD file missing in checkout: $CRD_FULL" >&2
  echo "                            adjust OPERATOR_CRD_PATH for this ref." >&2
  exit 2
fi

case "$MODE" in
  server-side-crd)
    run "$KUBECTL" apply --server-side -f "$CRD_FULL"
    ;;
  create-replace-crd)
    # `create` fails on an existing CRD; fall back to `replace`.
    if [ "$APPLY" = "1" ]; then
      "$KUBECTL" create -f "$CRD_FULL" 2>/dev/null \
        || "$KUBECTL" replace -f "$CRD_FULL"
    else
      echo "+ $KUBECTL create -f $CRD_FULL  || $KUBECTL replace -f $CRD_FULL"
    fi
    ;;
esac

run "$KUBECTL" apply -k "$MANIFESTS_FULL"
run "$KUBECTL" get crd openclawinstances.openclaw.rocks
run "$KUBECTL" -n openclaw-operator-system rollout status \
  deploy/openclaw-operator-controller-manager --timeout=180s

cat <<EOF

[install-openclaw-operator] done.
Next steps:
  1. Apply secrets:   $KUBECTL apply -f k8s/shared/intel-demo-operator-secrets.yaml
  2. Apply instance:  $KUBECTL apply -f examples/openclawinstance-intel-demo.yaml
  3. Verify:          $KUBECTL get openclawinstance -A
EOF
