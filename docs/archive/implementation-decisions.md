# Implementation Decisions — Working Demo Setup

This document closes the immediate blocking decisions needed to start implementation.

## 1. Image distribution path

### Decision
- **Single-node validation on `onedal-build`**: build images locally and import into the target k3s instance with `ctr images import`
- **Real two-host demo**: use **GHCR** as the default image registry

### Why
- `ctr images import` is the shortest path for local validation, no registry setup required
- GHCR is reproducible, simple enough for a demo, and avoids ad-hoc per-host image copying once System A / B are separate machines

### Required image set
- `demo-control-plane`
- `demo-session-pod`
- `demo-offload-worker`

## 2. Offload API contract

### Decision
`POST /jobs`
```json
{
  "job_type": "analytics",
  "session_id": "sess-123",
  "input": {
    "artifacts": ["s3://demo-artifacts/sess-123/inputs/input.json"]
  },
  "params": {
    "task": "market_research"
  },
  "result_prefix": "s3://demo-artifacts/sess-123/outputs/job-456/"
}
```

Response:
```json
{
  "job_id": "job-456",
  "status": "submitted"
}
```

`GET /jobs/{job_id}`
```json
{
  "job_id": "job-456",
  "session_id": "sess-123",
  "status": "submitted|running|succeeded|failed",
  "result_manifest": "s3://demo-artifacts/sess-123/outputs/job-456/result.json",
  "error": null
}
```

## 3. Result artifact contract

### Decision
Every offload job and scale-up job must produce a `result.json` manifest.

Schema:
```json
{
  "status": "succeeded|failed",
  "summary": "short human-readable result",
  "artifacts": [
    {
      "kind": "report|table|log|file",
      "uri": "s3://demo-artifacts/...",
      "name": "report.md"
    }
  ],
  "metrics": {
    "duration_sec": 12.4
  },
  "error": null
}
```

### Rule
- control plane and session pod only rely on `result.json`
- any extra files are referenced from the manifest

## 4. Session lifecycle / cleanup policy

### Decision
- create session pod on first user message
- reuse the same pod for that user/chat while active
- mark session stale after **30 minutes** without messages
- hard-delete stale session pod after **2 hours** idle for MVP
- sibling execution jobs use `ttlSecondsAfterFinished`

### Why
- simple enough for demo
- avoids pod leaks
- keeps user experience stable during short interactive sessions

## 5. Implementation order
1. single-node validation on `onedal-build`
2. ollama + LiteLLM path
3. MinIO path
4. control plane skeleton
5. session pod image
6. Task 1 end-to-end
