// Pure helpers extracted from app.js so they can be unit-tested under
// Node (Vitest) without a DOM. UMD-style: exposes `window.demoLib` for
// the static page, and `module.exports` for Node tests. Keep these
// strictly pure — no DOM, no globals, no fetch.

(function attach(root) {
  // Pod-profile → vCPU. Mirrors PROFILES.cpu_request in
  // runtimes/control-plane/session_manager.py — kept in sync by hand
  // because the static demo bundle has no build step that could read
  // the yaml.
  function profileToVcpu(profile) {
    if (profile === 'small') return 1;
    if (profile === 'medium') return 4;
    if (profile === 'large') return 16;
    return 0;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncateValue(value, max) {
    const str = String(value);
    // Guard against max <= 0: slice(0, -1) returns all-but-last, which
    // would silently emit a partial string instead of "" or the input.
    if (max <= 0) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function formatAge(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m${s.toString().padStart(2, '0')}s`;
  }

  // The Result panel is meant to be a compact "verdict, exit, elapsed"
  // summary. Live runs include raw stdout/stderr, which can be hundreds
  // of lines — and the same text is already in the Live command log.
  // Keep only the tail (where final summary lines typically live) and
  // mark the trim so users know to look at the full log.
  function truncateOutput(output, maxLines) {
    const limit = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 12;
    const text = String(output == null ? '' : output);
    if (!text) return '';
    const lines = text.split('\n');
    if (lines.length <= limit) return text;
    const kept = lines.slice(-limit);
    const dropped = lines.length - kept.length;
    return [`… (${dropped} earlier lines hidden — see Live command log)`, ...kept].join('\n');
  }

  function buildScenarioToolActivity(scenario, defaultStatus) {
    if (!scenario || !Array.isArray(scenario.toolActivity)) return [];
    return scenario.toolActivity.map((row) => ({
      ...row,
      name: row.name || row.tool,
      status: row.status || defaultStatus
    }));
  }

  const api = {
    profileToVcpu,
    escapeHtml,
    truncateValue,
    truncateOutput,
    formatAge,
    buildScenarioToolActivity
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.demoLib = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
