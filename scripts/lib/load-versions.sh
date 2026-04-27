#!/usr/bin/env bash
# Read selected pins from config/versions.yaml and emit `KEY=VALUE` lines on
# stdout. Designed to be eval'd or sourced into other scripts.
#
# Usage:
#   eval "$(scripts/lib/load-versions.sh)"   # export vars into current shell
#   scripts/lib/load-versions.sh > .versions.env  # capture for docker compose
#
# Env vars produced:
#   OPENCLAW_OPERATOR_REF      <- versions.yaml: operator.ref
#   OPENCLAW_OPERATOR_IMAGE    <- versions.yaml: operator.image
#   MINIO_IMAGE                <- versions.yaml: compose_minio_image
#   MINIO_MC_IMAGE             <- versions.yaml: compose_minio_mc_image
#   K8S_MINIO_IMAGE            <- versions.yaml: minio_image (k8s/system-b/minio.yaml)
#   LITELLM_IMAGE              <- versions.yaml: litellm_image
#   K3S_VERSION                <- versions.yaml: components.k3s
#
# Existing values in the calling environment win — `eval` of this output
# uses `: "${VAR:=...}"` which only assigns when VAR is unset or empty.
# That keeps CI overrides and per-shell overrides working unchanged.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSIONS_PATH="${VERSIONS_PATH:-$REPO_ROOT/config/versions.yaml}"

if [ ! -f "$VERSIONS_PATH" ]; then
  echo "[load-versions] $VERSIONS_PATH not found" >&2
  exit 2
fi

python3 - "$VERSIONS_PATH" <<'PY'
import shlex
import sys
import yaml

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = yaml.safe_load(f) or {}

# (env_name, dotted-path) pairs. Missing keys are simply skipped — that's
# how the helper stays usable while versions.yaml grows.
mapping = [
    ("OPENCLAW_OPERATOR_REF",   ["operator", "ref"]),
    ("OPENCLAW_OPERATOR_IMAGE", ["operator", "image"]),
    ("MINIO_IMAGE",             ["components", "compose_minio_image"]),
    ("MINIO_MC_IMAGE",          ["components", "compose_minio_mc_image"]),
    ("K8S_MINIO_IMAGE",         ["components", "minio_image"]),
    ("LITELLM_IMAGE",           ["components", "litellm_image"]),
    ("K3S_VERSION",             ["components", "k3s"]),
]


def lookup(d, path):
    cur = d
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur


for env_name, path in mapping:
    val = lookup(data, path)
    if val is None:
        continue
    if not isinstance(val, (str, int, float)):
        continue
    # `: "${VAR:=value}"` keeps a caller-set VAR intact, which matches the
    # rest of the demo's "env wins over file" convention.
    print(f': "${{{env_name}:={shlex.quote(str(val))}}}"')
    print(f"export {env_name}")
PY
