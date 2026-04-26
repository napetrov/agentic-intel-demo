# SambaNova Integration Notes

## Short answer

Yes, SambaNova can be connected through LiteLLM.

LiteLLM has a documented `sambanova/` provider path, and the LiteLLM proxy config accepts models like:

```yaml
model_list:
  - model_name: sambanova
    litellm_params:
      model: sambanova/DeepSeek-V3.1
      api_key: os.environ/SAMBANOVA_API_KEY
```

The canonical alias is `sambanova` (matching `default`, `fast`, `reasoning`
in the rest of the stack); referenced as `litellm/sambanova` from
`operator-chat-config.template.json` and `examples/openclawinstance-intel-demo.yaml`.

## Why this should work

SambaNova exposes an OpenAI-compatible chat completions interface.
The provided curl example uses:

- `POST https://api.sambanova.ai/v1/chat/completions`
- bearer token auth
- OpenAI-style `messages`
- streaming enabled

LiteLLM documents a native `sambanova/` provider route, so using LiteLLM is cleaner than trying to treat SambaNova as an arbitrary generic OpenAI endpoint in this repo.

## What was added in repo

The repo now includes:
- `SAMBANOVA_API_KEY` in `k8s/shared/intel-demo-operator-secrets.yaml.template`
- LiteLLM route `sambanova` in `k8s/system-a/litellm.yaml`
- `SAMBANOVA_API_KEY` env handling via the LiteLLM Deployment env or a k8s Secret (the earlier shell-wrapper setup path has been removed)
- direct and LiteLLM smoke-test scripts for SambaNova

## Suggested validation

Direct API validation:

```bash
curl -H "Authorization: Bearer $SAMBANOVA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "stream": true,
    "model": "DeepSeek-V3.1",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant"},
      {"role": "user", "content": "Hello!"}
    ]
  }' \
  -X POST https://api.sambanova.ai/v1/chat/completions
```

LiteLLM validation after deploy:

```bash
curl -sS http://<SYSTEM_A_IP>:31400/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "sambanova",
    "messages": [
      {"role": "user", "content": "Hello from LiteLLM"}
    ]
  }'
```

## Validation scripts

The repo now includes:
- `scripts/test-sambanova-direct.sh`
- `scripts/test-litellm-sambanova.sh`

Direct test example:

```bash
export SAMBANOVA_API_KEY=...
./scripts/test-sambanova-direct.sh
```

LiteLLM test example:

```bash
export LITELLM_BASE_URL=http://<SYSTEM_A_IP>:31400
./scripts/test-litellm-sambanova.sh
```

## Current limitation

I verified docs and updated repo config, but I have not yet executed a live LiteLLM-to-SambaNova request from the target cluster environment in this session.
So this is now wired in config, with runnable tests added, but not yet cluster-verified.
