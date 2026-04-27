# Operator Config Checklist

This checklist answers the practical question: what is still missing in config for operator-managed OpenClaw to work reliably?

Legend:
- ✅ present in repo
- 🟡 present but not yet live-validated
- 🔴 missing or not pinned precisely enough

---

## 1. `OpenClawInstance` spec shape
- sample `OpenClawInstance` exists: ✅
- spec is validated against the current live CRD schema: 🔴
- exact operator bundle/ref that defines the schema is pinned: 🔴

What to close:
- pin the operator source/revision
- validate `examples/openclawinstance-intel-demo.yaml` against the real CRD

---

## 2. Secrets contract
- `TELEGRAM_BOT_TOKEN`: ✅
- `AWS_BEARER_TOKEN_BEDROCK`: ✅
- `SAMBANOVA_API_KEY`: ✅
- `MINIO_ACCESS_KEY`: ✅
- `MINIO_SECRET_KEY`: ✅
- exact mapping between secret keys and operator/runtime consumption is live-validated: 🔴

What to close:
- confirm the operator/runtime really projects these keys into the running pod as expected

---

## 3. Telegram config
- bot token wiring present: ✅
- allowlist wiring present: ✅
- operator-managed runtime mode for Telegram fully confirmed: 🟡
- end-to-end Telegram request/response verified after operator refactor: 🔴

What to close:
- verify whether polling/webhook mode needs explicit config under the real operator-managed OpenClaw schema
- verify bot actually connects and responds

---

## 4. Model/provider config
- LiteLLM provider configured: ✅
- Bedrock provider configured: ✅
- SambaNova path configured in LiteLLM: ✅
- local vLLM path configured: ✅
- final default routing policy for the demo is fully decided: 🔴

What to close:
- decide which provider is primary for the operator-managed demo:
  - Bedrock primary + LiteLLM fallback
  - LiteLLM/vLLM primary + Bedrock fallback
  - LiteLLM/SambaNova optional route only

---

## 5. Image/runtime contract
- image repository/tag present in sample instance: ✅
- exact image required by operator-managed runtime is pinned and confirmed: 🔴
- image pull strategy documented: 🟡

What to close:
- confirm the exact runtime image tag
- confirm if cluster pulls from registry or requires preload/import
- add imagePullSecret if needed

---

## 6. Supporting endpoints
- LiteLLM URL present in config: ✅
- Bedrock URL present in config: ✅
- SambaNova API route present in LiteLLM config: ✅
- MinIO creds present in secrets template: ✅
- all endpoint reachability re-validated after latest changes: 🔴

What to close:
- re-run health checks from the target cluster/runtime

---

## 7. Operator install config
- runbook exists: ✅
- install helper exists: ✅
- exact operator manifests path/ref pinned: 🔴
- CRD-safe install automated end-to-end: 🟡

What to close:
- pin real operator source path/ref
- turn helper into a real install script once source path is known

---

## Practical minimum to get to first green

These are the config items that matter most:
1. pin exact operator schema source
2. validate `OpenClawInstance` sample against that schema
3. confirm secret keys are injected into runtime
4. decide final default model route
5. live-check Telegram connection
