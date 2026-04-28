#!/usr/bin/env bash
# Create every Secret the demo expects, from environment variables.
#
# This script is the canonical materialization path for the secrets the
# operator-first demo depends on. It writes (idempotent kubectl apply):
#
#   System A (SCOPE=system-a or all):
#     1. intel-demo-operator-secrets   (default ns)   — referenced by
#        OpenClawInstance.spec.envFromSecrets in
#        examples/openclawinstance-intel-demo.yaml.
#     2. litellm-secrets               (inference ns) — referenced by
#        k8s/system-a/litellm.yaml via secretKeyRef.
#     3. session-pod-artifact-creds    (agents ns)    — referenced by the
#        session-pod-template ConfigMap (MinIO/S3 creds for the agent pod).
#     4. telegram-bot                  (agents ns)    — referenced by the
#        session-pod-template ConfigMap (TELEGRAM_BOT_TOKEN).
#     5. bedrock-creds                 (agents ns)    — Bedrock bearer
#        token for the session pod (secretKeyRef can't cross namespaces,
#        so this is a copy of the value in intel-demo-operator-secrets).
#
#   System B (SCOPE=system-b or all):
#     6. minio-creds                   (system-b ns)  — referenced by
#        k8s/system-b/minio.yaml and offload-worker.yaml via envFrom/secretKeyRef.
#
# Required env vars depend on SCOPE:
#   SCOPE=system-a (or all): TELEGRAM_BOT_TOKEN, AWS_BEARER_TOKEN_BEDROCK,
#                            SAMBANOVA_API_KEY, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
#   SCOPE=system-b:          MINIO_ACCESS_KEY, MINIO_SECRET_KEY
#
# Optional env vars (system-a only):
#   GH_TOKEN — GitHub PAT plumbed into intel-demo-operator-secrets and the
#              session-pod `github-token` Secret in namespace `agents`. The
#              OpenClaw instance loads it via envFromSecrets and exposes it
#              as GH_TOKEN/GITHUB_TOKEN inside the session pod so agents
#              can drive `git`, `gh`, and private GHCR pulls. Unset to skip
#              wiring (the session pod will not get a token; `gh auth
#              status` will fail loudly, which is the intended signal).
#
# Usage:
#   APPLY=1 \
#   TELEGRAM_BOT_TOKEN=... \
#   AWS_BEARER_TOKEN_BEDROCK=... \
#   SAMBANOVA_API_KEY=... \
#   MINIO_ACCESS_KEY=... \
#   MINIO_SECRET_KEY=... \
#   GH_TOKEN=ghp_...          # optional, see above \
#     ./scripts/create-operator-secrets.sh
#
#   ./scripts/create-operator-secrets.sh         # dry-run, prints rendered manifests
#
# Two-cluster note: by default every Secret is created in the current
# kube context. For two-cluster deploys, run twice with KUBECTL=
# "kubectl --context system-a" / "kubectl --context system-b" — set
# SCOPE=system-a to skip the system-b-namespaced Secrets, SCOPE=system-b
# to only create the system-b ones, or SCOPE=all (default) for single-
# cluster bring-up.
set -euo pipefail

SECRET_NAME="${SECRET_NAME:-intel-demo-operator-secrets}"
SECRET_NAMESPACE="${SECRET_NAMESPACE:-default}"
LITELLM_SECRET_NAME="${LITELLM_SECRET_NAME:-litellm-secrets}"
LITELLM_SECRET_NAMESPACE="${LITELLM_SECRET_NAMESPACE:-inference}"
SESSION_POD_SECRET_NAME="${SESSION_POD_SECRET_NAME:-session-pod-artifact-creds}"
SESSION_POD_SECRET_NAMESPACE="${SESSION_POD_SECRET_NAMESPACE:-agents}"
TELEGRAM_SECRET_NAME="${TELEGRAM_SECRET_NAME:-telegram-bot}"
TELEGRAM_SECRET_NAMESPACE="${TELEGRAM_SECRET_NAMESPACE:-agents}"
BEDROCK_SECRET_NAME="${BEDROCK_SECRET_NAME:-bedrock-creds}"
BEDROCK_SECRET_NAMESPACE="${BEDROCK_SECRET_NAMESPACE:-agents}"
GITHUB_SECRET_NAME="${GITHUB_SECRET_NAME:-github-token}"
GITHUB_SECRET_NAMESPACE="${GITHUB_SECRET_NAMESPACE:-agents}"
MINIO_SECRET_NAME="${MINIO_SECRET_NAME:-minio-creds}"
MINIO_SECRET_NAMESPACE="${MINIO_SECRET_NAMESPACE:-system-b}"
SCOPE="${SCOPE:-all}"
APPLY="${APPLY:-0}"
# KUBECTL can be set to "kubectl --context system-a" for two-cluster deploys.
KUBECTL="${KUBECTL:-kubectl}"

