import json
import os
import sys
import urllib.request

payload = {
    "tool": "message",
    "args": {
        "action": "send",
        "channel": "telegram",
        "target": sys.argv[1] if len(sys.argv) > 1 else "7197542485",
        "message": "Agentic Intel Demo ready. Choose a scenario:",
        "buttons": [
            [
                {"text": "Terminal Agent", "callback_data": "scenario:terminal_agent"},
                {"text": "Market Research", "callback_data": "scenario:market_research"}
            ],
            [
                {"text": "Large Build/Test", "callback_data": "scenario:large_build_test"},
                {"text": "Open Chat Mode", "callback_data": "mode:chat"}
            ],
            [
                {"text": "Show Status", "callback_data": "action:status"},
                {"text": "Reset Session", "callback_data": "action:reset"}
            ]
        ]
    }
}

req = urllib.request.Request(
    "http://127.0.0.1:18789/tools/invoke",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['OPENCLAW_GATEWAY_TOKEN']}",
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(req, timeout=20) as resp:
    print(resp.read().decode("utf-8"))
