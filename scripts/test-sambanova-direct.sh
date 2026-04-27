#!/usr/bin/env bash
set -euo pipefail

SAMBANOVA_API_KEY="${SAMBANOVA_API_KEY:-}"
SAMBANOVA_MODEL="${SAMBANOVA_MODEL:-DeepSeek-V3.1}"
SAMBANOVA_URL="${SAMBANOVA_URL:-https://api.sambanova.ai/v1/chat/completions}"
PROMPT="${PROMPT:-Hello! Reply with exactly: sambanova ok}"

if [ -z "$SAMBANOVA_API_KEY" ]; then
  echo "[test-sambanova-direct] SAMBANOVA_API_KEY is required" >&2
  exit 1
fi

payload="$(cat <<EOF
{
  "stream": false,
  "model": "$SAMBANOVA_MODEL",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant"},
    {"role": "user", "content": "$PROMPT"}
  ]
}
EOF
)"

echo "[test-sambanova-direct] POST $SAMBANOVA_URL"
response="$(curl -fsS \
  -H "Authorization: Bearer $SAMBANOVA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  -X POST "$SAMBANOVA_URL")"

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

echo "[test-sambanova-direct] done"
