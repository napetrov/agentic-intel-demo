#!/usr/bin/env bash
set -euo pipefail

LITELLM_BASE_URL="${LITELLM_BASE_URL:-http://127.0.0.1:4000}"
LITELLM_MODEL="${LITELLM_MODEL:-sambanova}"
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

# Pass via env, not pipe: heredoc on stdin would override the pipe and
# json.load(sys.stdin) would read the heredoc body instead of $response.
RESPONSE="$response" python3 <<'PY'
import json, os
obj = json.loads(os.environ["RESPONSE"])
try:
    print(obj["choices"][0]["message"]["content"])
except Exception:
    print(json.dumps(obj, indent=2))
    raise
PY

echo "[test-litellm-sambanova] done"
