#!/usr/bin/env bash
set -euo pipefail

SYSTEM_B_IP="${SYSTEM_B_IP:-}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
BUCKET="${BUCKET:-demo-artifacts}"

if [ -z "$SYSTEM_B_IP" ] || [ -z "$MINIO_ROOT_USER" ] || [ -z "$MINIO_ROOT_PASSWORD" ]; then
  echo "[create-minio-bucket] SYSTEM_B_IP, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD are required" >&2
  exit 1
fi

docker run --rm minio/mc sh -c "mc alias set demo http://$SYSTEM_B_IP:30900 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc mb --ignore-existing demo/$BUCKET"

echo "[create-minio-bucket] ensured bucket: $BUCKET"
