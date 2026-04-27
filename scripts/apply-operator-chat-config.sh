#!/usr/bin/env bash
# Render config/operator-chat-config.template.json with environment-supplied
# Telegram identifiers and apply it as a config patch to a running
# OpenClawInstance.
#
# Required env (no defaults — refuse to ship someone else's chat IDs):
#   TELEGRAM_ALLOWED_USER_ID  - Telegram user ID allowed to DM/issue commands
#   TELEGRAM_GROUP_ID         - Telegram group ID where the bot is wired
#                               (must include the leading `-` for supergroups)
#
# Backward-compat aliases (deprecated, will warn):
#   ALLOWED_USER_ID, GROUP_ID
#
# Optional env (with defaults):
#   HOST, NAMESPACE, INSTANCE_NAME, TEMPLATE_PATH
set -euo pipefail

HOST="${HOST:-onedal-build}"
NAMESPACE="${NAMESPACE:-openclaw}"
INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
TEMPLATE_PATH="${TEMPLATE_PATH:-config/operator-chat-config.template.json}"

# Accept the new TELEGRAM_* names; fall back to the legacy names with a
# deprecation warning so existing CI / runbooks keep working.
if [ -z "${TELEGRAM_ALLOWED_USER_ID:-}" ] && [ -n "${ALLOWED_USER_ID:-}" ]; then
  echo "[apply-operator-chat-config] WARNING: ALLOWED_USER_ID is deprecated; use TELEGRAM_ALLOWED_USER_ID." >&2
  TELEGRAM_ALLOWED_USER_ID="$ALLOWED_USER_ID"
fi
if [ -z "${TELEGRAM_GROUP_ID:-}" ] && [ -n "${GROUP_ID:-}" ]; then
  echo "[apply-operator-chat-config] WARNING: GROUP_ID is deprecated; use TELEGRAM_GROUP_ID." >&2
  TELEGRAM_GROUP_ID="$GROUP_ID"
fi

if [ -z "${TELEGRAM_ALLOWED_USER_ID:-}" ] || [ -z "${TELEGRAM_GROUP_ID:-}" ]; then
  cat >&2 <<EOF
[apply-operator-chat-config] missing required env vars.
  TELEGRAM_ALLOWED_USER_ID = '${TELEGRAM_ALLOWED_USER_ID:-}'
  TELEGRAM_GROUP_ID        = '${TELEGRAM_GROUP_ID:-}'
Set both before running this script.
EOF
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export TELEGRAM_ALLOWED_USER_ID TELEGRAM_GROUP_ID
python3 - <<'PY' "$REPO_ROOT/$TEMPLATE_PATH" "$TMP_DIR/openclaw.json"
import json
import os
import re
import sys

src, dst = sys.argv[1], sys.argv[2]

# Substitute every ${VAR} placeholder we know about, in both keys and string
# values, recursively. A whitelisted set is safer than os.path.expandvars-
# style behavior — it fails loudly if the template adds a new placeholder
# we haven't taught the script to provide.
KNOWN_PLACEHOLDERS = {
    "TELEGRAM_ALLOWED_USER_ID": os.environ["TELEGRAM_ALLOWED_USER_ID"],
    "TELEGRAM_GROUP_ID": os.environ["TELEGRAM_GROUP_ID"],
}
# Anything left that looks like ${...} is treated as an operator-supplied
# secret — left intact for the operator runtime to expand, e.g.
# ${TELEGRAM_BOT_TOKEN} or ${OPENCLAW_GATEWAY_TOKEN}.
PASSTHROUGH = {"TELEGRAM_BOT_TOKEN", "OPENCLAW_GATEWAY_TOKEN"}
PLACEHOLDER_RE = re.compile(r"\$\{([A-Z0-9_]+)\}")


def substitute(text: str) -> str:
    def repl(m):
        name = m.group(1)
        if name in KNOWN_PLACEHOLDERS:
            return KNOWN_PLACEHOLDERS[name]
        if name in PASSTHROUGH:
            return m.group(0)
        raise SystemExit(
            f"[apply-operator-chat-config] template references unknown "
            f"placeholder ${{{name}}} (extend KNOWN_PLACEHOLDERS or "
            f"PASSTHROUGH in {sys.argv[0]})"
        )

    return PLACEHOLDER_RE.sub(repl, text)


def walk(node):
    if isinstance(node, dict):
        return {substitute(k) if isinstance(k, str) else k: walk(v)
                for k, v in node.items()}
    if isinstance(node, list):
        return [walk(v) for v in node]
    if isinstance(node, str):
        return substitute(node)
    return node


with open(src, "r", encoding="utf-8") as f:
    data = json.load(f)
data = walk(data)
with open(dst, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

scp -q "$TMP_DIR/openclaw.json" "$HOST:/tmp/intel-demo-openclaw.json"
scp -q "$TMP_DIR/openclaw.json" "$HOST:/tmp/intel-demo-openclaw-raw.json"
ssh "$HOST" "python3 - <<'PY'
import json
from pathlib import Path
cfg = json.loads(Path('/tmp/intel-demo-openclaw-raw.json').read_text())
patch = {
  'spec': {
    'config': {
      'format': 'json',
      'mergeMode': 'overwrite',
      'raw': cfg,
    }
  }
}
Path('/tmp/intel-demo-openclaw-patch.json').write_text(json.dumps(patch))
PY"
ssh "$HOST" "sudo kubectl patch openclawinstance ${INSTANCE_NAME} -n ${NAMESPACE} --type merge --patch-file /tmp/intel-demo-openclaw-patch.json"
ssh "$HOST" "sudo kubectl rollout restart statefulset/${INSTANCE_NAME} -n ${NAMESPACE} && sudo kubectl rollout status statefulset/${INSTANCE_NAME} -n ${NAMESPACE} --timeout=600s"
echo "[apply-operator-chat-config] applied updated operator chat config to ${INSTANCE_NAME}"
