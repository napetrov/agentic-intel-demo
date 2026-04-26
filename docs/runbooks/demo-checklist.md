# Demo Checklist

For the full bring-up procedure see `docs/runbooks/tier2-bring-up.md`.
This file is the *minute-before-demo* checklist.

Before demo:
- `make tier2-preflight` passes on the deploy workstation
- `make tier2-secrets-verify` passes for both clusters
- `APPLY=1 make tier2-smoke` left the instance Running (or `KEEP=1` from last bring-up)
- `APPLY=1 make tier2-demo-task-smoke` passes (gateway + LiteLLM + Telegram config)
- `make tier2-logs WHICH=operator` shows recent successful reconciles, no errors
- Telegram bot responds to /start (golden DM is the next bullet)
- guided buttons are visible after `/demo`
- standard and large session pod profiles available on System A
- System B is reachable for offload (`make tier2-offload-smoke` passed earlier today)
- sample scenarios return expected status updates
- fallback messages are working

Golden path:
- Terminal Agent
- Market Research
- Large Build/Test
