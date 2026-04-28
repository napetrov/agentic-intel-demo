# Operator Install Guide

This guide treats `openclaw-operator` as the only supported path for instance lifecycle.

`openclaw-operator` is an **external upstream project** — we consume it as-is,
we do not fork it. The install script clones the upstream repo and checks out
a configurable ref:

- **Upstream repo** (`OPENCLAW_OPERATOR_REPO`): defaults to
  `https://github.com/openclaw-rocks/openclaw-operator.git`.
- **Upstream ref** (`OPENCLAW_OPERATOR_REF`): defaults to `v0.30.0` (the
  candidate pin recorded in `config/versions.yaml` and
  `docs/versions-tested.md`). Override in your environment to bump; the
  script prints a "candidate ref" notice unless
  `OPENCLAW_OPERATOR_REF_VERIFIED=1` is set.
- **CRD path** (`OPERATOR_CRD_PATH`): defaults to
  `config/crd/bases/openclawinstances.openclaw.rocks.yaml` inside the
  checkout.
- **Manifests path** (`OPERATOR_MANIFESTS_PATH`): defaults to `config/default`
  inside the checkout.

By default `scripts/install-openclaw-operator.sh` runs in dry-run mode and
only prints the kubectl commands it would execute. Set `APPLY=1` to actually
clone and apply against the current kube context.

## Safe install order

1. apply the CRD separately
2. avoid oversized `last-applied-configuration` annotation on the CRD
3. apply the rest of the operator manifests
4. verify controller health
5. apply `k8s/shared/intel-demo-operator-secrets.yaml.template` with real values
6. apply `examples/openclawinstance-intel-demo.yaml`

## Why the CRD is special

The CRD `openclawinstances.openclaw.rocks` previously failed on-cluster with:

`metadata.annotations: Too long`

So the CRD should not be treated as just another file in a naive `kubectl apply -k` bundle if that reintroduces a giant client-side apply annotation.

## Preferred install command shape

```bash
# Dry-run first (no kubectl, no clone with apply):
OPENCLAW_OPERATOR_REF=v0.30.0 ./scripts/install-openclaw-operator.sh

# Then apply against the current kube context:
APPLY=1 OPENCLAW_OPERATOR_REF=v0.30.0 ./scripts/install-openclaw-operator.sh
```

Equivalent raw commands (what the script runs in `server-side-crd` mode):

```bash
kubectl apply --server-side -f <CRD_PATH>
kubectl apply -k <OPERATOR_MANIFESTS_PATH>
```

## After install

```bash
kubectl get crd openclawinstances.openclaw.rocks
kubectl get pods -A | grep -E 'openclaw|operator'
kubectl logs deploy/openclaw-operator-controller-manager -n openclaw-operator-system --tail=200
```

## Then create an instance

```bash
kubectl apply -f k8s/shared/intel-demo-operator-secrets.yaml.template
kubectl apply -f examples/openclawinstance-intel-demo.yaml
```

## Passing a GitHub token (`GH_TOKEN`) to the instance

The OpenClaw instance can consume a GitHub PAT internally — it is used
by tools running inside the session pod (`git`, `gh`, private GHCR
pulls), never exposed on the gateway API or written into
`openclaw.json`. The token has to land in **two** Secrets, in two
namespaces:

| Secret | Namespace | Read by |
|--------|-----------|---------|
| `intel-demo-operator-secrets` | `default` | the operator gateway pod via `OpenClawInstance.spec.envFromSecrets` |
| `github-token` | `agents` | the session pod via `secretKeyRef` in `k8s/system-a/session-pod-template.yaml` |

The mirror into `agents` is mandatory because `secretKeyRef` cannot
cross namespaces — without it the session pod boots, but with no
`GH_TOKEN`/`GITHUB_TOKEN` env var set.

**Recommended path** — let `scripts/create-operator-secrets.sh` create
both:

```bash
APPLY=1 SCOPE=system-a KUBECTL="kubectl --context system-a" \
  TELEGRAM_BOT_TOKEN=... AWS_BEARER_TOKEN_BEDROCK=... \
  SAMBANOVA_API_KEY="${SAMBANOVA_API_KEY:-}" \
  MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
  GH_TOKEN=ghp_... \
  ./scripts/create-operator-secrets.sh
```

This writes both Secrets via `kubectl create secret --dry-run=client
-o yaml | kubectl apply -f -`, so plaintext never lands on disk.
Re-running with `GH_TOKEN` **un**set deletes the mirror in `agents` —
that's the canonical "revoke agent GitHub access" gesture.

**Manual `kubectl apply` path** — if you must edit
`k8s/shared/intel-demo-operator-secrets.yaml.template` directly, you
**also** have to create `github-token` in `agents` yourself, e.g.:

```bash
kubectl --context system-a create secret generic github-token \
  -n agents --from-literal=GH_TOKEN=ghp_... \
  --dry-run=client -o yaml \
  | kubectl --context system-a apply -f -
```

Editing the template alone is **not** sufficient — the session pod
will boot without a credential because the `secretKeyRef`s in
`k8s/system-a/session-pod-template.yaml` are `optional: true`.

The session pod exposes the value under both `GH_TOKEN` and
`GITHUB_TOKEN` so tools that look for either name find it. To verify
wiring without reading the value:

```bash
SCOPE=system-a ./scripts/verify-operator-secrets.sh
# Set REQUIRE_GH_TOKEN=1 to upgrade the "missing token" warning to a
# hard failure on stands where GitHub access is mandatory.
```

See `docs/runbooks/tier2-bring-up.md` "GitHub token (`GH_TOKEN`)
wiring" for the full flow, including rotation and removal.
