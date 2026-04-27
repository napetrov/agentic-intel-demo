#!/usr/bin/env bash
# Verify the demo Secrets exist with the expected keys, without ever
# reading their VALUES.
#
# Pairs with `scripts/create-operator-secrets.sh`: that one writes the
# Secrets, this one confirms each Secret is present and that its
# .data.<key> set matches what the manifests reference. Required key
# coverage prevents the most common failure mode (an `OpenClawInstance`
# stuck in `Provisioning` because one envFromSecret key is missing).
#
# Read-only by design:
#   * `kubectl get secret <name> -o jsonpath='{.data}'` lists keys.
#   * we never `-o yaml` the Secret, never `-o jsonpath='{.data.<key>}'`,
#     never base64-decode anything. This script is safe to copy/paste
#     into a chat or screenshot.
#
# Usage:
#   ./scripts/verify-operator-secrets.sh                 # both clusters, all secrets
#   SCOPE=system-a ./scripts/verify-operator-secrets.sh  # only System A secrets
#   SCOPE=system-b ./scripts/verify-operator-secrets.sh  # only System B secrets
#
# Knobs:
#   SYSTEM_A_KUBECTL (default: "kubectl --context system-a")
#   SYSTEM_B_KUBECTL (default: "kubectl --context system-b")
#
# Exit codes:
#   0  every requested Secret exists with the expected key set
#   1  at least one Secret missing or missing a required key
#   2  invalid SCOPE
set -uo pipefail

SCOPE="${SCOPE:-all}"
SYSTEM_A_KUBECTL="${SYSTEM_A_KUBECTL:-kubectl --context system-a}"
SYSTEM_B_KUBECTL="${SYSTEM_B_KUBECTL:-kubectl --context system-b}"
# The github-token Secret is optional by default — agents without GitHub
# credentials still complete the demo. Set REQUIRE_GH_TOKEN=1 (or pass
# GH_TOKEN=...) to upgrade absence from `[warn]` to `[FAIL]` for stands
# that drive `git push` / `gh pr create` from inside the session pod.
REQUIRE_GH_TOKEN="${REQUIRE_GH_TOKEN:-${GH_TOKEN:+1}}"
REQUIRE_GH_TOKEN="${REQUIRE_GH_TOKEN:-0}"

case "$SCOPE" in
  all|system-a|system-b) ;;
  *) echo "[verify-operator-secrets] unknown SCOPE=$SCOPE (use all|system-a|system-b)" >&2; exit 2 ;;
esac

# Bail early if the kubectl binary required for the requested SCOPE is
# missing — without it, every "secret missing" reading would actually
# mean "command not found", which is misleading. SCOPE=all probes both,
# system-a/system-b probe only the relevant binding.
probe_kubectl_cmd() {
  local cmd="$1"
  local -a probe=()
  read -r -a probe <<<"$cmd"
  if ! command -v "${probe[0]}" >/dev/null 2>&1; then
    echo "[verify-operator-secrets] ${probe[0]} not on PATH — run scripts/check-tier2-environment.sh first" >&2
    exit 127
  fi
}

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; then
  probe_kubectl_cmd "$SYSTEM_A_KUBECTL"
fi
if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-b" ]; then
  probe_kubectl_cmd "$SYSTEM_B_KUBECTL"
fi

# python3 parses the Secret key set (without ever reading values).
# Without this preflight a missing python3 would silently leave $keys
# empty in check_secret(), producing false "MISSING keys" reports
# instead of pointing at the real dependency problem.
if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-operator-secrets] python3 not on PATH — required to parse Secret key sets safely" >&2
  exit 127
fi

FAIL=0

ok()   { printf '  [ok]    %s\n' "$1"; }
warn() { printf '  [warn]  %s\n' "$1"; }
fail() { printf '  [FAIL]  %s\n' "$1"; FAIL=$((FAIL+1)); }

