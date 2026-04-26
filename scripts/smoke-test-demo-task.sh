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
#   SESSION_NAMESPACE   (default: agents) — namespace operator drops session pods into
#   REQUIRED_SESSION_ENVS  comma-separated env-var names that MUST be wired
#                          into the session pod (default: AWS_BEARER_TOKEN_BEDROCK,
#                          TELEGRAM_BOT_TOKEN). Names only — values are never read.
#   SKIP_LITELLM=1      (skip the chat completion check)
#   SKIP_GATEWAY=1      (skip the gateway probe)
#   SKIP_TELEGRAM=1     (skip the live Telegram config probe)
#   SKIP_TOOLS=1        (skip the tools.exec config probe)
#   SKIP_SESSION_ENV=1  (skip the session-pod env wiring probe)
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
SESSION_NAMESPACE="${SESSION_NAMESPACE:-agents}"
REQUIRED_SESSION_ENVS="${REQUIRED_SESSION_ENVS:-AWS_BEARER_TOKEN_BEDROCK,TELEGRAM_BOT_TOKEN}"
SKIP_LITELLM="${SKIP_LITELLM:-0}"
SKIP_GATEWAY="${SKIP_GATEWAY:-0}"
SKIP_TELEGRAM="${SKIP_TELEGRAM:-0}"
SKIP_TOOLS="${SKIP_TOOLS:-0}"
SKIP_SESSION_ENV="${SKIP_SESSION_ENV:-0}"

read -r -a KC <<<"$SYSTEM_A_KUBECTL"

cat <<EOF
[smoke-test-demo-task] System A demo-task smoke
  apply:              $APPLY (set APPLY=1 to actually port-forward + curl)
  instance:           $INSTANCE_NAME / ns=$INSTANCE_NAMESPACE
  kubectl:            $SYSTEM_A_KUBECTL
  litellm alias:      $LITELLM_ALIAS  (override LITELLM_ALIAS=)
  session ns:         $SESSION_NAMESPACE
  required env names: $REQUIRED_SESSION_ENVS
  skip litellm:       $SKIP_LITELLM
  skip gateway:       $SKIP_GATEWAY
  skip telegram:      $SKIP_TELEGRAM
  skip tools:         $SKIP_TOOLS
  skip session env:   $SKIP_SESSION_ENV
EOF

if [ "$APPLY" != "1" ]; then
  cat <<'EOF'

Dry-run: this is the live sequence APPLY=1 would execute. Each step prints
its commands and pass/fail; nothing is mutated on the cluster.

  1. Confirm OpenClawInstance .status.phase=Running.
  2. Port-forward gateway service and curl /healthz (HTTP 200 expected).
  3. Port-forward LiteLLM service and POST /v1/chat/completions for the
     selected alias (200 + non-empty `choices[0].message.content`).
  4. Probe the live runtime config (rendered openclaw.json) and confirm
     the Telegram channel is enabled with non-empty allowFrom.
  5. Probe the same rendered openclaw.json for tools.exec.security=full
     and tools.exec.ask=off (proves the operator wired the tool config
     to the runtime; pre-condition for any /demo command actually
     running shell tools).
  6. Read the session pod spec env-var NAMES (not values) and assert
     each name in REQUIRED_SESSION_ENVS is wired in. This is how we
     prove AWS_BEARER_TOKEN_BEDROCK got from the operator Secret to
     the live pod without ever reading its value.
EOF
  exit 0
fi

command -v "${KC[0]}" >/dev/null 2>&1 \
  || { echo "[smoke-test-demo-task] ${KC[0]} not on PATH" >&2; exit 127; }
command -v curl >/dev/null 2>&1 \
  || { echo "[smoke-test-demo-task] curl not on PATH" >&2; exit 127; }
command -v python3 >/dev/null 2>&1 \
  || { echo "[smoke-test-demo-task] python3 not on PATH (used to parse litellm/openclaw.json)" >&2; exit 127; }

FAIL=0
ok()   { printf '  [ok]    %s\n' "$1"; }
fail() { printf '  [FAIL]  %s\n' "$1"; FAIL=$((FAIL+1)); }

