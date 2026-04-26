#!/usr/bin/env bash
# Canonical "show me the live demo logs" helper.
#
# Each Tier 2 component has its own namespace/label/context. When something
# breaks mid-demo, you almost always want a known-good `kubectl logs`
# command for the right object — not to remember six different invocations.
# This script prints the recent tail of every Tier 2 component in one
# shot, scoped to the right cluster context.
#
# Usage:
#   ./scripts/check-tier2-logs.sh                  # all components, both clusters
#   ./scripts/check-tier2-logs.sh operator         # only the operator controller
#   ./scripts/check-tier2-logs.sh session          # only OpenClaw session pods
#   ./scripts/check-tier2-logs.sh gateway          # only OpenClaw gateway
#   ./scripts/check-tier2-logs.sh litellm          # System A LiteLLM
#   ./scripts/check-tier2-logs.sh vllm             # System B vLLM
#   ./scripts/check-tier2-logs.sh offload          # System B offload-worker
#   ./scripts/check-tier2-logs.sh minio            # System B MinIO
#
# Knobs:
#   TAIL                (default: 100)
#   SYSTEM_A_KUBECTL    (default: "kubectl --context system-a")
#   SYSTEM_B_KUBECTL    (default: "kubectl --context system-b")
#   INSTANCE_NAME       (default: intel-demo-operator)
#
# Expected "demo is healthy" signals each block prints:
#
#   operator   :  "reconcile loop ... successful" with no Error events;
#                 OpenClawInstance .status.phase=Running.
#   session    :  per-update lines like "telegram update_id=... user_id=...",
#                 followed by tool-call traces ("tools.exec invoked: ...")
#                 and Bedrock/LiteLLM call lines.
#   gateway    :  GET /healthz returning 200 every readiness tick.
#   litellm    :  POST /v1/chat/completions 200 for the alias the demo used.
#   vllm       :  GET /v1/models 200; generation lines per request.
#   offload    :  POST /run 200, MinIO `put_object` lines, result_ref
#                 returned to the control-plane.
#   minio      :  bucket access logs (no 4xx for `demo-artifacts`).
#
# This script is read-only. It never decodes Secrets, never port-forwards,
# never restarts pods. Safe to run during an active demo.
set -uo pipefail

WHICH="${1:-all}"
TAIL="${TAIL:-100}"
INSTANCE_NAME="${INSTANCE_NAME:-intel-demo-operator}"
SYSTEM_A_KUBECTL="${SYSTEM_A_KUBECTL:-kubectl --context system-a}"
SYSTEM_B_KUBECTL="${SYSTEM_B_KUBECTL:-kubectl --context system-b}"

read -r -a SYSTEM_A <<<"$SYSTEM_A_KUBECTL"
read -r -a SYSTEM_B <<<"$SYSTEM_B_KUBECTL"

section() {
  echo
  echo "===================================================================="
  echo "[$1] $2"
  echo "===================================================================="
}

run() {
  echo "+ $*"
  "$@" 2>&1 || echo "  (above command failed; component may not be deployed yet)"
}

show_operator() {
  section operator "openclaw-operator controller (System A, ns=openclaw-operator-system)"
  run "${SYSTEM_A[@]}" -n openclaw-operator-system logs \
    deploy/openclaw-operator-controller-manager --tail="$TAIL"
  echo
  echo "[operator] OpenClawInstance status:"
  run "${SYSTEM_A[@]}" describe openclawinstance "$INSTANCE_NAME"
}

show_session() {
  section session "OpenClaw session pods (System A, label openclaw.rocks/instance=$INSTANCE_NAME)"
  run "${SYSTEM_A[@]}" get pods -A -l "openclaw.rocks/instance=$INSTANCE_NAME"
  echo
  run "${SYSTEM_A[@]}" logs -A -l "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=session" \
    --tail="$TAIL" --max-log-requests=10 --prefix
}

show_gateway() {
  section gateway "OpenClaw gateway service (System A, label openclaw.rocks/component=gateway)"
  run "${SYSTEM_A[@]}" get svc -A -l "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=gateway"
  echo
  run "${SYSTEM_A[@]}" logs -A -l "openclaw.rocks/instance=$INSTANCE_NAME,openclaw.rocks/component=gateway" \
    --tail="$TAIL" --max-log-requests=4 --prefix
}

show_litellm() {
  section litellm "LiteLLM (System A, ns=inference)"
  run "${SYSTEM_A[@]}" -n inference logs deploy/litellm --tail="$TAIL"
}

show_vllm() {
  section vllm "vLLM (System B, ns=system-b)"
  run "${SYSTEM_B[@]}" -n system-b logs deploy/vllm --tail="$TAIL"
}

show_offload() {
  section offload "offload-worker (System B, ns=system-b)"
  run "${SYSTEM_B[@]}" -n system-b logs deploy/offload-worker --tail="$TAIL"
}

show_minio() {
  section minio "MinIO (System B, ns=system-b)"
  run "${SYSTEM_B[@]}" -n system-b logs deploy/minio --tail="$TAIL"
}

case "$WHICH" in
  all)
    show_operator
    show_session
    show_gateway
    show_litellm
    show_vllm
    show_offload
    show_minio
    ;;
  operator) show_operator ;;
  session)  show_session  ;;
  gateway)  show_gateway  ;;
  litellm)  show_litellm  ;;
  vllm)     show_vllm     ;;
  offload)  show_offload  ;;
  minio)    show_minio    ;;
  *)
    echo "unknown component: $WHICH" >&2
    echo "use one of: all operator session gateway litellm vllm offload minio" >&2
    exit 64
    ;;
esac
