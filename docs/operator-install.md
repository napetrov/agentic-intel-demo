# Operator Install Guide

This guide treats `openclaw-operator` as the only supported path for instance lifecycle.

`openclaw-operator` is an **external upstream project** — we consume it as-is,
we do not fork it. The install script clones the upstream repo and checks out
a configurable ref:

- **Upstream repo** (`OPENCLAW_OPERATOR_REPO`): defaults to
  `https://github.com/openclaw-rocks/openclaw-operator.git`.
- **Upstream ref** (`OPENCLAW_OPERATOR_REF`): defaults to `main`. Pin to a
  tag or commit SHA in your environment for reproducible installs — the
  script prints a warning when left at `main`.
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
OPENCLAW_OPERATOR_REF=v0.1.0 ./scripts/install-openclaw-operator.sh

# Then apply against the current kube context:
APPLY=1 OPENCLAW_OPERATOR_REF=v0.1.0 ./scripts/install-openclaw-operator.sh
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
