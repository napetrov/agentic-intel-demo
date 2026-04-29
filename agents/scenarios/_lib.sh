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

# narrate_header <scenario-name> <opening-line> <route>
#
# Replaces the 3-4 boilerplate `narrate` lines every scenario opened
# with. The literal `[scenario] <name>` line stays so the offload-worker
# tests (test_shell_runs_known_scenario / test_shell_quiet_flag_*) keep
# their existing assertions. The opening + route + owner collapse to one
# trailing line so the audience reads less narration before the first
# real command runs. The visible "where are we" job moves to the web
# portal's architecture narration strip (see web-demo/app.js).
narrate_header() {
  local scenario="$1"
  local opening="$2"
  local route="$3"
  narrate "[scenario] $scenario"
  narrate "$opening · route=$route"
}

# narrate_footer <verdict>
#
# One-line "we're done" marker. Additive — does NOT replace the
# structured JSON heredoc each run.sh emits at the end (asserted by
# offload-worker tests via `"scenario":"<name>"`). Keep callers emitting
# the JSON line themselves; this just adds a human-readable summary
# above it.
narrate_footer() {
  local verdict="$1"
  narrate_blank
  narrate "[done] $verdict"
}
