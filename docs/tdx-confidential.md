# Running a System A pod inside Intel TDX

The demo can mark one of its System A agents as **confidential** so the
session pod is admitted only on a node that exposes Intel Trust Domain
Extensions (TDX). Today the wiring covers:

- one TEE kind: `tdx` (Kata Containers + TDX, or Confidential Containers)
- one demo agent: `openclaw-a-3` (`config/agents.yaml`) — picks up the
  TDX requirement automatically when a session targets it
- one shipped architecture example: `templates/architecture/examples/two-system/architecture.yaml`
  declares a `confidential_runtimes[]` entry (`tdx-kata`)

This page is the operator runbook: what the control plane will do, what
you have to land on the cluster yourself, and how to verify it.

## What the control plane does for you

When a session is created with either:

- `agent_id` set to an agent whose registry entry has `confidential:
  tdx`, **or**
- an explicit `confidential: tdx` on the request

the kube backend (`runtimes/control-plane/session_manager.py:KubeSessionBackend._render_job`)
produces a `batch/v1.Job` whose Pod template carries:

| Field | Value | Override env var |
|-------|-------|------------------|
| `spec.runtimeClassName` | `kata-qemu-tdx` | `TDX_RUNTIME_CLASS` |
| `spec.nodeSelector[<key>]` | `intel.feature.node.kubernetes.io/tdx: "true"` | `TDX_NODE_SELECTOR_KEY`, `TDX_NODE_SELECTOR_VALUE` |
| `metadata.labels.confidential` | `tdx` | — |
| Pod template `labels.confidential` | `tdx` | — |
| Container env `CONFIDENTIAL` | `tdx` | — |

When `confidential` is not set, those fields are not just omitted — any
stale TDX label, runtimeClassName, nodeSelector key, or env var that the
operator-managed `session-job-template` ConfigMap might still carry from
a prior render is **scrubbed**. That's deliberate: a "no TEE" session
must never silently inherit a TDX scheduling constraint, otherwise the
Pod sits Pending on a regular cluster.

The resolved values are surfaced over HTTP at `GET /sessions/confidential-runtimes`
so the web UI and the operator can inspect what will actually be
requested without reading source.

## What you have to land on the cluster

The control plane assumes a node that already advertises TDX; nothing
in this repo installs the host-side bits.

1. **Hardware + BIOS.** Intel CPU with TDX (4th-gen Xeon Scalable or
   later), TDX enabled in BIOS, TDX module loaded.
2. **TDX-aware container runtime.** Pick one:
   - **Kata Containers + TDX** — the `kata-qemu-tdx` (or `kata-tdx`)
     RuntimeClass shipped by the [Kata project's TDX support](https://github.com/kata-containers/kata-containers/tree/main/docs/how-to).
   - **Confidential Containers (CoCo)** — the
     [confidential-containers/operator](https://github.com/confidential-containers/operator)
     installs RuntimeClass + the TDX shim for you. Note: image pulls
     inside a CoCo guest require a signed/encrypted image policy
     (KBS); the demo's session pod template uses
     `imagePullPolicy: Always` against a public registry, which works
     for unsigned reference images, but a real confidential setup
     pins this to a KBS resource policy.
3. **Node label.** Apply the label the control plane selects on:
   ```
   kubectl label node <tdx-node> intel.feature.node.kubernetes.io/tdx=true --overwrite
   ```
   The default key matches what NFD's Intel feature source typically
   exposes; if your cluster uses a different key, override
   `TDX_NODE_SELECTOR_KEY` / `TDX_NODE_SELECTOR_VALUE` on the
   control-plane Deployment.
4. **RuntimeClass name.** If your TDX runtime registers under a name
   other than `kata-qemu-tdx`, set `TDX_RUNTIME_CLASS`.

Smoke-check the cluster side:

```
kubectl get runtimeclass | grep -i tdx
kubectl get nodes -l intel.feature.node.kubernetes.io/tdx=true
```

If either is empty, a TDX-required Pod will sit Pending with an
`untolerated taint` / `0/N nodes are available: ... didn't match Pod
node affinity/selector` event. That's the intended fail-loud behavior
— a confidential workload must never silently fall through to a regular
node.

## Demo flow

After the cluster prerequisites are in place:

1. The shipped agent registry already marks `openclaw-a-3` as TDX. No
   edit needed.
2. Create a session targeting that agent:
   ```
   curl -fsS -X POST http://control-plane:8080/sessions \
     -H 'content-type: application/json' \
     -d '{"scenario": "terminal-agent", "profile": "small", "agent_id": "openclaw-a-3"}'
   ```
   The response carries `"confidential": "tdx"` even though the request
   didn't pass it explicitly — inherited from the registry.
3. Inspect the rendered Job:
   ```
   kubectl -n agents get jobs -l confidential=tdx
   kubectl -n agents get pod -l session-id=<id> -o yaml | grep -E 'runtimeClassName|nodeSelector'
   ```

## Promoting an arbitrary session onto TDX

For one-off runs (e.g. the web UI's "spawn N sessions" panel) the
explicit override wins:

```
curl -fsS -X POST http://control-plane:8080/sessions \
  -H 'content-type: application/json' \
  -d '{"scenario": "terminal-agent", "profile": "small", "confidential": "tdx"}'
```

Useful for testing the cluster wiring without re-flagging an agent.

## Adding a new TEE kind

The schema (`schemas/agents.schema.json`, `schemas/architecture.schema.json`)
treats the kind as a closed enum so a typo can't sneak through. To add
SGX / SEV-SNP / etc.:

1. Extend `CONFIDENTIAL_KINDS` in
   `runtimes/control-plane/agent_registry.py` and
   `runtimes/control-plane/session_manager.py`.
2. Add an entry to `confidential_scheduling_defaults()` with the new
   kind's RuntimeClass name and node-selector key.
3. Update both JSON schemas' `enum` lists.
4. Update `CONFIDENTIAL_KINDS` in `scripts/validate-demo-templates.py`.
5. Land the matching cluster-side runtime + node labels.
