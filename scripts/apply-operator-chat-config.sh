#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-onedal-build}"
GROUP_ID="${GROUP_ID:--1003759657220}"
ALLOWED_USER_ID="${ALLOWED_USER_ID:-293894843}"
NAMESPACE="${NAMESPACE:-openclaw}"
INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
TEMPLATE_PATH="${TEMPLATE_PATH:-config/operator-chat-config.template.json}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export GROUP_ID ALLOWED_USER_ID
python3 - <<'PY' "$REPO_ROOT/$TEMPLATE_PATH" "$TMP_DIR/openclaw.json"
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, 'r', encoding='utf-8') as f:
    data = json.load(f)
# patch runtime values from env
telegram = data['channels']['telegram']
telegram['groupAllowFrom'] = [os.environ['ALLOWED_USER_ID']]
groups = telegram['groups']
existing = next(iter(groups.values()))
groups.clear()
groups[os.environ['GROUP_ID']] = existing
existing['allowFrom'] = [os.environ['ALLOWED_USER_ID']]
account = telegram['accounts']['session-agent']
account['groupAllowFrom'] = [os.environ['ALLOWED_USER_ID']]
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
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
