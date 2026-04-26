#!/usr/bin/env bash
# Build the offload-worker image locally and load it into a k3s or k3d
# cluster, for testing without GHCR access.
#
# Why this exists: k8s/system-b/offload-worker.yaml defaults to
# `ghcr.io/<owner>/agentic-intel-demo/offload-worker:main` with
# `imagePullPolicy: IfNotPresent`. On a fresh local cluster that image
# may not be reachable (private repo, air-gapped network, registry
# down). This script builds the image from runtimes/offload-worker/ and
# imports it under tag `demo-offload-worker:latest`, then prints the
# `sed` patch you can pipe into `kubectl apply` to use it.
#
# Usage:
#   ./scripts/load-offload-worker-image.sh                # autodetect k3d / k3s
#   RUNTIME=k3d K3D_CLUSTER=demo ./scripts/load-offload-worker-image.sh
#   RUNTIME=k3s ./scripts/load-offload-worker-image.sh
#
# After loading, apply the patched manifest:
#   sed -e 's|ghcr.io/napetrov/agentic-intel-demo/offload-worker:main|demo-offload-worker:latest|' \
#       -e 's|imagePullPolicy: IfNotPresent|imagePullPolicy: Never|' \
#     k8s/system-b/offload-worker.yaml | kubectl apply -f -
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-demo-offload-worker:latest}"
WORKER_DIR="${WORKER_DIR:-runtimes/offload-worker}"
RUNTIME="${RUNTIME:-auto}"
K3D_CLUSTER="${K3D_CLUSTER:-demo}"

if [ ! -f "$WORKER_DIR/Dockerfile" ]; then
  echo "[load-offload-worker-image] $WORKER_DIR/Dockerfile not found" >&2
  echo "                           run from the repo root or set WORKER_DIR=." >&2
  exit 64
fi

command -v docker >/dev/null 2>&1 \
  || { echo "[load-offload-worker-image] docker not found" >&2; exit 127; }

if [ "$RUNTIME" = "auto" ]; then
  # `\b` is GNU-grep-only; on macOS BSD grep this becomes a literal
  # backslash and the pattern silently never matches. Filter to the
  # NAME column and use grep -Fxq for a portable exact match.
  if command -v k3d >/dev/null 2>&1 \
    && k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$K3D_CLUSTER"; then
    RUNTIME=k3d
  elif command -v k3s >/dev/null 2>&1 || [ -S /run/k3s/containerd/containerd.sock ]; then
    RUNTIME=k3s
  else
    echo "[load-offload-worker-image] no k3d cluster '${K3D_CLUSTER}' and no k3s found" >&2
    echo "                           set RUNTIME=k3d|k3s explicitly." >&2
    exit 2
  fi
fi

echo "[load-offload-worker-image] building $IMAGE_TAG from $WORKER_DIR"
docker build -t "$IMAGE_TAG" "$WORKER_DIR"

case "$RUNTIME" in
  k3d)
    command -v k3d >/dev/null 2>&1 \
      || { echo "[load-offload-worker-image] k3d not found" >&2; exit 127; }
    echo "[load-offload-worker-image] importing into k3d cluster '$K3D_CLUSTER'"
    k3d image import "$IMAGE_TAG" -c "$K3D_CLUSTER"
    ;;
  k3s)
    # k3s ships its own containerd; import via `ctr` against the k3s socket.
    SOCK="${K3S_CONTAINERD_SOCK:-/run/k3s/containerd/containerd.sock}"
    if [ ! -S "$SOCK" ]; then
      echo "[load-offload-worker-image] k3s containerd socket not found at $SOCK" >&2
      exit 2
    fi
    echo "[load-offload-worker-image] importing into k3s containerd at $SOCK"
    docker save "$IMAGE_TAG" \
      | sudo k3s ctr --address "$SOCK" --namespace k8s.io images import -
    ;;
  *)
    echo "[load-offload-worker-image] unknown RUNTIME=$RUNTIME (use k3d|k3s)" >&2
    exit 64
    ;;
esac

cat <<EOF

[load-offload-worker-image] done. To apply the manifest with the local image:

  sed -e 's|ghcr.io/napetrov/agentic-intel-demo/offload-worker:main|${IMAGE_TAG}|' \\
      -e 's|imagePullPolicy: IfNotPresent|imagePullPolicy: Never|' \\
    k8s/system-b/offload-worker.yaml | kubectl apply -f -
EOF
