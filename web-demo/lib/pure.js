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
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function formatAge(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m${s.toString().padStart(2, '0')}s`;
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
    formatAge,
    buildScenarioToolActivity
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.demoLib = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