case "$SCOPE" in
  all|system-a|system-b) ;;
  *) echo "[create-operator-secrets] unknown SCOPE=$SCOPE (use all|system-a|system-b)" >&2; exit 64 ;;
esac

# Required env vars depend on SCOPE — System B only needs the MinIO pair.
REQUIRED_KEYS=()
case "$SCOPE" in
  all|system-a)
    REQUIRED_KEYS+=(
      TELEGRAM_BOT_TOKEN
      AWS_BEARER_TOKEN_BEDROCK
      SAMBANOVA_API_KEY
      MINIO_ACCESS_KEY
      MINIO_SECRET_KEY
    )
    ;;
  system-b)
    REQUIRED_KEYS+=(MINIO_ACCESS_KEY MINIO_SECRET_KEY)
    ;;
esac

missing=()
for key in "${REQUIRED_KEYS[@]}"; do
  if [ -z "${!key:-}" ]; then
    missing+=("$key")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "[create-operator-secrets] SCOPE=$SCOPE missing required env vars:" >&2
  for key in "${missing[@]}"; do
    echo "  - $key" >&2
  done
  echo "" >&2
  echo "Set them in your shell, or export from a secrets manager, then re-run:" >&2
  echo "  APPLY=1 SCOPE=$SCOPE ./scripts/create-operator-secrets.sh" >&2
  exit 64
fi

# kubectl is required even in dry-run because the rendering uses
# `kubectl create secret --dry-run=client -o yaml`. Word-split KUBECTL
# in case the caller passed "kubectl --context X".
read -r -a KUBECTL_CMD <<<"$KUBECTL"
command -v "${KUBECTL_CMD[0]}" >/dev/null 2>&1 \
  || { echo "[create-operator-secrets] ${KUBECTL_CMD[0]} not found" >&2; exit 127; }

# Pre-create the destination namespaces. On a clean cluster the manifests
# that own these namespaces (litellm.yaml, session-pod-template.yaml,
# minio.yaml) may not be applied yet; without this preflight the very
# first `kubectl apply -f -` would fail with `namespaces "..." not found`
# and the script would stop before any secrets land.
ensure_namespace() {
  local ns="$1"
  if [ "$APPLY" = "1" ]; then
    "${KUBECTL_CMD[@]}" create namespace "$ns" \
      --dry-run=client -o yaml \
      | "${KUBECTL_CMD[@]}" apply -f - >/dev/null
    echo "[create-operator-secrets] ensured namespace $ns"
  else
    echo "# would ensure namespace $ns"
  fi
}

# render <name> <namespace> <key=value>...
#
# Values are passed to kubectl via --from-env-file (process substitution),
# not --from-literal, so secret material never appears in process argv —
# it would otherwise leak into `ps`, shell history, and CI logs.
# Process substitution gives kubectl a per-fd path (/dev/fd/N) whose
# contents are only readable by this shell + kubectl.
render() {
  local name="$1" namespace="$2"; shift 2
  "${KUBECTL_CMD[@]}" create secret generic "$name" \
    --namespace="$namespace" \
    --from-env-file=<(printf '%s\n' "$@") \
    --dry-run=client \
    -o yaml
}

emit() {
  local label="$1" name="$2" namespace="$3"; shift 3
  if [ "$APPLY" = "1" ]; then
    render "$name" "$namespace" "$@" | "${KUBECTL_CMD[@]}" apply -f -
    echo "[create-operator-secrets] applied $label ($name in $namespace)"
  else
    echo "---"
    echo "# [$label] $name in $namespace"
    render "$name" "$namespace" "$@"
  fi
}

