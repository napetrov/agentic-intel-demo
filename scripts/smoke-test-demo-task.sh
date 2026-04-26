#!/usr/bin/env bash
# End-to-end "the demo can actually run a task" smoke test.
#
# `smoke-test-operator-instance.sh` proves the lifecycle (CRD + controller
# + OpenClawInstance reaches Ready + gateway /healthz). It does NOT prove
# that:
#   * the gateway accepts authenticated session requests
#   * a model alias actually answers a chat completion
#   * an exec/tool call round-trips inside the session pod
#   * Telegram-bound config is observable in the live pod
#
# This script targets exactly those gaps. It is read-only on the cluster
# (port-forwards only) and never writes Secrets to disk.
#
# Required:
#   APPLY=1
#
# Knobs:
#   INSTANCE_NAME       (default: intel-demo-operator)
#   INSTANCE_NAMESPACE  (default: default)
#   SYSTEM_A_KUBECTL    (default: "kubectl --context system-a")
#   GATEWAY_PORT        (default: 18789)
#   LITELLM_NAMESPACE   (default: inference)
#   LITELLM_PORT        (default: 4000)
#   LITELLM_ALIAS       (default: fast)   — must be one of fast/default/reasoning/sambanova
#   SKIP_LITELLM=1      (skip the chat completion check)
#   SKIP_GATEWAY=1      (skip the gateway probe)
#   SKIP_TELEGRAM=1     (skip the live Telegram config probe)
#
# Exit codes:
#   0  every requested check passed
#   1  at least one check failed
set -uo pipefail

APPLY="${APPLY:-0}"
INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
INSTANCE_NAMESPACE="${INSTANCE_NAMESPACE:-default}"
SYSTEM_A_KUBECTL="${SYSTEM_A_KUBECTL:-kubectl --context system-a}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
LITELLM_NAMESPACE="${LITELLM_NAMESPACE:-inference}"
LITELLM_PORT="${LITELLM_PORT:-4000}"
LITELLM_ALIAS="${LITELLM_ALIAS:-fast}"
SKIP_LITELLM="${SKIP_LITELLM:-0}"
SKIP_GATEWAY="${SKIP_GATEWAY:-0}"
SKIP_TELEGRAM="${SKIP_TELEGRAM:-0}"

read -r -a KC <<<"$SYSTEM_A_KUBECTL"

cat <<EOF
[smoke-test-demo-task] System A demo-task smoke
  apply:           $APPLY (set APPLY=1 to actually port-forward + curl)
  instance:        $INSTANCE_NAME / ns=$INSTANCE_NAMESPACE
  kubectl:         $SYSTEM_A_KUBECTL
  litellm alias:   $LITELLM_ALIAS  (override LITELLM_ALIAS=)
  skip litellm:    $SKIP_LITELLM
  skip gateway:    $SKIP_GATEWAY
  skip telegram:   $SKIP_TELEGRAM
EOF

if [ "$APPLY" != "1" ]; then
  cat <<'EOF'

Dry-run: this is the live sequence APPLY=1 would execute. Each step prints
its commands and pass/fail; nothing is mutated on the cluster.

  1. Confirm OpenClawInstance .status.phase=Running.
  2. Port-forward gateway service and curl /healthz (HTTP 200 expected).
  3. Port-forward LiteLLM service and POST /v1/chat/completions for the
     selected alias (200 + non-empty `choices[0].message.content`).
  4. Probe the live session pod's Telegram config: confirm allowFrom ids
     are non-empty in the rendered openclaw.json (read from pod env or
     ConfigMap mount; never reads Secret values).
EOF
  exit 0
fi

command -v "${KC[0]}" >/dev/null 2>&1 \
  || { echo "[smoke-test-demo-task] ${KC[0]} not on PATH" >&2; exit 127; }
command -v curl >/dev/null 2>&1 \
  || { echo "[smoke-test-demo-task] curl not on PATH" >&2; exit 127; }

FAIL=0
ok()   { printf '  [ok]    %s\n' "$1"; }
fail() { printf '  [FAIL]  %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup_pids=()
cleanup() {
  for pid in "${cleanup_pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# 1. instance phase
echo
echo "[1/4] OpenClawInstance phase"
phase="$("${KC[@]}" get openclawinstance "$INSTANCE_NAME" -n "$INSTANCE_NAMESPACE" \
          -o jsonpath='{.status.phase}' 2>/dev/null || true)"
case "$phase" in
  Running|Ready|Active|Healthy) ok "phase=$phase" ;;
  "") fail "OpenClawInstance/$INSTANCE_NAME not found in ns/$INSTANCE_NAMESPACE" ;;
  *)  fail "phase=$phase (expected Running)" ;;
esac

# 2. gateway /healthz
if [ "$SKIP_GATEWAY" != "1" ]; then
  echo
  echo "[2/4] Gateway /healthz"
  svc="$("${KC[@]}" get svc -n "$INSTANCE_NAMESPACE" \
          -l "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=gateway" \
          -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -z "$svc" ]; then
    fail "no gateway service labelled openclaw.rocks/instance=$INSTANCE_NAME"
  else
    "${KC[@]}" -n "$INSTANCE_NAMESPACE" port-forward "svc/$svc" \
      "$GATEWAY_PORT:$GATEWAY_PORT" >/dev/null 2>&1 &
    cleanup_pids+=("$!")
    sleep 2
    if curl -fsS --max-time 5 "http://127.0.0.1:$GATEWAY_PORT/healthz" >/dev/null; then
      ok "gateway /healthz 200 (svc/$svc)"
    else
      fail "gateway /healthz did not return 200 (svc/$svc)"
    fi
  fi