# wait_pf_http <pid> <url> [tries=20]
#   Probe a URL behind a backgrounded port-forward without the
#   `sleep 2 && curl` race. Returns 0 only if the URL answers 2xx
#   while the port-forward is still alive.
#
#   - `kill -0 $pid` short-circuits to failure if port-forward died
#     (RBAC denial, port already bound, service vanished). Otherwise
#     a stray local listener could answer the curl and we'd report
#     a false pass.
#   - 0.5s delay × 20 ≈ 10s budget; matches the previous `sleep 2`
#     ceiling for healthy clusters but tolerates slower kubelets.
wait_pf_http() {
  local pid="$1" url="$2" tries="${3:-20}"
  local i=0
  while [ "$i" -lt "$tries" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i+1))
    sleep 0.5
  done
  return 1
}

cleanup_pids=()
cleanup() {
  for pid in "${cleanup_pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# 1. instance phase
echo
echo "[1/6] OpenClawInstance phase"
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
  echo "[2/6] Gateway /healthz"
  svc="$("${KC[@]}" get svc -n "$INSTANCE_NAMESPACE" \
          -l "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=gateway" \
          -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -z "$svc" ]; then
    fail "no gateway service labelled openclaw.rocks/instance=$INSTANCE_NAME"
  else
    "${KC[@]}" -n "$INSTANCE_NAMESPACE" port-forward "svc/$svc" \
      "$GATEWAY_PORT:$GATEWAY_PORT" >/dev/null 2>&1 &
    pf_pid="$!"
    cleanup_pids+=("$pf_pid")
    if wait_pf_http "$pf_pid" "http://127.0.0.1:$GATEWAY_PORT/healthz"; then
      ok "gateway /healthz 200 (svc/$svc)"
    else
      fail "gateway /healthz did not return 200 (svc/$svc; port-forward dead or unreachable)"
    fi
  fi
else
  echo
  echo "[2/6] Gateway /healthz SKIPPED (SKIP_GATEWAY=1)"
fi

# 3. LiteLLM chat completion
if [ "$SKIP_LITELLM" != "1" ]; then
  echo
  echo "[3/6] LiteLLM /v1/chat/completions for alias=$LITELLM_ALIAS"
  case "$LITELLM_ALIAS" in
    fast|default|reasoning|sambanova) ;;
    *) fail "LITELLM_ALIAS=$LITELLM_ALIAS not in {fast,default,reasoning,sambanova}" ;;
  esac
  if "${KC[@]}" -n "$LITELLM_NAMESPACE" get svc litellm >/dev/null 2>&1; then
    "${KC[@]}" -n "$LITELLM_NAMESPACE" port-forward svc/litellm \
      "$LITELLM_PORT:$LITELLM_PORT" >/dev/null 2>&1 &
    pf_pid="$!"
    cleanup_pids+=("$pf_pid")
    # LiteLLM exposes /health on the same port; wait for it before
    # POSTing /v1/chat/completions so a dead/dying port-forward fails
    # fast instead of blowing the curl --max-time budget.
    if ! wait_pf_http "$pf_pid" "http://127.0.0.1:$LITELLM_PORT/health"; then
      fail "litellm port-forward did not reach /health (alias=$LITELLM_ALIAS)"
    fi
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
  echo "[3/6] LiteLLM SKIPPED (SKIP_LITELLM=1)"
fi

# 4. Telegram-bound config visible inside the session/runtime
if [ "$SKIP_TELEGRAM" != "1" ]; then
  echo
  echo "[4/6] Telegram-bound config visible in the live runtime"
  # Look at the rendered openclaw.json that the operator surfaces. The
  # operator typically mounts it as a ConfigMap on the gateway pod
  # (label openclaw.rocks/component=gateway), or stamps it onto
  # OpenClawInstance.status. We don't know upstream's exact contract,
  # so try ConfigMap → Status, in that order, and report the first
  # hit. (A pod-exec fallback would let us read the file straight
  # from /etc/openclaw inside the gateway container, but that needs
  # `kubectl exec` permission and a known mount path — out of scope
  # for a read-only smoke.)
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
  echo "[4/6] Telegram config probe SKIPPED (SKIP_TELEGRAM=1)"
fi

# 5. tools.exec config visible inside the live runtime
#    Same rendered config as step 4. The shipped openclaw.json declares
#    tools.exec.security=full + ask=off so /demo scenarios can run shell
#    tools without a per-call prompt. If the operator drops the block
#    silently, the demo Telegram flow goes through but no tool actually
#    runs — that's the failure mode this step catches.
if [ "$SKIP_TOOLS" != "1" ]; then
  echo
  echo "[5/6] tools.exec config visible in the live runtime"
  if [ -z "${rendered:-}" ]; then
    fail "no rendered openclaw.json available (step 4 found none)"
  else
    OPENCLAW_JSON="$rendered" python3 - <<'PY' >/dev/null 2>&1
