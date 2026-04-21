#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${TAG:-dev}"

SESSION_IMAGE="demo-session-pod:${TAG}"
CONTROL_IMAGE="demo-control-plane:${TAG}"

echo "[build-images] building $SESSION_IMAGE"
docker build -t "$SESSION_IMAGE" "$REPO_ROOT/legacy/runtimes/session-pod"

echo "[build-images] building $CONTROL_IMAGE"
docker build -t "$CONTROL_IMAGE" "$REPO_ROOT/legacy/services/control-plane"

echo "[build-images] done"
echo "  session image: $SESSION_IMAGE"
echo "  control image: $CONTROL_IMAGE"
