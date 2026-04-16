#!/usr/bin/env bash
set -euo pipefail

SYSTEM_A_HOST="${SYSTEM_A_HOST:-onedal-build}"

ssh -o BatchMode=yes "$SYSTEM_A_HOST" bash <<'EOF'
set -euo pipefail

echo '=== before ==='
df -h /
sudo -n journalctl --disk-usage || true

echo '=== cleanup ==='
sudo -n crictl rmi --prune 2>/dev/null || true
sudo -n k3s crictl rmi --prune 2>/dev/null || true
sudo -n journalctl --vacuum-time=3d || true
sudo -n apt-get clean || true
sudo -n rm -rf /var/tmp/* /tmp/* 2>/dev/null || true

echo '=== k3s usage ==='
sudo -n du -xh --max-depth=1 /var/lib/rancher/k3s 2>/dev/null | sort -h | tail -n 20 || true

echo '=== after ==='
df -h /
EOF