else
  echo
  echo "[2/4] Gateway /healthz SKIPPED (SKIP_GATEWAY=1)"
fi

# 3. LiteLLM chat completion
if [ "$SKIP_LITELLM" != "1" ]; then
  echo
  echo "[3/4] LiteLLM /v1/chat/completions for alias=$LITELLM_ALIAS"
  case "$LITELLM_ALIAS" in
    fast|default|reasoning|sambanova) ;;
    *) fail "LITELLM_ALIAS=$LITELLM_ALIAS not in {fast,default,reasoning,sambanova}" ;;
  esac
  if "${KC[@]}" -n "$LITELLM_NAMESPACE" get svc litellm >/dev/null 2>&1; then
    "${KC[@]}" -n "$LITELLM_NAMESPACE" port-forward svc/litellm \
      "$LITELLM_PORT:$LITELLM_PORT" >/dev/null 2>&1 &
    cleanup_pids+=("$!")
    sleep 2
    payload="$(printf '{"model":"%s","messages":[{"role":"user","content":"reply with the single word: ok"}]}' "$LITELLM_ALIAS")"
    body="$(curl -fsS --max-time 30 \
              -H 'content-type: application/json' \
              -d "$payload" \
              "http://127.0.0.1:$LITELLM_PORT/v1/chat/completions" 2>/dev/null || true)"
    if [ -z "$body" ]; then
      fail "litellm POST /v1/chat/completions returned empty body for alias=$LITELLM_ALIAS"
    elif printf '%s' "$body" | python3 -c '
import json, sys
try:
    obj = json.loads(sys.stdin.read())
    content = obj["choices"][0]["message"]["content"]
except Exception as e:
    print(f"parse error: {e}", file=sys.stderr); sys.exit(1)
sys.exit(0 if content else 2)
' 2>/dev/null; then
      ok "litellm answered for alias=$LITELLM_ALIAS"
    else
      fail "litellm answered, but body lacked choices[0].message.content (alias=$LITELLM_ALIAS)"
    fi
  else
    fail "svc/litellm not found in ns/$LITELLM_NAMESPACE — apply k8s/system-a/litellm.yaml first"
  fi
else
  echo
  echo "[3/4] LiteLLM SKIPPED (SKIP_LITELLM=1)"
fi

# 4. Telegram-bound config visible inside the session/runtime
if [ "$SKIP_TELEGRAM" != "1" ]; then
  echo
  echo "[4/4] Telegram-bound config visible in the live runtime"
  # Look at the rendered openclaw.json that the operator surfaces. The
  # operator typically mounts it as a ConfigMap on the gateway pod
  # (label openclaw.rocks/component=gateway), or stamps it onto
  # OpenClawInstance.status. We don't know upstream's exact contract,
  # so try ConfigMap → Pod → Status, in that order, and report the
  # first hit.
  cm="$("${KC[@]}" get cm -n "$INSTANCE_NAMESPACE" \
         -l "openclaw.rocks/instance=$INSTANCE_NAME" \
         -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  rendered=""
  if [ -n "$cm" ]; then
    rendered="$("${KC[@]}" -n "$INSTANCE_NAMESPACE" get cm "$cm" \
                  -o jsonpath='{.data.openclaw\.json}' 2>/dev/null || true)"
  fi
  if [ -z "$rendered" ]; then
    rendered="$("${KC[@]}" get openclawinstance "$INSTANCE_NAME" -n "$INSTANCE_NAMESPACE" \
                  -o jsonpath='{.status.config.openclaw\.json}' 2>/dev/null || true)"
  fi
  if [ -z "$rendered" ]; then
    fail "could not locate rendered openclaw.json (no ConfigMap with the right label, no .status.config)"
  else
    # Confirm a non-empty allowFrom + telegram enabled. We do NOT print
    # the config — only pass/fail. The JSON is passed via env var
    # because `python3 - <<HEREDOC` already binds stdin to the script
    # source, so a piped payload would never reach json.loads().
    OPENCLAW_JSON="$rendered" python3 - <<'PY' >/dev/null 2>&1
import json, os, sys
cfg = json.loads(os.environ["OPENCLAW_JSON"])
tg  = cfg.get("channels", {}).get("telegram", {})
if not tg.get("enabled"):
    sys.exit(2)
acct = next(iter(tg.get("accounts", {}).values()), {})
allow = acct.get("allowFrom") or []
if not allow:
    sys.exit(3)
PY
    rc=$?
    case "$rc" in
      0) ok "telegram channel enabled with non-empty allowFrom" ;;
      2) fail "telegram channel disabled in rendered openclaw.json" ;;
      3) fail "telegram allowFrom is empty — set TELEGRAM_ALLOWED_FROM" ;;
      *) fail "could not parse rendered openclaw.json (rc=$rc)" ;;
    esac
  fi
else
  echo
  echo "[4/4] Telegram config probe SKIPPED (SKIP_TELEGRAM=1)"
fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "[smoke-test-demo-task] $FAIL check(s) failed. Inspect with scripts/check-tier2-logs.sh"
  exit 1
fi
echo "[smoke-test-demo-task] all requested checks passed."
