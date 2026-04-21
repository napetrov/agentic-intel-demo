#!/usr/bin/env bash
set -euo pipefail

TAG="${TAG:-dev}"
CTR_BIN="${CTR_BIN:-k3s}"
CTR_SUBCOMMAND="${CTR_SUBCOMMAND:-ctr images import -}"

SESSION_IMAGE="demo-session-pod:${TAG}"
CONTROL_IMAGE="demo-control-plane:${TAG}"

import_image() {
  local image="$1"
  echo "[load-images-system-a] importing $image"
  docker save "$image" | "$CTR_BIN" ${CTR_SUBCOMMAND}
}

import_image "$SESSION_IMAGE"
import_image "$CONTROL_IMAGE"

echo "[load-images-system-a] done"
