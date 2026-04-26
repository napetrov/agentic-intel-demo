#!/usr/bin/env bash
# Pre-cluster validation of the upstream pins the demo depends on.
#
# Closes the "operator/vLLM pins are candidates" gap (operator-gap-analysis
# #1, #4, #7) without needing a Kubernetes cluster. For each pin we can
# reach the public registry and assert:
#
#   * GitHub release tag for OPENCLAW_OPERATOR_REF exists
#   * GHCR manifest for ghcr.io/openclaw-rocks/openclaw:<tag> exists
#   * GHCR manifest for the offload-worker image exists
#   * (best-effort) Docker Hub manifest for the vLLM image exists
#
# Authentication: GHCR requires a per-repo bearer token from the public
# token endpoint (no GitHub login needed for public images). Docker Hub
# uses auth.docker.io the same way. We never write credentials to disk
# and never echo the token.
#
# Usage:
#   ./scripts/check-upstream-pins.sh
#
# Knobs:
#   OPENCLAW_OPERATOR_REPO       (default: openclaw-rocks/openclaw-operator)
#   OPENCLAW_OPERATOR_REF        (default: read from config/versions.yaml)
#   OPENCLAW_RUNTIME_IMAGE       (default: ghcr.io/openclaw-rocks/openclaw)
#   OPENCLAW_RUNTIME_TAG         (default: same as operator ref)
#   OFFLOAD_WORKER_IMAGE         (default: ghcr.io/napetrov/agentic-intel-demo/offload-worker)
#   OFFLOAD_WORKER_TAG           (default: main)
#   VLLM_IMAGE                   (default: vllm/vllm-openai)
#   VLLM_TAG                     (default: read from k8s/system-b/vllm.yaml)
#
# Exit codes:
#   0  every pin resolves
#   1  at least one pin does not resolve
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Pull defaults from versions.yaml / vllm.yaml so we don't drift from
# the actual repo pins. Both files are documentation-only at the
# moment; this script ties them to a runtime check.
default_operator_ref() {
  awk '/^operator:/{found=1} found && /^[[:space:]]*ref:/{gsub(/"|'\''/, "", $2); print $2; exit}' \
    "$REPO_ROOT/config/versions.yaml" 2>/dev/null
}
default_vllm_tag() {
  awk '/image:[[:space:]]*vllm\/vllm-openai/{split($2, a, ":"); print a[2]; exit}' \
    "$REPO_ROOT/k8s/system-b/vllm.yaml" 2>/dev/null
}

OPENCLAW_OPERATOR_REPO="${OPENCLAW_OPERATOR_REPO:-openclaw-rocks/openclaw-operator}"
OPENCLAW_OPERATOR_REF="${OPENCLAW_OPERATOR_REF:-$(default_operator_ref)}"
OPENCLAW_OPERATOR_REF="${OPENCLAW_OPERATOR_REF:-v0.30.0}"
OPENCLAW_RUNTIME_IMAGE="${OPENCLAW_RUNTIME_IMAGE:-ghcr.io/openclaw-rocks/openclaw}"
OPENCLAW_RUNTIME_TAG="${OPENCLAW_RUNTIME_TAG:-$OPENCLAW_OPERATOR_REF}"
OFFLOAD_WORKER_IMAGE="${OFFLOAD_WORKER_IMAGE:-ghcr.io/napetrov/agentic-intel-demo/offload-worker}"
OFFLOAD_WORKER_TAG="${OFFLOAD_WORKER_TAG:-main}"
VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai}"
VLLM_TAG="${VLLM_TAG:-$(default_vllm_tag)}"
VLLM_TAG="${VLLM_TAG:-latest}"

command -v curl >/dev/null 2>&1 \
  || { echo "[check-upstream-pins] curl not on PATH" >&2; exit 127; }
command -v python3 >/dev/null 2>&1 \
  || { echo "[check-upstream-pins] python3 not on PATH (used to parse JSON)" >&2; exit 127; }

FAIL=0
ok()   { printf '  [ok]    %s\n' "$1"; }
warn() { printf '  [warn]  %s\n' "$1"; }
fail() { printf '  [FAIL]  %s\n' "$1"; FAIL=$((FAIL+1)); }

echo "[check-upstream-pins] resolving the pins this demo depends on"
echo "  operator repo:        $OPENCLAW_OPERATOR_REPO"
echo "  operator ref:         $OPENCLAW_OPERATOR_REF"
echo "  runtime image:        $OPENCLAW_RUNTIME_IMAGE:$OPENCLAW_RUNTIME_TAG"
echo "  offload-worker image: $OFFLOAD_WORKER_IMAGE:$OFFLOAD_WORKER_TAG"
echo "  vllm image:           $VLLM_IMAGE:$VLLM_TAG"

# --- 1. GitHub release tag --------------------------------------------------
# Drop `-f` so curl returns the HTTP status even on 4xx; that lets us
# distinguish 404 (tag really gone) from 403 (rate-limit) from 000
# (network/DNS). The previous `-fsS … || echo 000` glued curl's
# %{http_code} output to the fallback string when -f exited non-zero,
# producing values like "403000" that fell through to the unexpected
# branch.
http_status() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || echo 000
}

