# shellcheck shell=bash
# Shared helpers for scenario run.sh scripts. Sourced by each scenario; not
# executed directly. Keeps the narration on/off switch in one place so the
# scripts stay readable and stay in sync.
#
# Narration ([scenario], [step X/Y]) is on by default for the polished demo
# walkthrough. Set DEMO_QUIET=1 (forwarded by the offload-worker when the
# caller passes payload.quiet=true) to suppress narration so the recipient
# sees only real command output and the structured result fragment.

narrate() {
  if [ "${DEMO_QUIET:-0}" != "1" ]; then
    echo "$@"
  fi
}

narrate_blank() {
  if [ "${DEMO_QUIET:-0}" != "1" ]; then
    echo
  fi
}