# check_optional_secret <kubectl-prefix> <namespace> <secret-name> <required keys...>
#
# Same shape as check_secret, but a missing Secret is a [warn] (or [FAIL]
# when REQUIRE_GH_TOKEN=1). Use for credentials the demo can run without
# but agents inside the session pod consume internally when present —
# currently just `github-token`.
check_optional_secret() {
  local kubectl_cmd="$1" namespace="$2" name="$3"; shift 3
  local -a kc=()
  read -r -a kc <<<"$kubectl_cmd"
  if ! "${kc[@]}" -n "$namespace" get secret "$name" >/dev/null 2>&1; then
    if [ "$REQUIRE_GH_TOKEN" = "1" ]; then
      fail "secret/$name in ns/$namespace MISSING (required because REQUIRE_GH_TOKEN=1) — re-run scripts/create-operator-secrets.sh with GH_TOKEN=..."
    else
      warn "secret/$name in ns/$namespace not present — agents will run without GitHub credentials. Set GH_TOKEN and re-run scripts/create-operator-secrets.sh to wire it."
    fi
    return
  fi
  check_secret "$kubectl_cmd" "$namespace" "$name" "$@"
}

# check_secret <kubectl-prefix> <namespace> <secret-name> <required keys...>
check_secret() {
  local kubectl_cmd="$1" namespace="$2" name="$3"; shift 3
  local -a required=("$@")
  read -r -a kc <<<"$kubectl_cmd"

  if ! "${kc[@]}" -n "$namespace" get secret "$name" >/dev/null 2>&1; then
    fail "secret/$name in ns/$namespace MISSING — run scripts/create-operator-secrets.sh"
    return
  fi

  # `{.data}` returns a JSON object whose keys we can inspect; the
  # values are base64-encoded blobs that we DO NOT print. We pass the
  # JSON to `python3 -c` only to extract the key-set as plain names.
  local keys_blob
  keys_blob="$("${kc[@]}" -n "$namespace" get secret "$name" \
                 -o jsonpath='{.data}' 2>/dev/null || true)"
  local keys=()
  if [ -n "$keys_blob" ]; then
    # shellcheck disable=SC2207
    keys=( $(printf '%s' "$keys_blob" | python3 -c '
import json, sys
try:
    obj = json.loads(sys.stdin.read() or "{}")
except Exception:
    obj = {}
print("\n".join(sorted(obj.keys())))
') )
  fi

  local missing=()
  for key in "${required[@]}"; do
    local found=0
    for k in "${keys[@]}"; do
      if [ "$k" = "$key" ]; then found=1; break; fi
    done
    [ "$found" = "1" ] || missing+=("$key")
  done

  if [ ${#missing[@]} -eq 0 ]; then
    ok "ns/$namespace secret/$name has all required keys: ${required[*]}"
  else
    fail "ns/$namespace secret/$name MISSING keys: ${missing[*]}"
  fi
}

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; then
  echo "[verify-operator-secrets] System A — KUBECTL='$SYSTEM_A_KUBECTL'"
  check_secret "$SYSTEM_A_KUBECTL" default      intel-demo-operator-secrets \
    TELEGRAM_BOT_TOKEN AWS_BEARER_TOKEN_BEDROCK SAMBANOVA_API_KEY MINIO_ACCESS_KEY MINIO_SECRET_KEY
  check_secret "$SYSTEM_A_KUBECTL" inference    litellm-secrets \
    AWS_BEARER_TOKEN_BEDROCK SAMBANOVA_API_KEY
  check_secret "$SYSTEM_A_KUBECTL" agents       session-pod-artifact-creds \
    AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  check_secret "$SYSTEM_A_KUBECTL" agents       telegram-bot \
    TELEGRAM_BOT_TOKEN
  check_secret "$SYSTEM_A_KUBECTL" agents       bedrock-creds \
    AWS_BEARER_TOKEN_BEDROCK
  # github-token is optional (see REQUIRE_GH_TOKEN above). When wired,
  # agents inside the session pod read it as GH_TOKEN/GITHUB_TOKEN.
  check_optional_secret "$SYSTEM_A_KUBECTL" agents github-token \
    GH_TOKEN
fi

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-b" ]; then
  echo
  echo "[verify-operator-secrets] System B — KUBECTL='$SYSTEM_B_KUBECTL'"
  check_secret "$SYSTEM_B_KUBECTL" system-b minio-creds \
    MINIO_ROOT_USER MINIO_ROOT_PASSWORD
fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "[verify-operator-secrets] $FAIL Secret(s) need attention. Re-run scripts/create-operator-secrets.sh with the missing values exported."
  exit 1
fi
echo "[verify-operator-secrets] all required Secrets present."
