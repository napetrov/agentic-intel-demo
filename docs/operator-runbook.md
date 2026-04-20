# OpenClaw Operator Runbook

This document captures the current operator-oriented deployment and recovery path for the demo.

For this repo, `openclaw-operator` is the canonical and only supported path for creating and managing OpenClaw instances.

It exists because one real cluster-specific blocker was found during bring-up, and because the repo still contains older raw-manifest materials that should no longer be treated as the main lifecycle path.

---

## Current known blocker

When installing the operator with raw manifests via `kubectl apply -k`, the CRD for:

`openclawinstances.openclaw.rocks`

can fail with:

`metadata.annotations: Too long`

This is caused by Kubernetes storing a very large `kubectl.kubernetes.io/last-applied-configuration` annotation on the CRD object.

This is not an OpenClaw runtime bug. It is an install-method issue for this cluster/operator manifest shape.

---

## Working recovery strategy

### Preferred
Use one of these approaches for the CRD step:
- server-side apply for the CRD
- create/replace the CRD without the giant last-applied annotation
- apply the CRD separately, then apply the controller manifests

### Avoid
Avoid relying on a single `kubectl apply -k` for the whole operator bundle if the CRD is large enough to trigger annotation limits.

---

## Recommended install order

### 1. Apply namespace/RBAC/controller prerequisites
Apply the operator prerequisites first, excluding the large CRD if needed.

### 2. Apply the CRD separately
Example patterns:

```bash
kubectl apply --server-side -f config/crd/bases/openclawinstances.openclaw.rocks.yaml
```

or:

```bash
kubectl create -f config/crd/bases/openclawinstances.openclaw.rocks.yaml \
  || kubectl replace -f config/crd/bases/openclawinstances.openclaw.rocks.yaml
```

### 3. Apply or restart the operator controller
After the CRD exists successfully, apply the rest of the operator manifests and wait for the controller deployment.

### 4. Create the `OpenClawInstance`
Only after the CRD and controller are healthy.

---

## Verification checklist

Use these checks after install:

```bash
kubectl get crd openclawinstances.openclaw.rocks
kubectl get pods -A | grep -E 'openclaw|operator'
kubectl get openclawinstances -A
kubectl describe openclawinstance -A
kubectl logs deploy/openclaw-operator-controller-manager -n openclaw-operator-system --tail=200
```

A good intermediate state is:
- CRD exists
- operator controller pod is Running
- `OpenClawInstance` object is created
- instance moves past `Provisioning`

---

## Operator-first rule

Use the operator for:
- instance creation
- instance update
- instance deletion
- instance recovery

Do not treat direct raw pod/deployment creation as the supported way to manage OpenClaw instances.

## What the demo already proved

During bring-up, the following states were already observed:
- operator controller deployment came up
- `OpenClawInstance` creation started
- `intel-demo-operator` reached `Provisioning`
- related service object was created

That means the operator path is close, but not yet documented well enough to be reproducible.

---

## What is still required for operator success

The operator path still depends on all of the following being true:

### Cluster access
- a working `kubectl` binary on the actual host where the cluster is managed
- kubeconfig access that works for the chosen user or via `sudo`

### Operator install hygiene
- CRD applied in a way that avoids annotation-size failure
- operator namespace, RBAC, webhooks, and controller deployment all healthy

### Runtime dependencies
- the image referenced by the operator is available to the cluster
- required secrets are present
- any referenced model/backing services are reachable

### Instance spec correctness
- `OpenClawInstance` spec must point to valid image, secrets, and service endpoints
- if the operator-managed runtime expects Bedrock, Telegram, or MinIO credentials, those must already exist

---

## Missing pieces to close next

For this repo, the remaining work is mostly operational clarity:
- document the exact operator manifests/source path
- document the exact `OpenClawInstance` sample used for the demo
- document the required secrets for operator-managed deployment
- document image loading strategy for the operator-managed image
- document controller log checks and failure signatures

Until those are written down, the operator path is not reproducible enough.
