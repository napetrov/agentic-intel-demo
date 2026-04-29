#!/usr/bin/env bash
# Safely render and apply k8s/system-b/offload-worker.yaml.
#
# The manifest embeds shell scenario scripts in a ConfigMap. Those scripts
# intentionally contain runtime variables such as $SCENARIO_DIR, $PICKED_ID,
# and ${TASKFLOW_API_URL:-}. Running plain `envsubst` over the whole manifest
# would erase those shell variables before Kubernetes ever mounts the scripts.
#
# This helper uses exact text replacement for the deploy-time image knobs and
# leaves all scenario-script runtime variables intact.
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
MANIFEST="${MANIFEST:-k8s/system-b/offload-worker.yaml}"
DEFAULT_IMAGE="ghcr.io/napetrov/agentic-intel-demo/offload-worker:main"
DEFAULT_PULL_POLICY="Always"

if [ ! -f "$MANIFEST" ]; then
  echo "[apply-offload-worker] manifest not found: $MANIFEST" >&2
  echo "                         run from the repo root or set MANIFEST=..." >&2
  exit 64
fi

if [ -n "${OFFLOAD_WORKER_IMAGE:-}" ]; then
  pull_policy="${OFFLOAD_WORKER_IMAGE_PULL_POLICY:-Never}"
  echo "[apply-offload-worker] applying $MANIFEST with image=$OFFLOAD_WORKER_IMAGE pullPolicy=$pull_policy" >&2
  python3 - "$MANIFEST" "$DEFAULT_IMAGE" "$OFFLOAD_WORKER_IMAGE" "$DEFAULT_PULL_POLICY" "$pull_policy" <<'PY' | $KUBECTL apply -f -
from pathlib import Path
import sys

path, default_image, image, default_pull_policy, pull_policy = sys.argv[1:]
text = Path(path).read_text(encoding="utf-8")
old_image = f"image: {default_image}"
new_image = f"image: {image}"
if old_image not in text:
    raise SystemExit(f"expected image line not found: {old_image}")
text = text.replace(old_image, new_image, 1)
old_policy = f"imagePullPolicy: {default_pull_policy}"
new_policy = f"imagePullPolicy: {pull_policy}"
if old_policy not in text:
    raise SystemExit(f"expected pull policy line not found: {old_policy}")
text = text.replace(old_policy, new_policy, 1)
print(text, end="")
PY
else
  echo "[apply-offload-worker] applying $MANIFEST without rendering" >&2
  $KUBECTL apply -f "$MANIFEST"
fi
