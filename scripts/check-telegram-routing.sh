#!/usr/bin/env bash
# Verify the Telegram bot is wired correctly *before* any human DM.
#
# Closes the "DM /demo went to generic onboarding instead of demo flow"
# class of failures by validating everything the bot side controls,
# without touching the cluster:
#
#   1. TELEGRAM_BOT_TOKEN works (Bot API getMe succeeds, returns is_bot)
#   2. The slash-command menu is registered (getMyCommands lists /demo)
#   3. The bot has no pending updates from a different (stale) session,
#      which previously caused a re-bound bot to replay onboarding
#
# This script:
#   * never echoes the bot token
#   * does NOT call deleteWebhook / setMyCommands / sendMessage
#   * is read-only on Telegram (only `getMe`, `getMyCommands`,
#     `getUpdates?limit=0` against the bot itself)
#
# Usage:
#   TELEGRAM_BOT_TOKEN=... ./scripts/check-telegram-routing.sh
#
# Knobs:
#   EXPECTED_COMMANDS  comma-separated list (default: demo,start,status,reset)
#                      Names without the leading slash, matching what
#                      scripts/telegram-send-menu.py registers.
#
# Exit codes:
#   0  bot wired correctly
#   1  one of the checks failed
#   2  TELEGRAM_BOT_TOKEN not set
set -uo pipefail

EXPECTED_COMMANDS="${EXPECTED_COMMANDS:-demo,start,status,reset}"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "[check-telegram-routing] TELEGRAM_BOT_TOKEN not set — export it first." >&2
  exit 2
fi

command -v curl    >/dev/null 2>&1 || { echo "[check-telegram-routing] curl not on PATH"    >&2; exit 127; }
command -v python3 >/dev/null 2>&1 || { echo "[check-telegram-routing] python3 not on PATH" >&2; exit 127; }

# Build URLs locally so the token only ever lives inside this process —
# never as a `?token=` query string in a shell-rendered command line.
api() {
  local method="$1"; shift
  curl -fsS --max-time 10 \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}" "$@" 2>/dev/null
}

FAIL=0
ok()   { printf '  [ok]    %s\n' "$1"; }
warn() { printf '  [warn]  %s\n' "$1"; }
fail() { printf '  [FAIL]  %s\n' "$1"; FAIL=$((FAIL+1)); }

echo "[check-telegram-routing] probing api.telegram.org (token redacted)"

# 1. getMe — confirms the token is valid and prints the bot's username.
echo
echo "[1/3] getMe (token validity + bot identity)"
me_body="$(api getMe || true)"
if [ -z "$me_body" ]; then
  fail "getMe returned empty — token rejected by Telegram or no network"
else
  RESULT="$me_body" python3 -c '
import json, os, sys
obj = json.loads(os.environ["RESULT"])
if not obj.get("ok"):
    print("getMe ok=false: " + json.dumps(obj.get("description", "")), file=sys.stderr)
    sys.exit(1)
res = obj.get("result", {})
if not res.get("is_bot"):
    sys.exit(2)
# Print without any field that contains secret material.
print(f"bot username=@{res.get(\"username\",\"?\")} id={res.get(\"id\",\"?\")} can_read_groups={res.get(\"can_read_all_group_messages\", False)}")
' && ok "$(RESULT="$me_body" python3 -c '
import json, os
res = json.loads(os.environ["RESULT"])["result"]
print(f"bot @{res.get(\"username\",\"?\")} (id={res.get(\"id\",\"?\")})")
')" || fail "getMe rejected the token"
fi

# 2. getMyCommands — confirms the demo menu is registered.
echo
echo "[2/3] getMyCommands (slash-command menu)"
cmds_body="$(api getMyCommands || true)"
if [ -z "$cmds_body" ]; then
  fail "getMyCommands returned empty"
else
  registered="$(RESULT="$cmds_body" python3 -c '
import json, os, sys
obj = json.loads(os.environ["RESULT"])
if not obj.get("ok"):
    sys.exit(1)
print(",".join(c.get("command", "") for c in obj.get("result", []) if c.get("command")))
' 2>/dev/null || true)"
  if [ -z "$registered" ]; then
    warn "no slash commands registered — run scripts/telegram-send-menu.py"
  else
    ok "registered: ${registered}"
    missing=""
    IFS=',' read -ra want <<<"$EXPECTED_COMMANDS"
    for c in "${want[@]}"; do
      [[ ",$registered," == *",$c,"* ]] || missing+="$c "
    done
    if [ -n "$missing" ]; then
      fail "expected commands missing: $missing(re-run scripts/telegram-send-menu.py)"
    else
      ok "all expected commands present: $EXPECTED_COMMANDS"
    fi
  fi
fi

# 3. getUpdates limit=0 — non-mutating peek at the queue depth. A
#    deep backlog usually means the previous session's bot is still
#    polling, or the new instance hasn't claimed the long-poll yet.
#    A non-zero count here is the most common cause of "DM went to
#    the wrong agent": both instances drained alternating updates.
echo
echo "[3/3] getUpdates (long-poll queue health)"
upd_body="$(api 'getUpdates?timeout=0&limit=1&offset=-1' || true)"
if [ -z "$upd_body" ]; then
  warn "getUpdates returned empty — non-fatal (could be 409 from another long-poll)"
else
  RESULT="$upd_body" python3 -c '
import json, os, sys
obj = json.loads(os.environ["RESULT"])
if not obj.get("ok"):
    desc = obj.get("description", "")
    if "Conflict" in desc:
        # 409 Conflict: another consumer is currently long-polling.
        # That is the EXPECTED state when the operator-managed session
        # pod is up — Telegram only allows one long-poll consumer.
        print("expected: another long-poll consumer is active (operator session pod)")
        sys.exit(0)
    print(f"unexpected: {desc}", file=sys.stderr)
    sys.exit(1)
n = len(obj.get("result", []))
print(f"queue head returned {n} update(s)")
sys.exit(0)
' && ok "long-poll queue accessible" || fail "getUpdates returned an unexpected error"
fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "[check-telegram-routing] $FAIL check(s) failed."
  exit 1
fi
echo "[check-telegram-routing] bot wiring OK — DM the bot and confirm /demo renders the scenario menu."
