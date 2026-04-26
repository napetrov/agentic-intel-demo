#!/usr/bin/env bash
# Operator-managed instance lifecycle smoke test.
#
# Exercises the full operator-first contract:
#   1. CRD + controller exist and are healthy
#   2. apply examples/openclawinstance-intel-demo.yaml
#   3. wait until the instance reaches a Ready-like state
#   4. (optional) probe the gateway service
#   5. tear the instance down via teardown-openclaw-instance.sh (operator-owned)
#
# This is the canonical "is the operator demo path actually working" check.
#
# Usage:
#   APPLY=1 ./scripts/smoke-test-operator-instance.sh           # full lifecycle
#   APPLY=1 KEEP=1 ./scripts/smoke-test-operator-instance.sh    # leave instance running
#   ./scripts/smoke-test-operator-instance.sh                   # dry-run, prints commands
#
# Knobs:
#   INSTANCE_NAME, INSTANCE_NAMESPACE
#   INSTANCE_MANIFEST   (default examples/openclawinstance-intel-demo.yaml)
#   READY_TIMEOUT_SECONDS (default 300)
#   READY_JSONPATH      jsonpath checked for a Ready-ish value (default scans
#                       .status.phase and .status.conditions[?(@.type=="Ready")])
#   PROBE_GATEWAY=1     port-forward and curl /healthz before teardown
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
INSTANCE_NAMESPACE="${INSTANCE_NAMESPACE:-default}"
INSTANCE_MANIFEST="${INSTANCE_MANIFEST:-$REPO_ROOT/examples/openclawinstance-intel-demo.yaml}"
OPERATOR_NAMESPACE="${OPERATOR_NAMESPACE:-openclaw-operator-system}"
OPERATOR_DEPLOYMENT="${OPERATOR_DEPLOYMENT:-deploy/openclaw-operator-controller-manager}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-300}"
# When set, READY_JSONPATH is the canonical short-circuit Ready check for
# the pinned operator ref. The script polls
# `kubectl get openclawinstance ... -o jsonpath=$READY_JSONPATH` and
# treats the value as Ready when it matches a Ready-ish enum
# (Ready/Running/Active/Healthy/True). Leave unset to use the heuristic
# that scans condition=Ready then `.status.phase`. Tracked as gap #5 in
# docs/operator-gap-analysis.md.
READY_JSONPATH="${READY_JSONPATH:-}"
PROBE_GATEWAY="${PROBE_GATEWAY:-0}"
KEEP="${KEEP:-0}"
APPLY="${APPLY:-0}"
KUBECTL="${KUBECTL:-kubectl}"

cat <<EOF
[smoke-test-operator-instance] Operator-managed lifecycle smoke
  instance:        $INSTANCE_NAME
  namespace:       $INSTANCE_NAMESPACE
  manifest:        $INSTANCE_MANIFEST
  ready timeout:   ${READY_TIMEOUT_SECONDS}s
  probe gateway:   $PROBE_GATEWAY
  keep on success: $KEEP
  apply:           $APPLY (set APPLY=1 to actually run kubectl)
EOF

run() {
  echo "+ $*"
  if [ "$APPLY" = "1" ]; then
    "$@"
  fi
}

if [ "$APPLY" = "1" ]; then
  command -v "$KUBECTL" >/dev/null 2>&1 \
    || { echo "[smoke-test-operator-instance] $KUBECTL not found" >&2; exit 127; }
  if [ ! -f "$INSTANCE_MANIFEST" ]; then
    echo "[smoke-test-operator-instance] missing manifest: $INSTANCE_MANIFEST" >&2
    exit 2
  fi
fi

# 1. Prereqs: CRD + controller deployment.
run "$KUBECTL" get crd openclawinstances.openclaw.rocks
run "$KUBECTL" -n "$OPERATOR_NAMESPACE" rollout status \
  "$OPERATOR_DEPLOYMENT" --timeout=60s

# 2. Apply the instance manifest. Idempotent. Pin the namespace explicitly so
#    the apply lands where wait/probe/teardown expect it, even if the manifest
#    omits metadata.namespace and the current kube-context default differs.
run "$KUBECTL" apply -n "$INSTANCE_NAMESPACE" -f "$INSTANCE_MANIFEST"

