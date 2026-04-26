#!/usr/bin/env bash
# Scan recent OpenClaw session-pod logs for evidence that tools (exec)
# actually ran. Pairs with the rendered-config probe in
# smoke-test-demo-task.sh step 5: that one proves the operator wired
# tools.exec into the runtime; this one proves a tool was actually
# invoked end-to-end (Telegram → agent → tool → result).
#
# Run this after DM-ing /demo and triggering a scenario. The script
# greps the session pod's recent logs for the canonical tool-call
# signature and reports each match.
#
# Read-only on the cluster — only `kubectl logs --since=...`. Never
# decodes Secrets.
#
# Usage:
#   ./scripts/check-openclaw-tools.sh                  # last 5 minutes
#   SINCE=15m ./scripts/check-openclaw-tools.sh        # last 15 minutes
#
# Knobs:
#   INSTANCE_NAME       (default: intel-demo-operator)
#   SESSION_NAMESPACE   (default: agents)
#   SYSTEM_A_KUBECTL    (default: "kubectl --context system-a")
#   SINCE               (default: 5m) — kubectl logs --since=
#   PATTERN             (default: a regex matching the canonical OpenClaw
#                        tool-invocation log lines: tool.invoke /
#                        tools.exec / "tool_call" / "exec_result"). Override
#                        if your operator ref logs differently.
#
# Exit codes:
#   0  at least one tool-call signature found
#   1  no signatures found in the SINCE window
#   2  no session pod found at all (no /demo run yet?)
set -uo pipefail

INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
SESSION_NAMESPACE="${SESSION_NAMESPACE:-agents}"
SYSTEM_A_KUBECTL="${SYSTEM_A_KUBECTL:-kubectl --context system-a}"
SINCE="${SINCE:-5m}"
PATTERN="${PATTERN:-tool[._]invoke|tools\.exec|tool_call|exec_result|invoking tool|tool result}"

read -r -a KC <<<"$SYSTEM_A_KUBECTL"

command -v "${KC[0]}" >/dev/null 2>&1 \
  || { echo "[check-openclaw-tools] ${KC[0]} not on PATH" >&2; exit 127; }

cat <<EOF
[check-openclaw-tools] scanning session-pod logs for tool invocations
  instance:   $INSTANCE_NAME
  namespace:  $SESSION_NAMESPACE
  since:      $SINCE
  pattern:    $PATTERN
EOF

# Try the operator-managed label first; fall back to role=session-pod
# (the session-pod-template ConfigMap convention). Print the union so
# both shipped paths surface.
selectors=(
  "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=session"
  "role=session-pod"
)

found_any=0
saw_pod=0

for sel in "${selectors[@]}"; do
  pods="$("${KC[@]}" -n "$SESSION_NAMESPACE" get pods -l "$sel" \
            -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)"
  [ -z "$pods" ] && continue
  saw_pod=1
  for pod in $pods; do
    echo
    echo "--- pod=$pod (selector=$sel) ---"
    matches="$("${KC[@]}" -n "$SESSION_NAMESPACE" logs "$pod" \
                --since="$SINCE" --tail=2000 2>/dev/null \
                | grep -E "$PATTERN" || true)"
    if [ -z "$matches" ]; then
      echo "  no matches in the last $SINCE"
    else
      printf '%s\n' "$matches"
      n=$(printf '%s\n' "$matches" | wc -l | tr -d ' ')
      echo "  → $n line(s) match the tool-invocation pattern"
      found_any=1
    fi
  done
done

echo
if [ "$saw_pod" = "0" ]; then
  echo "[check-openclaw-tools] no session pod found in ns/$SESSION_NAMESPACE."
  echo "                       DM /demo to the bot and try again — the operator"
  echo "                       only spawns a session pod on first user interaction."
  exit 2
fi
if [ "$found_any" = "0" ]; then
  echo "[check-openclaw-tools] no tool-invocation lines in the last $SINCE."
  echo "                       Either no tool was triggered yet, or the log shape"
  echo "                       differs from the default PATTERN. Re-run with"
  echo "                       PATTERN=... after inspecting one match by hand:"
  echo "                       scripts/check-tier2-logs.sh session"
  exit 1
fi
echo "[check-openclaw-tools] tool invocation evidence found."