echo
echo "[1/4] GitHub release: $OPENCLAW_OPERATOR_REPO @ $OPENCLAW_OPERATOR_REF"
gh_url="https://api.github.com/repos/$OPENCLAW_OPERATOR_REPO/git/ref/tags/$OPENCLAW_OPERATOR_REF"
gh_headers=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  gh_headers=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi
gh_status="$(http_status "${gh_headers[@]}" "$gh_url")"
case "$gh_status" in
  200) ok "tag/$OPENCLAW_OPERATOR_REF resolves on GitHub" ;;
  404) fail "tag/$OPENCLAW_OPERATOR_REF does NOT exist on github.com/$OPENCLAW_OPERATOR_REPO — check OPENCLAW_OPERATOR_REF" ;;
  401|403) warn "GitHub returned HTTP $gh_status — likely rate-limited or the sandbox blocks api.github.com. Set GITHUB_TOKEN and re-run for an authoritative answer." ;;
  000) warn "could not reach api.github.com (network/DNS or sandbox firewall) — re-run from a host with public internet" ;;
  *)   fail "unexpected HTTP $gh_status from $gh_url" ;;
esac

# --- 2. Container manifest probe -------------------------------------------
# Probe a registry manifest using the anonymous bearer-token flow. This
# works for public images on ghcr.io, docker.io and quay.io. The token
# response varies in shape (`token` on docker.io, `token` on ghcr.io)
# so we accept both.
probe_manifest() {
  local label="$1" image="$2" tag="$3"
  local registry repo token_url manifest_url status

  case "$image" in
    ghcr.io/*)
      registry="ghcr.io"
      repo="${image#ghcr.io/}"
      token_url="https://ghcr.io/token?scope=repository:$repo:pull"
      ;;
    quay.io/*)
      registry="quay.io"
      repo="${image#quay.io/}"
      token_url="https://quay.io/v2/auth?service=quay.io&scope=repository:$repo:pull"
      ;;
    */*)
      registry="docker.io"
      repo="$image"
      [[ "$repo" == */* ]] || repo="library/$repo"
      token_url="https://auth.docker.io/token?service=registry.docker.io&scope=repository:$repo:pull"
      ;;
    *)
      fail "$label: don't know how to authenticate registry for image=$image"
      return
      ;;
  esac

  local token_body token_status
  # Drop -f so we keep the response body for the DENIED/UNAUTHORIZED
  # case — that's how registries report "image is private" vs
  # "registry is unreachable". Both look like "no token" otherwise.
  token_body="$(curl -sS --max-time 10 "$token_url" 2>/dev/null || true)"
  token_status="$(http_status "$token_url")"
  local token
  token="$(printf '%s' "$token_body" | python3 -c '
import json, sys
try:
    obj = json.loads(sys.stdin.read() or "{}")
except Exception:
    sys.exit(0)
print(obj.get("token") or obj.get("access_token") or "")
' 2>/dev/null || true)"

  if [ -z "$token" ]; then
    case "$token_status" in
      401|403)
        fail "$label: $image:$tag — registry refused anonymous access (HTTP $token_status). The image is private; deploy needs imagePullSecrets (operator-gap-analysis #4)."
        ;;
      000)
        warn "$label: could not reach registry $registry (network/sandbox)"
        ;;
      *)
        fail "$label: token endpoint $token_url returned HTTP $token_status without a token"
        ;;
    esac
    return
  fi

  manifest_url="https://$registry/v2/$repo/manifests/$tag"
  # `-L` follows registry redirects (Docker Hub returns 302 to the
  # actual blob host). Drop `-f` so we keep the final status code
  # rather than glueing it to a "000" fallback.
  status="$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 10 \
              -H "Authorization: Bearer $token" \
              -H 'Accept: application/vnd.oci.image.index.v1+json' \
              -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
              -H 'Accept: application/vnd.docker.distribution.manifest.list.v2+json' \
              -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
              "$manifest_url" 2>/dev/null || echo 000)"
  case "$status" in
    200) ok "$label: $image:$tag manifest resolves" ;;
    401) fail "$label: $image:$tag returned 401 — image may be private (set OPENCLAW_RUNTIME_IMAGE/etc to a reachable mirror)" ;;
    404) fail "$label: $image:$tag does NOT exist in $registry — check the tag" ;;
    000) warn "$label: could not reach $registry (network/DNS or sandbox firewall)" ;;
    *)   fail "$label: unexpected HTTP $status for $image:$tag" ;;
  esac
}

echo
echo "[2/4] Operator runtime image manifest"
probe_manifest "openclaw runtime" "$OPENCLAW_RUNTIME_IMAGE" "$OPENCLAW_RUNTIME_TAG"

echo
echo "[3/4] offload-worker image manifest"
probe_manifest "offload-worker" "$OFFLOAD_WORKER_IMAGE" "$OFFLOAD_WORKER_TAG"

echo
echo "[4/4] vLLM image manifest"
if [ "$VLLM_TAG" = "latest" ]; then
  warn "vllm image tag is 'latest' — k8s/system-b/vllm.yaml is unpinned (gap #7)."
fi
probe_manifest "vllm" "$VLLM_IMAGE" "$VLLM_TAG"

echo
if [ "$FAIL" -gt 0 ]; then
  echo "[check-upstream-pins] $FAIL pin(s) did not resolve. Fix overrides and re-run."
  exit 1
fi
echo "[check-upstream-pins] every pin resolves to a public manifest."
echo "                      (resolution ≠ end-to-end correctness — re-run smoke-test-operator-instance.sh after deploy.)"