[ "$APPLY" = "1" ] || echo "[create-operator-secrets] dry-run (set APPLY=1 to actually apply):"

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-a" ]; then
  ensure_namespace "$SECRET_NAMESPACE"
  ensure_namespace "$LITELLM_SECRET_NAMESPACE"
  ensure_namespace "$SESSION_POD_SECRET_NAMESPACE"
  # The github-token mirror lives in $GITHUB_SECRET_NAMESPACE (default
  # `agents`, same as the session pod). If a caller overrides it to a
  # different ns, the apply/delete below would otherwise fail with
  # `namespaces "..." not found` on a fresh cluster.
  if [ "$GITHUB_SECRET_NAMESPACE" != "$SESSION_POD_SECRET_NAMESPACE" ]; then
    ensure_namespace "$GITHUB_SECRET_NAMESPACE"
  fi

  # GH_TOKEN is optional. When set (the wire path), it lands in BOTH the
  # operator instance Secret in $SECRET_NAMESPACE (so envFromSecrets
  # exposes it inside the gateway pod) AND the `github-token` Secret in
  # $GITHUB_SECRET_NAMESPACE / `agents` (so secretKeyRef can mount it as
  # GH_TOKEN/GITHUB_TOKEN inside the session pod).
  #
  # When unset (the revoke path), GH_TOKEN is omitted from the operator
  # instance Secret payload AND, in apply mode, the agents/github-token
  # mirror is actively deleted — re-running the script with GH_TOKEN
  # un-exported is the canonical "revoke agent GitHub access" gesture.
  # In dry-run mode the unset path prints a "would delete" notice so
  # operators can preview the effect without touching the cluster.
  operator_instance_keys=(
    "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
    "AWS_BEARER_TOKEN_BEDROCK=$AWS_BEARER_TOKEN_BEDROCK"
    "SAMBANOVA_API_KEY=$SAMBANOVA_API_KEY"
    "MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY"
    "MINIO_SECRET_KEY=$MINIO_SECRET_KEY"
  )
  if [ -n "${GH_TOKEN:-}" ]; then
    operator_instance_keys+=("GH_TOKEN=$GH_TOKEN")
  fi

  emit "operator instance secrets" \
    "$SECRET_NAME" "$SECRET_NAMESPACE" \
    "${operator_instance_keys[@]}"

  emit "litellm secrets" \
    "$LITELLM_SECRET_NAME" "$LITELLM_SECRET_NAMESPACE" \
    "AWS_BEARER_TOKEN_BEDROCK=$AWS_BEARER_TOKEN_BEDROCK" \
    "SAMBANOVA_API_KEY=$SAMBANOVA_API_KEY"

  emit "session-pod artifact creds" \
    "$SESSION_POD_SECRET_NAME" "$SESSION_POD_SECRET_NAMESPACE" \
    "AWS_ACCESS_KEY_ID=$MINIO_ACCESS_KEY" \
    "AWS_SECRET_ACCESS_KEY=$MINIO_SECRET_KEY"

  emit "telegram bot token" \
    "$TELEGRAM_SECRET_NAME" "$TELEGRAM_SECRET_NAMESPACE" \
    "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"

  emit "bedrock bearer token (session pod)" \
    "$BEDROCK_SECRET_NAME" "$BEDROCK_SECRET_NAMESPACE" \
    "AWS_BEARER_TOKEN_BEDROCK=$AWS_BEARER_TOKEN_BEDROCK"

  # Mirror GH_TOKEN into the agents namespace for the session pod. The
  # operator instance Secret lives in the operator's namespace and
  # secretKeyRef can't cross namespaces, so this copy is what
  # session-pod-template.yaml's `secretKeyRef` actually points at.
  #
  # Critically, if GH_TOKEN is now unset but the Secret already exists
  # from a prior run, we must DELETE it. Otherwise restarted session
  # pods would silently keep injecting the stale PAT via secretKeyRef,
  # even though the log line below says "agents will run without
  # GitHub credentials". This is the revoke-by-omission contract:
  # un-exporting GH_TOKEN and re-running the script is the canonical
  # way to remove agent GitHub access.
  if [ -n "${GH_TOKEN:-}" ]; then
    emit "github token (session pod)" \
      "$GITHUB_SECRET_NAME" "$GITHUB_SECRET_NAMESPACE" \
      "GH_TOKEN=$GH_TOKEN"
  else
    if [ "$APPLY" = "1" ]; then
      if "${KUBECTL_CMD[@]}" -n "$GITHUB_SECRET_NAMESPACE" \
            get secret "$GITHUB_SECRET_NAME" >/dev/null 2>&1; then
        "${KUBECTL_CMD[@]}" -n "$GITHUB_SECRET_NAMESPACE" \
          delete secret "$GITHUB_SECRET_NAME" >/dev/null
        echo "[create-operator-secrets] GH_TOKEN unset — removed stale secret/$GITHUB_SECRET_NAME in ns/$GITHUB_SECRET_NAMESPACE."
        echo "  Restart session pods (kubectl delete pods -n $GITHUB_SECRET_NAMESPACE -l role=session-pod) to drop the cached credential."
      else
        echo "[create-operator-secrets] GH_TOKEN unset — secret/$GITHUB_SECRET_NAME not present in ns/$GITHUB_SECRET_NAMESPACE; nothing to remove."
      fi
    else
      echo "# GH_TOKEN unset — would delete secret/$GITHUB_SECRET_NAME in ns/$GITHUB_SECRET_NAMESPACE if present (revoke-by-omission)."
    fi
    echo "[create-operator-secrets] Re-run with GH_TOKEN=ghp_... to (re-)wire GitHub credentials for git/gh/private GHCR pulls."
  fi
fi

if [ "$SCOPE" = "all" ] || [ "$SCOPE" = "system-b" ]; then
  ensure_namespace "$MINIO_SECRET_NAMESPACE"

  emit "minio root creds" \
    "$MINIO_SECRET_NAME" "$MINIO_SECRET_NAMESPACE" \
    "MINIO_ROOT_USER=$MINIO_ACCESS_KEY" \
    "MINIO_ROOT_PASSWORD=$MINIO_SECRET_KEY"
fi
