# Service Port Map

Fixed NodePort assignments for all cross-cluster services.
These values are set explicitly in k8s manifests — never auto-assigned.

---

## System B — services exposed to System A

| Service | Namespace | NodePort | Protocol | Used by |
|---------|-----------|----------|----------|---------|
| ollama (SLM) | system-b | **30434** | HTTP | LiteLLM on System A |
| MinIO API | system-b | **30900** | HTTP (S3) | Control Plane artifact relay |
| MinIO Console | system-b | **30901** | HTTP | Admin/debug only |
| Offload API | system-b | **30800** | HTTP | Control Plane offload gateway |

## System A — services exposed externally (for scripts, smoke tests)

| Service | Namespace | NodePort | Protocol | Used by |
|---------|-----------|----------|---------|---------|
| Control Plane API | platform | **31000** | HTTP | deploy scripts, smoke tests |
| LiteLLM proxy | inference | **31400** | HTTP | external model call tests |
| Flowise (alt orchestrator) | agents | **31300** | HTTP | optional flow-builder UI; see `docs/flowise-integration.md` |

## In-cluster only (ClusterIP, not NodePort)

| Service | Namespace | ClusterIP DNS | Used by |
|---------|-----------|--------------|---------|
| LiteLLM | inference | `litellm.inference.svc.cluster.local:4000` | session pods |
| Control Plane | platform | `control-plane.platform.svc.cluster.local:8080` | chat gateway |

---

## k3s install parameters

To avoid pod CIDR overlap between two k3s clusters on the same LAN:

```bash
# System A
curl -sfL https://get.k3s.io | sh -s - \
  --cluster-cidr=10.42.0.0/16 \
  --service-cidr=10.96.0.0/16 \
  --cluster-dns=10.96.0.10 \
  --disable=traefik \
  --disable=servicelb \
  --https-listen-port=6443

# System B
curl -sfL https://get.k3s.io | sh -s - \
  --cluster-cidr=10.43.0.0/16 \
  --service-cidr=10.97.0.0/16 \
  --cluster-dns=10.97.0.10 \
  --disable=traefik \
  --disable=servicelb \
  --https-listen-port=6443
```

## Single-node validation on onedal-build

If running both "systems" on one machine, use different API server ports:

```bash
# System A on onedal-build
curl -sfL https://get.k3s.io | K3S_KUBECONFIG_OUTPUT=/etc/rancher/k3s/k3s-a.yaml sh -s - \
  --cluster-cidr=10.42.0.0/16 \
  --service-cidr=10.96.0.0/16 \
  --https-listen-port=6443 \
  --data-dir=/var/lib/rancher/k3s-a \
  --disable=traefik --disable=servicelb

# System B on onedal-build
curl -sfL https://get.k3s.io | K3S_KUBECONFIG_OUTPUT=/etc/rancher/k3s/k3s-b.yaml sh -s - \
  --cluster-cidr=10.43.0.0/16 \
  --service-cidr=10.97.0.0/16 \
  --https-listen-port=6444 \
  --data-dir=/var/lib/rancher/k3s-b \
  --disable=traefik --disable=servicelb
```

After install, fix server address in kubeconfig (change 127.0.0.1 to actual LAN IP):
```bash
sed -i 's|127.0.0.1|<LAN_IP>|g' /etc/rancher/k3s/k3s-a.yaml
sed -i 's|127.0.0.1|<LAN_IP>|g' /etc/rancher/k3s/k3s-b.yaml
chmod 600 /etc/rancher/k3s/k3s-a.yaml
chmod 600 /etc/rancher/k3s/k3s-b.yaml
```

kubeconfig merge:
```bash
export KUBECONFIG=/etc/rancher/k3s/k3s-a.yaml:/etc/rancher/k3s/k3s-b.yaml
kubectl config get-contexts   # should show both
```

---

## Cross-cluster DNS note

k3s clusters have separate CoreDNS — `svc.cluster.local` does NOT cross clusters.
All cross-system references use `<system-b-ip>:<NodePort>` hardcoded in configs.
Configure in `config/env/system-b.yaml`:

```yaml
system_b_node_ip: "192.168.x.x"   # fill in actual LAN IP
```

Do NOT rely on cluster DNS for cross-system service names.
