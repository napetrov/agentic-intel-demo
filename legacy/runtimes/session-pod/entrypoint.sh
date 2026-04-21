#!/usr/bin/env bash
set -euo pipefail

CONFIG_SRC="${OPENCLAW_CONFIG_PATH:-/config/openclaw.json}"

if [ ! -f "$CONFIG_SRC" ]; then
  echo "[session-pod] missing OpenClaw config: $CONFIG_SRC" >&2
  exit 1
fi

# Prepare openclaw state dir
OC_DIR="${HOME:-/home/openclaw}/.openclaw"
mkdir -p "$OC_DIR"
cp "$CONFIG_SRC" "$OC_DIR/openclaw.json"
echo "[session-pod] config loaded from $CONFIG_SRC"

exec openclaw gateway run --verbose --allow-unconfigured