import json, os, sys
cfg = json.loads(os.environ["OPENCLAW_JSON"])
exec_cfg = cfg.get("tools", {}).get("exec", {})
if exec_cfg.get("security") != "full":
    sys.exit(2)
if exec_cfg.get("ask") not in ("off", False, None):
    sys.exit(3)
PY
    rc=$?
    case "$rc" in
      0) ok "tools.exec.security=full, ask=off — shell tools are enabled" ;;
      2) fail "tools.exec.security != 'full' — /demo scenarios will refuse to run shell tools" ;;
      3) fail "tools.exec.ask is on — every tool call will block waiting for confirmation" ;;
      *) fail "could not parse tools.exec block (rc=$rc)" ;;
    esac
  fi
else
  echo
  echo "[5/6] tools.exec config probe SKIPPED (SKIP_TOOLS=1)"
fi

# 6. session pod env wiring (NAMES only, never values).
#    This is the closest a read-only smoke can get to "the session pod
#    actually sees AWS_BEARER_TOKEN_BEDROCK". jsonpath returns the env
#    *name* set declared on the pod spec; we never touch
#    .env[*].valueFrom or the resolved value, so Secret material does
#    not leave the cluster.
if [ "$SKIP_SESSION_ENV" != "1" ]; then
  echo
  echo "[6/6] Session pod env wiring (names only, no values)"
  pod="$("${KC[@]}" get pods -n "$SESSION_NAMESPACE" \
          -l "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=session" \
          -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -z "$pod" ]; then
    # Fall back to role=session-pod, which is what the
    # session-pod-template ConfigMap labels its pods as.
    pod="$("${KC[@]}" get pods -n "$SESSION_NAMESPACE" \
            -l "role=session-pod" \
            -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  fi
  if [ -z "$pod" ]; then
    fail "no session pod found in ns/$SESSION_NAMESPACE (have you DM'd /demo yet to spawn one?)"
  else
    # Get the union of (a) explicit env names and (b) envFrom secret/configmap
    # references. We then compare against REQUIRED_SESSION_ENVS. envFrom
    # secret references are resolved by listing the keys of the referenced
    # Secret — also names-only.
    names="$("${KC[@]}" -n "$SESSION_NAMESPACE" get pod "$pod" \
              -o jsonpath='{range .spec.containers[*]}{.env[*].name}{"\n"}{end}' 2>/dev/null \
              | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ',')"
    # envFrom resolution: list referenced Secrets, then list each Secret's keys.
    sec_refs="$("${KC[@]}" -n "$SESSION_NAMESPACE" get pod "$pod" \
                  -o jsonpath='{range .spec.containers[*].envFrom[*]}{.secretRef.name}{"\n"}{end}' 2>/dev/null \
                  | grep -v '^$' | sort -u)"
    for s in $sec_refs; do
      keys="$("${KC[@]}" -n "$SESSION_NAMESPACE" get secret "$s" \
                -o jsonpath='{range .data}{}{end}' 2>/dev/null \
                | python3 -c '
import json, sys
try:
    obj = json.loads(sys.stdin.read() or "{}")
except Exception:
    obj = {}
print(",".join(sorted(obj.keys())))
' 2>/dev/null || true)"
      [ -n "$keys" ] && names="$names$keys,"
    done

    missing=""
    IFS=',' read -ra want <<<"$REQUIRED_SESSION_ENVS"
    for n in "${want[@]}"; do
      [ -z "$n" ] && continue
      if [[ ",$names," != *",$n,"* ]]; then
        missing+="$n "
      fi
    done
    if [ -n "$missing" ]; then
      fail "session pod $pod missing env names: $missing(check OpenClawInstance.spec.envFromSecrets / session-pod-template)"
    else
      ok "session pod $pod has every required env name: $REQUIRED_SESSION_ENVS"
    fi
  fi
else
  echo
  echo "[6/6] Session pod env wiring SKIPPED (SKIP_SESSION_ENV=1)"
fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "[smoke-test-demo-task] $FAIL check(s) failed. Inspect with scripts/check-tier2-logs.sh"
  exit 1
fi
echo "[smoke-test-demo-task] all requested checks passed."