# 3. Wait for Ready. If READY_JSONPATH is supplied, poll that one path
#    (canonical for the pinned operator ref). Otherwise try
#    --for=condition=Ready and fall back to a `.status.phase` heuristic.
wait_ready_jsonpath() {
  local deadline=$(( $(date +%s) + READY_TIMEOUT_SECONDS ))
  local val=""
  echo "[smoke-test-operator-instance] polling READY_JSONPATH=$READY_JSONPATH"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    val="$("$KUBECTL" get openclawinstance "$INSTANCE_NAME" \
              -n "$INSTANCE_NAMESPACE" \
              -o jsonpath="$READY_JSONPATH" 2>/dev/null || true)"
    case "$val" in
      Ready|Running|Active|Healthy|True|true)
        echo "[smoke-test-operator-instance] READY_JSONPATH=$val"
        return 0
        ;;
      Failed|Error|CrashLoopBackOff)
        echo "[smoke-test-operator-instance] terminal failure READY_JSONPATH=$val" >&2
        return 1
        ;;
    esac
    sleep 5
  done
  echo "[smoke-test-operator-instance] timeout waiting for READY_JSONPATH (last=${val:-unknown})" >&2
  return 1
}

wait_ready() {
  local deadline=$(( $(date +%s) + READY_TIMEOUT_SECONDS ))
  local phase=""
  if [ -n "$READY_JSONPATH" ]; then
    wait_ready_jsonpath
    return $?
  fi
  echo "[smoke-test-operator-instance] waiting for $INSTANCE_NAME to become Ready"
  if "$KUBECTL" wait \
      --for=condition=Ready \
      --timeout="${READY_TIMEOUT_SECONDS}s" \
      "openclawinstance/$INSTANCE_NAME" \
      -n "$INSTANCE_NAMESPACE" 2>/dev/null; then
    return 0
  fi
  echo "[smoke-test-operator-instance] Ready condition not surfaced; falling back to .status.phase poll"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    phase="$("$KUBECTL" get openclawinstance "$INSTANCE_NAME" \
              -n "$INSTANCE_NAMESPACE" \
              -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    case "$phase" in
      Ready|Running|Active|Healthy)
        echo "[smoke-test-operator-instance] phase=$phase"
        return 0
        ;;
      Failed|Error|CrashLoopBackOff)
        echo "[smoke-test-operator-instance] terminal failure phase=$phase" >&2
        return 1
        ;;
    esac
    sleep 5
  done
  echo "[smoke-test-operator-instance] timeout waiting for Ready (last phase=${phase:-unknown})" >&2
  return 1
}

if [ "$APPLY" = "1" ]; then
  if ! wait_ready; then
    echo "[smoke-test-operator-instance] instance failed to become Ready; collecting diagnostics" >&2
    "$KUBECTL" describe openclawinstance "$INSTANCE_NAME" -n "$INSTANCE_NAMESPACE" >&2 || true
    "$KUBECTL" -n "$OPERATOR_NAMESPACE" logs "$OPERATOR_DEPLOYMENT" --tail=200 >&2 || true
    "$KUBECTL" get pods -n "$INSTANCE_NAMESPACE" \
      -l "openclaw.rocks/instance=$INSTANCE_NAME" >&2 || true
    exit 1
  fi
else
  echo "+ $KUBECTL wait --for=condition=Ready --timeout=${READY_TIMEOUT_SECONDS}s openclawinstance/$INSTANCE_NAME -n $INSTANCE_NAMESPACE"
fi

# 4. Optional gateway probe. Skips silently if no gateway service is found.
probe_gateway() {
  local svc
  svc="$("$KUBECTL" get svc -n "$INSTANCE_NAMESPACE" \
          -l "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=gateway" \
          -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -z "$svc" ]; then
    echo "[smoke-test-operator-instance] no gateway service found; skipping probe"
    return 0
  fi
  echo "[smoke-test-operator-instance] probing gateway service: $svc"
  "$KUBECTL" -n "$INSTANCE_NAMESPACE" port-forward "svc/$svc" 18789:18789 >/dev/null &
  local pf_pid=$!
  trap 'kill "$pf_pid" 2>/dev/null || true' RETURN
  sleep 2
  curl -fsS --max-time 5 http://127.0.0.1:18789/healthz \
    || { echo "[smoke-test-operator-instance] gateway healthz failed" >&2; return 1; }
  echo "[smoke-test-operator-instance] gateway healthz OK"
}

if [ "$PROBE_GATEWAY" = "1" ] && [ "$APPLY" = "1" ]; then
  probe_gateway
fi

# 5. Teardown unless KEEP=1.
if [ "$KEEP" = "1" ]; then
  echo "[smoke-test-operator-instance] KEEP=1, leaving $INSTANCE_NAME running"
  echo "                              tear down later with:"
  echo "                              APPLY=1 ./scripts/teardown-openclaw-instance.sh"
  exit 0
fi

run env \
  APPLY="$APPLY" \
  INSTANCE_NAME="$INSTANCE_NAME" \
  INSTANCE_NAMESPACE="$INSTANCE_NAMESPACE" \
  KUBECTL="$KUBECTL" \
  "$REPO_ROOT/scripts/teardown-openclaw-instance.sh"

echo "[smoke-test-operator-instance] lifecycle OK"
