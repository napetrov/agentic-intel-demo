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
# Default ref pinned to the latest upstream release as a candidate
# (see config/versions.yaml `operator.ref`). Override via the env when
# you've validated a different tag/SHA against your stand. The previous
# default (`main`) was reproducibly unstable.
OPENCLAW_OPERATOR_REF="${OPENCLAW_OPERATOR_REF:-v0.30.0}"

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
elif [ -z "${OPENCLAW_OPERATOR_REF_VERIFIED:-}" ]; then
  # The default (v0.30.0) is the latest upstream release at repo-pin
  # time but has not been re-validated against this demo on every bump.
  # Set OPENCLAW_OPERATOR_REF_VERIFIED=1 (or pin a different ref you've
  # tested) to silence this notice. Tracked as gap #1 in
  # docs/operator-gap-analysis.md.
  echo "[install-openclaw-operator] NOTE: using upstream candidate ref ${OPENCLAW_OPERATOR_REF}." >&2
  echo "                            Validate against your stand and either set" >&2
  echo "                            OPENCLAW_OPERATOR_REF_VERIFIED=1 or pin OPENCLAW_OPERATOR_REF=<tag>." >&2
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
# `git clone` without --depth fetches all refs, so any tag/branch/commit
# reachable from a branch is already present. No extra `git fetch` needed;
# that also avoids the portability issue of fetching a bare commit SHA
# against servers that don't allow uploadpack.allowReachableSHA1InWant.
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

# The documented safe install order applies the CRD separately with
# --server-side (above) to avoid the "metadata.annotations: Too long"
# failure caused by a client-side last-applied annotation on the CRD. If
# $MANIFESTS_FULL still references ../crd, the next `kubectl apply -k` will
# re-apply the CRD via client-side apply and reintroduce that failure.
# Fail fast with a pointer to choose an overlay that excludes the CRD.
if [ "$APPLY" = "1" ] && [ -f "$MANIFESTS_FULL/kustomization.yaml" ] \
    && grep -Eq '(^|[[:space:]-])\.\./crd([/[:space:]]|$)' "$MANIFESTS_FULL/kustomization.yaml"; then
  echo "[install-openclaw-operator] manifests path still includes ../crd: $MANIFESTS_FULL" >&2
  echo "                            the CRD would be re-applied client-side and likely" >&2
  echo "                            hit the last-applied annotation size limit." >&2
  echo "                            Point OPERATOR_MANIFESTS_PATH at an overlay without the CRD." >&2
  exit 3
fi

run "$KUBECTL" apply -k "$MANIFESTS_FULL"
run "$KUBECTL" get crd openclawinstances.openclaw.rocks
run "$KUBECTL" -n openclaw-operator-system rollout status \
  deploy/openclaw-operator-controller-manager --timeout=180s

cat <<EOF

[install-openclaw-operator] done.
Next steps (operator-first lifecycle):
  1. Create secrets:   APPLY=1 TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... \\
                         SAMBANOVA_API_KEY=... MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \\
                         ./scripts/create-operator-secrets.sh
  2. Smoke-test:       APPLY=1 ./scripts/smoke-test-operator-instance.sh
                       (or KEEP=1 to leave the instance running for the demo)
  3. Tear down:        APPLY=1 ./scripts/teardown-openclaw-instance.sh
  4. Verify any time:  $KUBECTL get openclawinstance -A
EOF
