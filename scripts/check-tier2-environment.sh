#!/usr/bin/env bash
# Preflight: verify the workstation can actually drive a Tier 2 deploy.
#
# This script answers the very first question every Tier 2 walk-through
# stumbles on:
#   "Do I have kubectl, the right kubeconfig, and reachable system-a /
#    system-b contexts on THIS host, before I start applying secrets?"
#
# It is read-only — every check is a `kubectl ... --request-timeout` /
# tool-presence probe. It never reads Secret values, never writes
# manifests, never calls APPLY=1.
#
# Usage:
#   ./scripts/check-tier2-environment.sh                 # both contexts
#   SCOPE=system-a ./scripts/check-tier2-environment.sh  # only system-a
#   SCOPE=system-b ./scripts/check-tier2-environment.sh  # only system-b
#   FAIL_FAST=1 ./scripts/check-tier2-environment.sh     # exit non-zero on first fail
#
# Knobs:
#   SYSTEM_A_CONTEXT (default: system-a)
#   SYSTEM_B_CONTEXT (default: system-b)
#   REQUEST_TIMEOUT  (default: 5s — passed to `kubectl --request-timeout`)
#
# Exit codes:
#   0  all checks passed
#   1  at least one required check failed
#   2  invalid SCOPE
set -uo pipefail

SCOPE="${SCOPE:-all}"
SYSTEM_A_CONTEXT="${SYSTEM_A_CONTEXT:-system-a}"
SYSTEM_B_CONTEXT="${SYSTEM_B_CONTEXT:-system-b}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-5s}"
FAIL_FAST="${FAIL_FAST:-0}"

case "$SCOPE" in
  all|system-a|system-b) ;;
  *) echo "[check-tier2-environment] unknown SCOPE=$SCOPE (use all|system-a|system-b)" >&2; exit 2 ;;
esac

FAIL_COUNT=0
WARN_COUNT=0

ok()   { printf '  [ok]    %s\n' "$1"; }
warn() { printf '  [warn]  %s\n' "$1"; WARN_COUNT=$((WARN_COUNT+1)); }
fail() {
  printf '  [FAIL]  %s\n' "$1"
  FAIL_COUNT=$((FAIL_COUNT+1))
  if [ "$FAIL_FAST" = "1" ]; then
    summary
    exit 1
  fi
}

summary() {
  echo
  echo "[check-tier2-environment] summary: $FAIL_COUNT failure(s), $WARN_COUNT warning(s)"
}

echo "[check-tier2-environment] scope=$SCOPE"
echo "  system-a context: $SYSTEM_A_CONTEXT"
echo "  system-b context: $SYSTEM_B_CONTEXT"
echo

# 1. Tools present on this host.
echo "[1/5] Tools on the deploy workstation"
if command -v kubectl >/dev/null 2>&1; then
  ok "kubectl $(kubectl version --client -o yaml 2>/dev/null | awk -F': ' '/gitVersion/{print $2; exit}')"
else
  fail "kubectl not on PATH — install kubectl (>=1.28) on the host that drives the demo. See docs/reproducibility.md."
fi
for tool in git curl envsubst; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool present"
  else
    fail "$tool not on PATH — required by Tier 2 (envsubst ships with the gettext package)"
  fi
done
for tool in helm aws jq; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool present (optional)"
  else
    warn "$tool not on PATH — only needed for $(case "$tool" in helm) echo "vLLM helm bring-up" ;; aws) echo "MinIO/S3 artifact tests" ;; jq) echo "nicer log filtering" ;; esac)"
  fi
done

# Bail early if kubectl is missing — the rest of the checks need it.
if ! command -v kubectl >/dev/null 2>&1; then
  echo
  echo "[check-tier2-environment] kubectl is the minimum requirement; stopping further checks."
  summary
  exit 1
fi

# 2. kubeconfig sanity — at least one config file and the requested
#    contexts are listed. We don't assume KUBECONFIG points anywhere
#    specific; `kubectl config get-contexts` reflects the merged view.
echo
echo "[2/5] kubeconfig + contexts"
contexts="$(kubectl config get-contexts -o name 2>/dev/null || true)"
if [ -z "$contexts" ]; then
  fail "kubectl config get-contexts returned no contexts — set KUBECONFIG or merge your contexts."
