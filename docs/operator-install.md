# Operator Install Guide

This guide treats `openclaw-operator` as the only supported path for instance lifecycle.

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
