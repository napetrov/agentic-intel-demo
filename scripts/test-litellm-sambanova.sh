#!/usr/bin/env bash
set -euo pipefail

LITELLM_BASE_URL="${LITELLM_BASE_URL:-http://127.0.0.1:4000}"
LITELLM_MODEL="${LITELLM_MODEL:-sambanova-deepseek-v3-1}"
PROMPT="${PROMPT:-Hello! Reply with exactly: litellm sambanova ok}"

payload="$(cat <<EOF
{
  "model": "$LITELLM_MODEL",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant"},
    {"role": "user", "content": "$PROMPT"}
  ]
}
EOF
)"

echo "[test-litellm-sambanova] POST $LITELLM_BASE_URL/v1/chat/completions"
response="$(curl -fsS \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$LITELLM_BASE_URL/v1/chat/completions")"

echo "$response" | python3 - <<'PY'
import json,sys
obj=json.load(sys.stdin)
try:
    print(obj["choices"][0]["message"]["content"])
except Exception:
    print(json.dumps(obj, indent=2))
    raise
PY

echo "[test-litellm-sambanova] done"