else
  ok "$(printf '%s\n' "$contexts" | wc -l | tr -d ' ') context(s) visible to kubectl"
fi

context_present() {
  printf '%s\n' "$contexts" | grep -Fxq "$1"
}

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; then
  if context_present "$SYSTEM_A_CONTEXT"; then
    ok "context '$SYSTEM_A_CONTEXT' is present"
  else
    fail "context '$SYSTEM_A_CONTEXT' is missing — Makefile/scripts pin --context $SYSTEM_A_CONTEXT. Either rename your context or override SYSTEM_A_KUBECTL=...."
  fi
fi
if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-b" ]; then
  if context_present "$SYSTEM_B_CONTEXT"; then
    ok "context '$SYSTEM_B_CONTEXT' is present"
  else
    fail "context '$SYSTEM_B_CONTEXT' is missing — Makefile/scripts pin --context $SYSTEM_B_CONTEXT. Either rename your context or override SYSTEM_B_KUBECTL=...."
  fi
fi

# 3. API reachability per scope. `kubectl version --short` round-trips
#    the API server cheaply; anything else (cluster-info, get ns) takes
#    longer to fail on a misrouted endpoint.
echo
echo "[3/5] API reachability"
probe_api() {
  local ctx="$1"
  if ! context_present "$ctx"; then
    return 0  # already failed in step 2
  fi
  if kubectl --context "$ctx" --request-timeout="$REQUEST_TIMEOUT" \
       version -o yaml >/dev/null 2>&1; then
    ok "API for context '$ctx' responds"
  else
    fail "API for context '$ctx' did not respond within $REQUEST_TIMEOUT — check VPN, kubeconfig server URL, node firewall."
  fi
}
if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; then
  probe_api "$SYSTEM_A_CONTEXT"
fi
if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-b" ]; then
  probe_api "$SYSTEM_B_CONTEXT"
fi

# 4. Namespaces the deploy assumes already / will create.
echo
echo "[4/5] Namespace presence (informational)"
probe_ns() {
  local ctx="$1"; shift
  if ! context_present "$ctx"; then
    return 0
  fi
  for ns in "$@"; do
    if kubectl --context "$ctx" --request-timeout="$REQUEST_TIMEOUT" \
         get ns "$ns" >/dev/null 2>&1; then
      ok "context=$ctx ns/$ns exists"
    else
      warn "context=$ctx ns/$ns missing — create-operator-secrets.sh / manifests will create it on first apply"
    fi
  done
}
if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; then
  probe_ns "$SYSTEM_A_CONTEXT" default inference agents openclaw-operator-system
fi
if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-b" ]; then
  probe_ns "$SYSTEM_B_CONTEXT" system-b
fi

# 5. CRD + controller presence (System A only). Pure informational —
#    install-openclaw-operator.sh is what creates these. We surface the
#    state so a deployer can tell where in the bring-up they actually are.
echo
echo "[5/5] Operator install state on $SYSTEM_A_CONTEXT (informational)"
if { [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; } && context_present "$SYSTEM_A_CONTEXT"; then
  if kubectl --context "$SYSTEM_A_CONTEXT" --request-timeout="$REQUEST_TIMEOUT" \
       get crd openclawinstances.openclaw.rocks >/dev/null 2>&1; then
    ok "CRD openclawinstances.openclaw.rocks installed"
  else
    warn "CRD openclawinstances.openclaw.rocks not installed yet — run scripts/install-openclaw-operator.sh"
  fi
  if kubectl --context "$SYSTEM_A_CONTEXT" --request-timeout="$REQUEST_TIMEOUT" \
       -n openclaw-operator-system get deploy openclaw-operator-controller-manager >/dev/null 2>&1; then
    ok "controller deployment exists"
  else
    warn "controller deployment missing — run scripts/install-openclaw-operator.sh"
  fi
else
  ok "skipped (scope=$SCOPE / context not present)"
fi

summary
[ "$FAIL_COUNT" -gt 0 ] && exit 1 || exit 0
