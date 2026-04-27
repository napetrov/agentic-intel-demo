const SYSTEM_A_TOTAL_VCPU = 512;
const SYSTEM_B_TOTAL_VCPU = 100;

// Shown by the Agent command panel when the local stack isn't reachable.
// Both call sites (form-submit guard + runAgentCommand defensive guard) use
// the same copy so the wording can't drift as docs evolve.
const BACKEND_REQUIRED_MSG =
  'Control plane not reachable — agent commands are disabled.';

const scenarios = {
  'terminal-agent': {
    orchestrationActive: ['openclaw', 'litellm', 'sambanova'],
    primary: { name: 'Terminal agent', vcpu: 4 },
    subagent: null,
    services: { erag: false, 'ent-inference': false },
    crossSystemArrow: false,
    console: {
      mode: 'terminal-agent demo',
      'openclaw version': '2026.4.15',
      orchestrator: 'OpenClaw',
      'orchestration alt': 'Flowise (optional)',
      'litellm gateway': 'litellm/sambanova primary',
      'litellm endpoint': 'port 4000 /v1',
      'sambanova model': 'DeepSeek-V3.1',
      'enterprise inference': 'available as alternate route',
      'model route': 'LiteLLM → SambaNova',
      'session scope': 'isolated per user',
      'placement': 'System A — 4/512 vCPU',
      'artifact view': 'engineering summary'
    },
    metrics: {
      Elapsed: '18.4s',
      Tokens: '3,420',
      Model: 'SambaNova via LiteLLM',
      Route: 'OpenClaw → System A',
      Tools: 'exec, read',
      Artifacts: '2'
    },
    // What "Run demo" sends through the OpenClaw gateway when the live
    // backend is reachable. The worker forwards this to /tools/invoke; the
    // gateway classifies the input and runs a real tool, so the command log
    // shows actual tool output instead of a scripted narration.
    agentInvoke: { tool: 'command', args: { text: 'uname -srm' } },
    toolActivity: [
      { icon: '💻', tool: 'terminal', value: 'openclaw demo run terminal-agent --isolated' },
      { icon: '🌐', tool: 'api_call', value: 'POST /v1/chat/completions (LiteLLM → SambaNova)' },
      { icon: '📖', tool: 'read_file', value: 'agents/scenarios/terminal-agent/terminal-bench-reference.md' },
      { icon: '💻', tool: 'terminal', value: './scripts/session-bootstrap.sh --scenario terminal-agent' },
      { icon: '🔎', tool: 'search_files', value: 'demo-workspace/BOOTSTRAP.md' },
      { icon: '💻', tool: 'terminal', value: 'git status --short' },
      { icon: '💻', tool: 'terminal', value: './scripts/smoke-test-operator-instance.sh --profile terminal-agent' },
      { icon: '💻', tool: 'terminal', value: './scripts/demo-terminal-workflow.sh --emit-trace' },
      { icon: '📝', tool: 'summarize', value: 'engineering summary → result panel' }
    ],
    commandLog: `$ openclaw demo run terminal-agent --isolated\nrequest accepted\nsession_id=demo-term-0420 sandbox=created profile=engineering\n\n$ sed -n '1,40p' agents/scenarios/terminal-agent/terminal-bench-reference.md\n# Terminal Agent Demo — Reference Task Spec\n### Name\nrepo-structure-audit-and-fixup\n### Objective\nInspect the repo and produce a structured scenario/task inventory.\n\n$ ./scripts/session-bootstrap.sh --scenario terminal-agent\n[bootstrap] workspace mounted at /workspace-intel-dev/agentic-intel-demo\n[bootstrap] tools registered: exec, read, summarize\n[bootstrap] isolated temp dir: /tmp/demo-term-0420\n[check] demo-workspace/BOOTSTRAP.md loaded\n[check] scenario prompt loaded\n\n$ ./scripts/route-task.sh --scenario terminal-agent\n[classifier] workload=interactive engineering\n[inference] provider=litellm/sambanova\n[executor] target=system-a\n[decision] use primary CWF path\n\n$ git status --short\n M web-demo/app.js\n M web-demo/index.html\n M web-demo/styles.css\n\n$ ./scripts/smoke-test-operator-instance.sh --profile terminal-agent\n[step] validating shell access\n[step] validating repo context\n[step] validating writable artifact dir\n[ok] shell access confirmed\n[ok] repo context confirmed\n[ok] artifact dir ready\n\n$ ./scripts/demo-terminal-workflow.sh --emit-trace\n[1/6] inspect workspace layout\n[2/6] read task brief\n[3/6] run command batch\n[4/6] collect stdout/stderr\n[5/6] package artifacts\n[6/6] render operator summary\nworkflow complete`,
    timeline: [
      ['Task received', 'OpenClaw accepts the request; System A reserves a 4 vCPU slot for the agent.'],
      ['Workspace prepared', 'Session pod mounted on System A. Tools registered: exec, read, summarize.'],
      ['Command running', 'Terminal workflow executes directly on System A; no offload needed.'],
      ['Command completed', 'Command batch finishes; artifacts collected in the local session pod.'],
      ['Answer generated', 'Engineering summary delivered; capacity returned to the pool.']
    ],
    result: [
      'artifacts/demo-terminal/scenario-audit.md',
      '─────────────────────────────────────────',
      'Scenario audit — repo-structure-audit-and-fixup',
      '',
      'Guided scenarios found (3)',
      '  • agents/scenarios/terminal-agent',
      '  • agents/scenarios/market-research',
      '  • agents/scenarios/large-build-test',
      '',
      'Reusable task families (2)',
      '  • agents/tasks/shell-workflow',
      '  • agents/tasks/research-synthesis',
      '',
      'Config files referenced (4)',
      '  • config/litellm/config.yaml',
      '  • config/openclaw/instance.yaml',
      '  • config/flowise/flow-terminal-agent.json',
      '  • catalog/scenarios.yaml',
      '',
      'Mismatches detected (2)',
      '  • catalog/scenarios.yaml: market-research → flow.md path drifts',
      '  • docs/repo-layout.md still references legacy/ (removed)',
      '',
      'Validation',
      '  test -f artifacts/demo-terminal/scenario-audit.md         → ok',
      '  grep -q "Final summary" artifacts/.../scenario-audit.md   → ok',
      '',
      'Final summary: PASS — 3/3 scenarios catalogued, 2 follow-ups flagged.'
    ].join('\n')
  },
  'market-research': {
    orchestrationActive: ['openclaw', 'litellm', 'sambanova'],
    primary: { name: 'Market Research agent', vcpu: 4 },
    subagent: { name: 'pandas subagent (spawned by MR)', vcpu: 4, spawnDelayMs: 2400 },
    services: { erag: true, 'ent-inference': false },
    crossSystemArrow: true,
    console: {
      mode: 'market-research demo',
      'openclaw version': '2026.4.15',
      orchestrator: 'OpenClaw',
      'orchestration alt': 'Flowise (optional)',
      'litellm gateway': 'litellm/sambanova primary',
      'litellm endpoint': 'port 4000 /v1',
      'sambanova model': 'DeepSeek-V3.1',
      'enterprise inference': 'idle for this scenario',
      'model route': 'LiteLLM → SambaNova',
      'session scope': 'isolated per user',
      'placement': 'System A 4/512 + System B 4/100 (subagent)',
      'artifact view': 'research brief'
    },
    metrics: {
      Elapsed: '12.1s',
      Tokens: '2,180',
      Model: 'SambaNova via LiteLLM',
      Route: 'A → B (subagent)',
      Tools: 'read, summarize',
      Artifacts: '1'
    },
    agentInvoke: {
      tool: 'command',
      args: {
        text: 'summarize OpenClaw orchestrates agentic execution on Intel CPUs across CWF and offload paths to keep latency predictable for SMB customers.'
      }
    },
    toolActivity: [
      { icon: '💻', tool: 'terminal', value: 'openclaw demo run market-research --isolated' },
      { icon: '🌐', tool: 'api_call', value: 'POST /v1/chat/completions (LiteLLM → SambaNova)' },
      { icon: '📖', tool: 'read_file', value: 'agents/scenarios/market-research/report-task.md' },
      { icon: '🔎', tool: 'search_files', value: 'demo-inputs/market-research/' },
      { icon: '🌐', tool: 'api_call', value: 'GET /v1/erag/query?topic=market-map' },
      { icon: '🤖', tool: 'spawn_subagent', value: 'pandas analytics → System B (4 vCPU)' },
      { icon: '🐍', tool: 'execute_code', value: "import pandas as pd; df.groupby('segment').agg(...)" },
      { icon: '📝', tool: 'summarize', value: 'research brief → result panel' }
    ],
    commandLog: `$ openclaw demo run market-research --isolated\nrequest accepted\nsession_id=demo-research-0420 sandbox=created profile=research\n\n$ sed -n '1,40p' agents/scenarios/market-research/report-task.md\n# Market Research Demo Task\nObjective: recommend which SMB segment to target first for an AI meeting notes product.\nInputs: synthetic repo data under demo-inputs/market-research/.\n\n$ ./scripts/session-bootstrap.sh --scenario market-research\n[bootstrap] workspace mounted\n[bootstrap] retrieval cache ready (eRAG)\n[bootstrap] summarize tool ready\n[check] research prompt loaded\n\n$ ./scripts/route-task.sh --scenario market-research\n[classifier] workload=research synthesis\n[inference] provider=litellm/sambanova\n[executor] primary=system-a\n[executor] subagent=system-b (pandas analytics)\n[decision] spawn cross-system subagent for offload analytics\n\n$ ./scripts/research-brief.sh --topic market-map --emit-sources\n[1/5] normalize request\n[2/5] gather source snippets via eRAG\n[3/5] dispatch pandas subagent to System B\n[4/5] synthesize summary\n[5/5] assemble brief\nbrief complete`,
    timeline: [
      ['Input accepted', 'OpenClaw accepts the scenario; MR agent takes 4 vCPU on System A.'],
      ['Subagent spawned', 'MR agent dispatches a 4 vCPU pandas subagent to System B; eRAG activates for retrieval.'],
      ['Analytics offload', 'pandas subagent crunches data on System B while MR continues on A.'],
      ['Synthesis', 'SambaNova via LiteLLM summarizes the combined findings.'],
      ['Result ready', 'Research brief delivered; subagent and eRAG wind down.']
    ],
    result: [
      'artifacts/demo-research/market-brief.md',
      '─────────────────────────────────────────',
      'Market research brief — AI meeting notes for SMBs',
      '',
      'Scope',
      '  Recommend the first SMB segment (1–50 staff) for an AI meeting-notes',
      '  product, given a 6-month go-to-market window.',
      '',
      'Evaluation dimensions',
      '  1. willingness-to-pay   2. meetings/week',
      '  3. tool-stack fit       4. compliance overhead',
      '',
      'Findings (pandas subagent on System B, 4 vCPU)',
      '  segment             WTP    meet/wk  stack  compliance',
      '  professional svcs   $$$     22       high     low',
      '  boutique agencies   $$      14       high     low',
      '  local healthcare    $$$     19       med      HIGH',
      '  field services      $        6       low      low',
      '',
      'Conclusion',
      '  Lead with professional services (legal, accounting, consulting):',
      '  highest WTP × meeting volume, low compliance drag.',
      '',
      'Next action',
      '  Pilot with 12 firms via existing CRM partner.',
      '  Revisit healthcare in v2 after HIPAA work.',
      '',
      'Why this route — eRAG retrieved 4 source docs; pandas offload to',
      'System B did the segmentation roll-up; SambaNova synthesized the brief.'
    ].join('\n')
  },
  'large-build-test': {
    orchestrationActive: ['openclaw', 'litellm', 'sambanova', 'ent-inference-route'],
    primary: { name: 'Build/Test', vcpu: 16 },
    subagent: null,
    services: { erag: false, 'ent-inference': true },
    crossSystemArrow: false,
    console: {
      mode: 'large-build-test demo',
      'openclaw version': '2026.4.15',
      orchestrator: 'OpenClaw',
      'orchestration alt': 'Flowise (optional)',
      'litellm gateway': 'litellm/sambanova primary',
      'litellm endpoint': 'port 4000 /v1',
      'sambanova model': 'DeepSeek-V3.1',
      'enterprise inference': 'active — SLM route lit',
      'model route': 'LiteLLM → SambaNova + Ent. Inference (SLM)',
      'session scope': 'isolated per user',
      'placement': 'System A 16/512 (large profile)',
      'artifact view': 'build/test summary'
    },
    metrics: {
      Elapsed: '26.7s',
      Tokens: '4,960',
      Model: 'SambaNova + Ent. Inference SLM',
      Route: 'OpenClaw → System A (large slot)',
      Tools: 'exec, read, summarize',
      Artifacts: '3'
    },
    agentInvoke: { tool: 'command', args: { text: 'list .' } },
    toolActivity: [
      { icon: '💻', tool: 'terminal', value: 'openclaw demo run large-build-test --burst' },
      { icon: '📖', tool: 'read_file', value: 'agents/scenarios/large-build-test/build-task.md' },
      { icon: '💻', tool: 'terminal', value: './scripts/queue-reserve.sh --profile large-build' },
      { icon: '🌐', tool: 'api_call', value: 'POST /v1/chat/completions (LiteLLM → SambaNova)' },
      { icon: '🌐', tool: 'api_call', value: 'POST /v1/chat/completions (LiteLLM → Ent. Inference SLM)' },
      { icon: '💻', tool: 'terminal', value: './scripts/run-large-build-test.sh --emit-artifacts' },
      { icon: '🔨', tool: 'compile', value: 'system-a (16 vCPU slot)' },
      { icon: '🧪', tool: 'test_suite', value: 'pytest -q' },
      { icon: '📝', tool: 'summarize', value: 'build/test summary → result panel' }
    ],
    commandLog: `$ openclaw demo run large-build-test --burst\nrequest accepted\nsession_id=demo-build-0420 profile=burst workload=heavy\n\n$ sed -n '1,40p' agents/scenarios/large-build-test/build-task.md\n# Large Build/Test Demo Task\nObjective: run a larger build/test workflow with explicit large-profile framing and concrete evidence.\n\n$ ./scripts/session-bootstrap.sh --scenario large-build-test\n[bootstrap] heavy profile enabled\n[bootstrap] artifact dir prepared\n[bootstrap] summary writer ready\n\n$ ./scripts/queue-reserve.sh --profile large-build\nqueue slot reserved\nprimary lane=system-a (16 vCPU — large-profile slot)\ninference routes=SambaNova,Ent.Inference SLM\n\n$ ./scripts/route-task.sh --scenario large-build-test\n[classifier] workload=heavy build/test\n[inference] primary=litellm/sambanova\n[inference] alternate=ent. inference SLM\n[executor] placement=system-a (large slot)\n\n$ ./scripts/run-large-build-test.sh --emit-artifacts\n[1/5] load build graph\n[2/5] reserve compile lane\n[3/5] run compile on system-a (16 vCPU slot)\n[4/5] summarize via SambaNova; fall back to SLM where needed\n[5/5] assemble build/test package\nflow complete`,
    timeline: [
      ['Input accepted', 'OpenClaw accepts the heavy workload; System A reserves a 16 vCPU large-profile slot.'],
      ['Orchestration', 'Build/test classified as large profile; Enterprise Inference SLM route lights up.'],
      ['Compile + test', 'Compile runs on System A (16 vCPU slot); LiteLLM splits inference between SambaNova and SLM.'],
      ['Results assembled', 'Artifacts bundled and summary drafted.'],
      ['Result ready', 'Build/test status and route decision delivered; slot releases back to the pool.']
    ],
    result: [
      'artifacts/demo-build/build-test-summary.md',
      '─────────────────────────────────────────',
      'Build/test summary — large profile (16 vCPU on System A)',
      '',
      'Preflight',
      '  toolchain: python 3.11.7, gcc 12.3, cmake 3.27   → ok',
      '  workspace clean: yes      |   cache hit: 64%',
      '',
      'Build',
      '  $ make -j16',
      '  412 targets   →   exit 0   in 1m41s',
      '',
      'Tests',
      '  $ pytest -q',
      '  142 passed, 0 failed, 3 skipped   in 38s',
      '  slowest:',
      '    test_offload_relay.py::test_artifact_roundtrip   4.81s',
      '    test_litellm_route.py::test_sambanova_primary    3.20s',
      '    test_probe.py::test_unconfigured_neutral         2.04s',
      '',
      'Inference route share',
      '  SambaNova (primary):   78% of tokens',
      '  Ent. Inference SLM:    22% (fallback for code-completion)',
      '',
      'Final: PASS — exit 0, 142/142 passing.',
      'Artifacts: build.log, test.xml, summary.md → artifacts/demo-build/'
    ].join('\n')
  }
};

const idleConsole = {
  mode: 'demo portal',
  'openclaw version': '2026.4.15',
  orchestrator: 'OpenClaw',
  'orchestration alt': 'Flowise (optional)',
  'litellm gateway': 'litellm/sambanova primary',
  'litellm endpoint': 'port 4000 /v1',
  'sambanova model': 'DeepSeek-V3.1',
  'enterprise inference': 'available as alternate route',
  'model route': 'LiteLLM → SambaNova / Ent. Inference',
  'session scope': 'isolated per user',
  'placement': 'System A pool idle (0/512)',
  'artifact view': 'summary only'
};

const toolActivityEl = document.getElementById('tool-activity');
const result = document.getElementById('result');
const consoleEl = document.getElementById('console');
const commandLogEl = document.getElementById('command-log');
const metricsEl = document.getElementById('metrics');
const runDemoBtn = document.getElementById('run-demo');
const dataModeEl = document.getElementById('data-mode');
const sysAUsedEl = document.getElementById('sys-a-used');
const sysATotalEl = document.getElementById('sys-a-total');
const sysABarFillEl = document.getElementById('sys-a-bar-fill');
const sysAAgentsEl = document.getElementById('sys-a-agents');
const sysBUsedEl = document.getElementById('sys-b-used');
const sysBTotalEl = document.getElementById('sys-b-total');
const sysBBarFillEl = document.getElementById('sys-b-bar-fill');
const sysBOffloadEl = document.getElementById('sys-b-offload');
const crossArrowEl = document.getElementById('cross-system-arrow');
const orchestrationNodes = document.querySelectorAll('.orchestration-band [data-node]');
const serviceRows = document.querySelectorAll('.service-row[data-service]');
const capacityBarContainer = sysABarFillEl.parentElement;
const capacityBarBContainer = sysBBarFillEl.parentElement;
const healthDots = {
  openclaw: document.querySelector('[data-health="openclaw"]'),
  litellm: document.querySelector('[data-health="litellm"]'),
  sambanova: document.querySelector('[data-health="sambanova"]'),
  systemA: document.querySelector('[data-health="systemA"]'),
  systemB: document.querySelector('[data-health="systemB"]')
};
const API_BASE = '/api';
let liveBackendAvailable = false;

let currentScenario = null;
let currentPhase = 'idle';
// Tracks whether the running scenario has spawned its subagent yet; used
// by redrawSystemB() so a /sessions poll mid-run doesn't toggle the
// scenario subagent off when only the multi-session pool changed.
let currentIncludeSubagent = false;
// Latest snapshot of multi-session records this tab is tracking. Updated
// every time refreshMultiSession() polls /api/sessions; used by
// renderSystemA() / renderSystemB() so each agent pool reflects spawned
// sessions, not just the scenario primary agent.
let lastSessionRecords = [];
let runTimers = [];
let liveRunId = 0;
let liveArchitecturePinned = false;
const originalRunLabel = runDemoBtn.textContent;

// Pure helpers (profileToVcpu/escapeHtml/truncateValue/formatAge/
// buildScenarioToolActivity) live in lib/pure.js so Vitest can import
// them without a DOM. lib/pure.js is loaded by index.html before app.js
// and exposes `window.demoLib`. Local aliases keep call sites readable.
const profileToVcpu = window.demoLib.profileToVcpu;
const escapeHtml = window.demoLib.escapeHtml;
const truncateValue = window.demoLib.truncateValue;
const formatAge = window.demoLib.formatAge;
const buildScenarioToolActivity = window.demoLib.buildScenarioToolActivity;

sysATotalEl.textContent = SYSTEM_A_TOTAL_VCPU;
sysBTotalEl.textContent = SYSTEM_B_TOTAL_VCPU;

function setDataMode(text) {
  if (text) {
    dataModeEl.textContent = text;
    dataModeEl.hidden = false;
  } else {
    dataModeEl.textContent = '';
    dataModeEl.hidden = true;
  }
}

function clearRunTimers() {
  runTimers.forEach((id) => clearTimeout(id));
  runTimers = [];
}

function restoreRunButton() {
  if (runDemoBtn.disabled) {
    runDemoBtn.disabled = false;
    runDemoBtn.textContent = originalRunLabel;
  }
}

function cancelRun() {
  clearRunTimers();
  // Invalidate any in-flight live walkthrough so late /api/offload poll
  // responses can't overwrite the new mode (Stack overview / Reset / new
  // scenario). runLiveWalkthrough checks `myRunId === liveRunId` after each
  // await and bails out early when this counter advances.
  liveRunId += 1;
  liveArchitecturePinned = false;
  restoreRunButton();
}

function setOrchestrationActive(activeIds) {
  const set = new Set(activeIds || []);
  orchestrationNodes.forEach((el) => {
    el.classList.toggle('active', set.has(el.dataset.node));
  });
}

function setServiceState(services) {
  serviceRows.forEach((row) => {
    const key = row.dataset.service;
    const active = Boolean(services && services[key]);
    row.dataset.statusActive = active ? 'true' : 'false';
    const status = row.querySelector('.service-status');
    if (status) {
      status.textContent = active ? 'active' : 'idle';
      status.dataset.status = active ? 'active' : 'idle';
    }
  });
}

function renderCapacity(usedVcpu) {
  const used = Math.max(0, Math.min(SYSTEM_A_TOTAL_VCPU, usedVcpu || 0));
  const pct = (used / SYSTEM_A_TOTAL_VCPU) * 100;
  sysAUsedEl.textContent = used;
  sysABarFillEl.style.width = pct + '%';
  sysABarFillEl.classList.toggle('full', used >= SYSTEM_A_TOTAL_VCPU);
  if (capacityBarContainer) {
    capacityBarContainer.setAttribute('aria-valuenow', String(used));
  }
}

function renderCapacityB(usedVcpu) {
  const used = Math.max(0, Math.min(SYSTEM_B_TOTAL_VCPU, usedVcpu || 0));
  const pct = (used / SYSTEM_B_TOTAL_VCPU) * 100;
  sysBUsedEl.textContent = used;
  sysBBarFillEl.style.width = pct + '%';
  sysBBarFillEl.classList.toggle('full', used >= SYSTEM_B_TOTAL_VCPU);
  if (capacityBarBContainer) {
    capacityBarBContainer.setAttribute('aria-valuenow', String(used));
  }
}

function agentRowHtml(name, vcpu, state) {
  const label = state === 'planned' ? 'planned' : 'running';
  return `
    <div class="agent-row ${state}">
      <span class="agent-name">${escapeHtml(name)}</span>
      <span class="agent-cpu">${vcpu} vCPU</span>
      <span class="agent-status">${label}</span>
    </div>
  `;
}

// Multi-session sessions render alongside the scenario primary agent. Pending
// rows show as "planned" (dashed); Running rows as "running" (green pulse) so
// the operator sees the pool fill and drain as Jobs progress.
function sessionAgentRowHtml(rec) {
  const vcpu = profileToVcpu(rec.profile);
  const isRunning = rec.status === 'Running';
  const state = isRunning ? 'running' : 'planned';
  const label = (rec.status || 'planned').toLowerCase();
  const sidShort = (rec.session_id || '').replace(/^sess-/, '');
  const name = `${rec.scenario || 'session'} · ${sidShort}`;
  return `
    <div class="agent-row ${state}" data-session-id="${escapeHtml(rec.session_id || '')}">
      <span class="agent-name">${escapeHtml(name)}</span>
      <span class="agent-cpu">${vcpu} vCPU</span>
      <span class="agent-status">${escapeHtml(label)}</span>
    </div>
  `;
}

// True if the session was explicitly routed to System B by the operator
// via the multi-agent fan-out target picker. `null` / `undefined`
// `target_system` means "use scenario default" — today that's always
// System A, so those sessions render in the System A pool.
function isSystemBSession(rec) {
  return rec && rec.target_system === 'system_b';
}

function renderSystemA(scenario, phase) {
  const rows = [];
  let usedVcpu = 0;

  if (scenario && phase !== 'idle') {
    const { primary } = scenario;
    const state = phase === 'running' ? 'running' : 'planned';
    rows.push(agentRowHtml(primary.name, primary.vcpu, state));
    if (state === 'running') usedVcpu += primary.vcpu;
  }

  // Spawned multi-session agents (Pending + Running). Terminal rows are
  // dropped so the pool drains as Jobs complete. system_b-targeted
  // sessions belong in the other pool — see renderSystemB.
  for (const rec of lastSessionRecords) {
    if (!rec || TERMINAL_STATUSES.has(rec.status)) continue;
    if (isSystemBSession(rec)) continue;
    rows.push(sessionAgentRowHtml(rec));
    if (rec.status === 'Running') usedVcpu += profileToVcpu(rec.profile);
  }

  if (!rows.length) {
    sysAAgentsEl.innerHTML = '<div class="agent-row-empty">no agents (idle — select a scenario or spawn sessions)</div>';
    renderCapacity(0);
    return;
  }
  sysAAgentsEl.innerHTML = rows.join('');
  renderCapacity(usedVcpu);
}

// Re-render System A using the current scenario + multi-session state.
// Called when /api/sessions polling produces a fresh snapshot.
function redrawSystemA() {
  if (liveArchitecturePinned) return;
  const scenario = currentScenario ? scenarios[currentScenario] : null;
  renderSystemA(scenario, currentPhase);
}

function renderSystemB(scenario, phase, includeSubagent) {
  // System B's pool is populated from two sources:
  //   1. The scenario's offload subagent (only if the scenario routes
  //      to System B and the run has actually spawned it).
  //   2. Multi-session fan-out where the operator picked target_system
  //      = 'system_b' explicitly.
  // Either source alone is enough to show rows; both contribute to the
  // capacity bar.
  const rows = [];
  let usedVcpu = 0;

  const hasSubagent = scenario && scenario.subagent && phase !== 'idle';
  if (hasSubagent && includeSubagent) {
    const { subagent } = scenario;
    const state = phase === 'running' ? 'running' : 'planned';
    rows.push(agentRowHtml(subagent.name, subagent.vcpu, state));
    if (state === 'running') usedVcpu += subagent.vcpu;
  }

  for (const rec of lastSessionRecords) {
    if (!rec || TERMINAL_STATUSES.has(rec.status)) continue;
    if (!isSystemBSession(rec)) continue;
    rows.push(sessionAgentRowHtml(rec));
    if (rec.status === 'Running') usedVcpu += profileToVcpu(rec.profile);
  }

  if (!rows.length) {
    // Preserve the planned-subagent hint so a viewer mid-scenario still
    // sees "subagent planned" instead of a flat "no agents" — the
    // planned hint is the most informative thing we can show at that
    // moment.
    if (hasSubagent && !includeSubagent) {
      sysBOffloadEl.innerHTML = '<div class="agent-row-empty">subagent planned (will spawn during run)</div>';
    } else {
      sysBOffloadEl.innerHTML = '<div class="agent-row-empty">no agents on this system</div>';
    }
    renderCapacityB(0);
    return;
  }
  sysBOffloadEl.innerHTML = rows.join('');
  renderCapacityB(usedVcpu);
}

// Back-compat shim: scenario flow still calls renderOffload(...) and we
// also use it to remember the latest includeSubagent flag for the poll
// loop's redraw.
function renderOffload(scenario, phase, includeSubagent) {
  currentIncludeSubagent = Boolean(includeSubagent);
  renderSystemB(scenario, phase, currentIncludeSubagent);
}

// Re-render System B using current scenario + multi-session state.
// Called from the /api/sessions poll loop alongside redrawSystemA so
// system_b-targeted fan-out sessions appear in the right pool.
function redrawSystemB() {
  if (liveArchitecturePinned) return;
  const scenario = currentScenario ? scenarios[currentScenario] : null;
  renderSystemB(scenario, currentPhase, currentIncludeSubagent);
}

function renderLiveAgentArchitecture(key, state = 'running') {
  liveArchitecturePinned = true;
  currentScenario = key;
  currentPhase = state === 'running' ? 'running' : 'planned';
  setDataMode(`Live agent command: ${key}`);
  setOrchestrationActive(['openclaw']);
  setServiceState({});
  const isRunning = state === 'running';
  const rowState = isRunning ? 'running' : 'planned';
  const terminalLabel = state === 'error' ? 'failed' : 'completed';
  sysAAgentsEl.innerHTML = agentRowHtml('control-plane-offload', 1, rowState);
  renderCapacity(isRunning ? 1 : 0);
  sysBOffloadEl.innerHTML = `
    <div class="agent-row ${rowState}">
      <span class="agent-name">agent-stub gateway</span>
      <span class="agent-cpu">System B</span>
      <span class="agent-status">${isRunning ? 'running' : terminalLabel}</span>
    </div>
  `;
  renderCapacityB(isRunning ? 1 : 0);
  setCrossArrow(true);
  renderConsole({
    mode: 'live agent_invoke',
    route: 'web demo → System A → System B',
    'system a': 'control-plane-offload',
    'system b': 'offload-worker → agent-stub',
    'agent runtime': 'System B agent-stub',
    'model route': 'not used for this command',
    'artifact view': 'live job result'
  });
}

function setCrossArrow(visible) {
  crossArrowEl.classList.toggle('visible', Boolean(visible));
}

function renderConsole(entries) {
  consoleEl.innerHTML = Object.entries(entries).map(([k, v]) => `
    <div class="console-line"><span class="console-key">${k}</span><span class="console-val">${v}</span></div>
  `).join('');
}

function renderToolActivity(rows) {
  toolActivityEl.innerHTML = rows.map((row) => {
    if (row.empty) {
      return `<div class="tool-row empty">${escapeHtml(row.label || '')}</div>`;
    }
    if (row.tool) {
      const icon = row.icon ? `<span class="tool-icon">${escapeHtml(row.icon)}</span>` : '';
      const status = row.status
        ? `<span class="tool-status" data-status="${escapeHtml(row.status)}">${escapeHtml(row.status)}</span>`
        : '';
      const value = row.value !== undefined && row.value !== null
        ? `<span class="tool-value">"${escapeHtml(truncateValue(row.value, 80))}"</span>`
        : '';
      return `
        <div class="tool-row tool-row-rich" data-status="${escapeHtml(row.status || 'planned')}">
          <span class="tool-head">${icon}<span class="tool-name">${escapeHtml(row.tool)}:</span></span>
          ${value}
          ${status}
        </div>
      `;
    }
    // legacy { name, status } shape used by Stack overview / live runs
    return `
      <div class="tool-row" data-status="${escapeHtml(row.status || '')}">
        <span class="tool-name">${escapeHtml(row.name || '')}</span>
        <span class="tool-status">${escapeHtml(row.status || '')}</span>
      </div>
    `;
  }).join('');
}

function renderMetrics(entries) {
  metricsEl.innerHTML = Object.entries(entries).map(([k, v]) => `
    <div class="metric-card"><span class="metric-label">${escapeHtml(k)}</span><span class="metric-value">${escapeHtml(v == null ? '' : v)}</span></div>
  `).join('');
}

function applyIdle() {
  cancelRun();
  currentScenario = null;
  currentPhase = 'idle';
  setDataMode('');
  setOrchestrationActive([]);
  setServiceState({});
  renderSystemA(null, 'idle');
  renderOffload(null, 'idle', false);
  setCrossArrow(false);
  renderToolActivity([{ empty: true, label: 'Select a scenario to see the tool calls, API calls, and subagents it will use.' }]);
  commandLogEl.textContent = 'Waiting for scenario selection.';
  renderMetrics({ Model: '—', Route: '—', Tools: '—', Artifacts: '—' });
  result.textContent = 'Waiting for scenario selection.';
  result.className = 'result empty-state';
  renderConsole(idleConsole);
}

function applyPlanned(key) {
  cancelRun();
  const scenario = scenarios[key];
  if (!scenario) return;
  currentScenario = key;
  currentPhase = 'planned';
  setDataMode(`Scenario: ${key}`);
  setOrchestrationActive(scenario.orchestrationActive);
  setServiceState({});
  renderSystemA(scenario, 'planned');
  renderOffload(scenario, 'planned', false);
  setCrossArrow(false);
  renderToolActivity(buildScenarioToolActivity(scenario, 'planned'));
  commandLogEl.textContent = 'Press "Run demo" to execute a live agent call. Scenario walkthrough metrics are hidden until a run starts.';
  renderMetrics({ Status: 'not started', Mode: 'live backend when available', Route: '—', Tool: '—' });
  result.textContent = `Press "Run demo" to run ${key}. No artifact has been produced yet.`;
  result.className = 'result empty-state';
  renderConsole(scenario.console);
}

function applyRunning(key, options) {
  const scenario = scenarios[key];
  if (!scenario) return;
  const includeSubagentNow = options && options.includeSubagentNow;
  setOrchestrationActive(scenario.orchestrationActive);
  const activeServices = { ...scenario.services };
  if (scenario.subagent && !includeSubagentNow) {
    activeServices.erag = false;
  }
  setServiceState(activeServices);
  currentPhase = 'running';
  renderSystemA(scenario, 'running');
  renderOffload(scenario, 'running', Boolean(includeSubagentNow));
  setCrossArrow(scenario.crossSystemArrow && includeSubagentNow);
}

document.querySelectorAll('[data-scenario]').forEach((el) => {
  el.addEventListener('click', () => {
    applyPlanned(el.dataset.scenario);
  });
});

document.querySelector('[data-action="status"]').addEventListener('click', () => {
  cancelRun();
  currentScenario = null;
  currentPhase = 'idle';
  setDataMode('Stack overview');
  setOrchestrationActive(['openclaw', 'litellm', 'sambanova', 'ent-inference-route']);
  setServiceState({ erag: true, 'ent-inference': true });
  renderSystemA(null, 'idle');
  renderOffload(null, 'idle', false);
  setCrossArrow(false);
  renderToolActivity([
    { icon: '🩺', tool: 'health_probe', value: 'GET /api/health', status: 'active' },
    { icon: '🩺', tool: 'ready_probe', value: 'GET /api/ready', status: 'active' },
    { icon: '🌐', tool: 'router_check', value: 'LiteLLM /v1/models', status: 'active' },
    { icon: '🌐', tool: 'router_check', value: 'Enterprise Inference SLM', status: 'active' }
  ]);
  commandLogEl.textContent = 'Stack overview mode: every node and route in the diagram is lit up so you can see the full architecture. No scenario is being executed.';
  renderMetrics({
    Model: 'LiteLLM → SambaNova / Ent. Inference',
    Route: 'stack overview',
    Tools: 'status probes',
    Artifacts: '0'
  });
  result.textContent = 'Stack overview: every component reachable, no scenario running.';
  result.className = 'result';
  renderConsole({
    mode: 'stack overview',
    'openclaw version': '2026.4.15',
    orchestrator: 'OpenClaw',
    'orchestration alt': 'Flowise (optional)',
    'litellm gateway': 'litellm/sambanova primary',
    'litellm endpoint': 'port 4000 /v1',
    'sambanova model': 'DeepSeek-V3.1',
    'enterprise inference': 'reachable',
    'model route': 'LiteLLM → SambaNova / Ent. Inference',
    'session scope': 'isolated per user',
    'placement': 'no scenario active',
    'artifact view': 'status only'
  });
});

document.querySelector('[data-action="reset"]').addEventListener('click', () => {
  applyIdle();
});

const scenarioCardsEl = document.getElementById('scenario-cards');
const cardsNavButtons = document.querySelectorAll('[data-cards-scroll]');

function updateCardsNav() {
  if (!scenarioCardsEl) return;
  const max = scenarioCardsEl.scrollWidth - scenarioCardsEl.clientWidth;
  const overflowing = max > 4;
  const atStart = scenarioCardsEl.scrollLeft <= 4;
  const atEnd = scenarioCardsEl.scrollLeft >= max - 4;

  // Desktop CSS only switches the cards container into horizontal-scroll mode
  // when this class is present, so the overflow detection here drives the
  // visual layout as well as the nav buttons.
  scenarioCardsEl.classList.toggle('cards-overflow', overflowing);

  cardsNavButtons.forEach((btn) => {
    const isPrev = btn.dataset.cardsScroll === 'prev';
    const disabled = !overflowing || (isPrev ? atStart : atEnd);
    btn.classList.toggle('cards-nav-disabled', disabled);
    btn.disabled = disabled;
  });
}

cardsNavButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!scenarioCardsEl) return;
    const direction = btn.dataset.cardsScroll === 'prev' ? -1 : 1;
    const step = Math.max(220, Math.floor(scenarioCardsEl.clientWidth * 0.6));
    scenarioCardsEl.scrollBy({ left: direction * step, behavior: 'smooth' });
  });
});

if (scenarioCardsEl) {
  scenarioCardsEl.addEventListener('scroll', updateCardsNav, { passive: true });
  window.addEventListener('resize', updateCardsNav);
  updateCardsNav();
}

function buildWalkthroughPhases(scenario) {
  const lines = (scenario.commandLog || '').split('\n');
  const richTools = Array.isArray(scenario.toolActivity) ? scenario.toolActivity : [];
  const timeline = (scenario.timeline && scenario.timeline.length)
    ? scenario.timeline
    : [['Walkthrough', 'Scenario replay']];
  const phaseCount = timeline.length;
  const chunkSize = Math.ceil(lines.length / phaseCount);
  const parsedArtifacts = Number(scenario.metrics.Artifacts);
  const artifactTotal = Number.isFinite(parsedArtifacts) ? parsedArtifacts : phaseCount;
  const toolPerPhase = Math.max(1, Math.ceil(richTools.length / phaseCount));

  return timeline.map((entry, idx) => {
    const chunk = lines.slice(idx * chunkSize, (idx + 1) * chunkSize).join('\n');
    const activeBoundary = (idx + 1) * toolPerPhase;
    const tools = richTools.map((tool, toolIdx) => {
      let status = 'queued';
      if (toolIdx < activeBoundary - toolPerPhase) status = 'done';
      else if (toolIdx < activeBoundary) status = 'active';
      if (idx === phaseCount - 1) status = 'done';
      return { ...tool, status };
    });
    return {
      label: entry[0],
      detail: entry[1],
      chunk,
      tools,
      artifacts: String(Math.min(idx + 1, artifactTotal))
    };
  });
}

function runSimulatedWalkthrough(scenarioKey) {
  const scenario = scenarios[scenarioKey];
  if (!scenario) return;
  applyRunning(scenarioKey, { includeSubagentNow: false });
  const phases = buildWalkthroughPhases(scenario);
  const phaseDurationMs = 1800;
  const route = scenario.metrics.Route || scenario.console.placement || '—';
  const model = scenario.metrics.Model || '—';
  const subagentPhaseIdx = scenario.subagent
    ? Math.max(1, Math.round(scenario.subagent.spawnDelayMs / phaseDurationMs))
    : -1;

  commandLogEl.textContent = '';
  const phaseTotal = phases.length;
  result.textContent = `Drafting artifact… [0/${phaseTotal}]`;
  result.className = 'result empty-state';

  phases.forEach((phase, idx) => {
    runTimers.push(setTimeout(() => {
      commandLogEl.textContent += (commandLogEl.textContent ? '\n' : '') + phase.chunk;
      commandLogEl.scrollTop = commandLogEl.scrollHeight;
      renderToolActivity(phase.tools.length ? phase.tools : [{ empty: true, label: phase.detail }]);
      renderMetrics({
        Model: model,
        Route: `${route} · ${phase.label}`,
        Tools: phase.tools
          .filter((tool) => tool.status === 'active' || tool.status === 'done')
          .map((tool) => tool.tool)
          .join(', ') || '—',
        Artifacts: phase.artifacts
      });
      result.textContent = `Drafting artifact… [${idx + 1}/${phaseTotal}: ${phase.label}]`;
      if (idx === subagentPhaseIdx) {
        applyRunning(scenarioKey, { includeSubagentNow: true });
      }
    }, idx * phaseDurationMs));
  });

  const totalDuration = phases.length * phaseDurationMs;
  runTimers.push(setTimeout(() => {
    result.textContent = scenario.result;
    result.className = 'result';
    renderToolActivity(buildScenarioToolActivity(scenario, 'done'));
    restoreRunButton();
  }, totalDuration));
}

async function runLiveWalkthrough(scenarioKey) {
  const scenario = scenarios[scenarioKey];
  if (!scenario) return;
  const myRunId = ++liveRunId;
  const sessionId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const liveRoute = 'web demo → System A control plane → System B offload-worker → System B agent-stub';
  const liveAgent = 'System B agent-stub';
  const invoke = scenario.agentInvoke || { tool: 'command', args: { text: 'whoami' } };

  renderLiveAgentArchitecture(scenarioKey, 'running');

  // Live walkthrough goes through the System B agent-stub gateway via task_type=agent_invoke
  // (the worker forwards to OPENCLAW_GATEWAY_URL/tools/invoke). The gateway
  // classifies the input and runs a real allow-listed tool, so the command
  // log shows actual stdout/result rather than a scripted narration.
  const submitBody = {
    task_type: 'agent_invoke',
    payload: { tool: invoke.tool, args: invoke.args },
    session_id: sessionId
  };
  commandLogEl.textContent = [
    `Live run: ${scenarioKey}`,
    `Route: ${liveRoute}`,
    `Agent: ${liveAgent}`,
    `Input: ${invoke.args && invoke.args.text ? invoke.args.text : invoke.tool}`,
    ''
  ].join('\n');
  result.textContent = `Live run submitted for ${scenarioKey}; waiting for job result…`;
  result.className = 'result empty-state';
  renderToolActivity([
    { icon: '🌐', tool: 'api_call', value: `POST /api/offload (agent_invoke: ${invoke.tool})`, status: 'active' }
  ]);
  renderMetrics({
    Status: 'submitting',
    Route: 'System A → System B',
    Agent: liveAgent,
    Tool: invoke.tool
  });

  const stillCurrent = () => myRunId === liveRunId;
  const finish = () => { if (stillCurrent()) restoreRunButton(); };
  const finalizeLive = (state) => {
    if (!stillCurrent()) return;
    renderLiveAgentArchitecture(scenarioKey, state);
    finish();
  };
  const appendLog = (line) => {
    if (!stillCurrent()) return;
    commandLogEl.textContent += (commandLogEl.textContent.endsWith('\n') ? '' : '\n') + line;
    commandLogEl.scrollTop = commandLogEl.scrollHeight;
  };

  let submit;
  try {
    submit = await fetchJson(`${API_BASE}/offload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitBody)
    });
  } catch (err) {
    if (!stillCurrent()) return;
    appendLog(`[error] submit failed: ${err.message}`);
    result.textContent = `Live run failed: ${err.message}`;
    finalizeLive('error');
    return;
  }
  if (!stillCurrent()) return;

  appendLog(`job_id=${submit.job_id} status=${submit.status}`);
  renderToolActivity([
    { icon: '🌐', tool: 'api_call', value: `POST /api/offload (agent_invoke: ${invoke.tool})`, status: 'done' },
    { icon: '🔁', tool: 'poll_job', value: `GET /api/offload/${submit.job_id}`, status: 'active' }
  ]);

  // Poll until terminal. The control-plane forwards synchronously so the
  // first GET typically already returns "completed" — the poll is here so we
  // stay correct if the relay ever switches to async.
  const renderPollError = (detail) => {
    renderToolActivity([
      { icon: '🌐', tool: 'api_call', value: `POST /api/offload (agent_invoke: ${invoke.tool})`, status: 'done' },
      { icon: '🔁', tool: 'poll_job', value: `GET /api/offload/${submit.job_id}`, status: 'error' }
    ]);
    result.textContent = detail;
    result.className = 'result';
  };
  const deadline = Date.now() + 90_000;
  let status = null;
  while (Date.now() < deadline) {
    try {
      status = await fetchJson(`${API_BASE}/offload/${submit.job_id}`);
    } catch (err) {
      if (!stillCurrent()) return;
      appendLog(`[error] poll failed: ${err.message}`);
      renderPollError(`Live run failed while polling job ${submit.job_id}: ${err.message}`);
      finalizeLive('error');
      return;
    }
    if (!stillCurrent()) return;
    if (status.status === 'completed' || status.status === 'error') break;
    await sleep(500);
  }

  if (!status || (status.status !== 'completed' && status.status !== 'error')) {
    appendLog(`[error] job did not complete within 90s`);
    renderPollError(`Live run timed out waiting for job ${submit.job_id} (90s).`);
    finalizeLive('error');
    return;
  }
  if (status.status === 'error') {
    appendLog(`[worker error] ${status.error || 'unknown error'}`);
    result.textContent = `Live run errored: ${status.error || 'see log'}`;
    finalizeLive('error');
    return;
  }

  // offload-worker's agent_invoke wraps the gateway response under
  // result.response (parsed JSON) or result.response_text (raw body when the
  // gateway returned a non-JSON 200). When over the inline threshold it
  // lands as result_ref and we have to fetch the artifact to get the wrapper
  // back. We only render the JSON shape; a response_text means the gateway
  // didn't speak our protocol, which is a failure even at HTTP 200.
  let agentPayload = null;
  if (status.result) {
    const wrapper = status.result;
    if (wrapper && typeof wrapper === 'object' && 'response' in wrapper) {
      agentPayload = wrapper.response;
    } else if (wrapper && typeof wrapper === 'object' && 'response_text' in wrapper) {
      const text = String(wrapper.response_text ?? '');
      appendLog(`[warn] gateway returned non-JSON body (${text.length} chars):`);
      appendLog(text.slice(0, 500) + (text.length > 500 ? ' …[truncated]' : ''));
      result.textContent = `Live run finished, but the gateway returned a non-JSON body (job ${submit.job_id}).`;
      finalizeLive('error');
      return;
    } else {
      agentPayload = wrapper;
    }
  } else if (status.result_ref) {
    agentPayload = await fetchArtifactPayload(status.result_ref, appendLog);
    if (!stillCurrent()) return;
    if (!agentPayload) {
      result.textContent = `Live run finished, but response artifact fetch failed (job ${submit.job_id}).`;
      finalizeLive('error');
      return;
    }
  } else {
    appendLog(`[agent] empty response (no inline result, no artifact ref)`);
    result.textContent = `Live run returned no payload (job ${submit.job_id}).`;
    finalizeLive('error');
    return;
  }

  // fetchArtifactPayload's unwrap can also yield a string when only
  // response_text is set on the artifact. Reject anything that isn't a
  // proper JSON object so the verdict logic below can't silently coerce
  // an unstructured body into PASS.
  if (!agentPayload || typeof agentPayload !== 'object' || Array.isArray(agentPayload)) {
    appendLog(`[agent] gateway response was not a JSON object (got ${typeof agentPayload})`);
    result.textContent = `Live run finished, but the gateway response wasn't a JSON object (job ${submit.job_id}).`;
    finalizeLive('error');
    return;
  }

  emitAgentResult(agentPayload, appendLog);

  const elapsedMs = (status.completed_at && status.submitted_at)
    ? Math.max(0, (status.completed_at - status.submitted_at) * 1000)
    : null;
  const inner = (agentPayload.result && agentPayload.result.chosen_tool)
    ? agentPayload.result.result
    : (agentPayload.result || null);
  const chosenTool = (agentPayload.result && agentPayload.result.chosen_tool)
    || agentPayload.tool
    || invoke.tool;
  // Require an explicit status==='ok' from the gateway. Anything else
  // (missing field, "error", unrecognized value) must not coerce to PASS.
  const agentOk = agentPayload.status === 'ok';
  // Treat shell exit_code !== 0 as failure too, since the gateway can return
  // status=ok with an inner non-zero exit (e.g. command-not-found through
  // the shell tool). Other tools don't carry exit_code, so default to ok.
  const exitCode = inner && typeof inner === 'object' && 'exit_code' in inner
    ? inner.exit_code
    : null;
  const succeeded = agentOk && (exitCode === null || exitCode === 0);

  renderToolActivity([
    { icon: '🌐', tool: 'api_call', value: `POST /api/offload (agent_invoke: ${invoke.tool})`, status: 'done' },
    { icon: '🔁', tool: 'poll_job', value: `GET /api/offload/${submit.job_id}`, status: 'done' },
    { icon: '🤖', tool: 'openclaw', value: `tool=${chosenTool}${exitCode !== null ? ` exit=${exitCode}` : ''}`, status: succeeded ? 'done' : 'error' }
  ]);
  renderMetrics({
    Status: succeeded ? 'completed' : 'failed',
    Route: 'System A → System B',
    Agent: liveAgent,
    Tool: chosenTool,
    Exit: exitCode === null ? '—' : String(exitCode),
    Elapsed: elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(2)}s` : '—',
    'Job ID': submit.job_id
  });
  renderLiveAgentArchitecture(scenarioKey, succeeded ? 'done' : 'error');
  result.textContent = renderLiveArtifact({
    scenarioKey,
    jobId: submit.job_id,
    chosenTool,
    exitCode,
    elapsedMs,
    route: liveRoute,
    agent: liveAgent,
    succeeded,
    resultRef: status.result_ref || null,
    agentElapsedMs: typeof agentPayload?.elapsed_ms === 'number' ? agentPayload.elapsed_ms : null,
    output: liveOutputSummary(chosenTool, inner)
  });
  result.className = 'result';
  finish();
}

function liveOutputSummary(chosenTool, inner) {
  if (!inner || typeof inner !== 'object') return '';
  if (chosenTool === 'shell') {
    const stdout = (inner.stdout || '').trimEnd();
    const stderr = (inner.stderr || '').trimEnd();
    return stdout || stderr || '(no output)';
  }
  if (chosenTool === 'read_file') return (inner.content || '').trimEnd();
  if (chosenTool === 'list_files') {
    return (inner.entries || []).map((e) => `${e.kind === 'dir' ? 'dir ' : 'file'} ${e.name}`).join('\n');
  }
  if (chosenTool === 'summarize') return inner.first_sentence || '';
  if (chosenTool === 'echo') return (inner.echo && inner.echo.text) || inner.text || '';
  return JSON.stringify(inner, null, 2);
}

function renderLiveArtifact({ scenarioKey, jobId, chosenTool, exitCode, elapsedMs, route, agent, succeeded, resultRef, agentElapsedMs, output }) {
  const elapsed = elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(2)}s` : '—';
  const verdict = succeeded ? 'PASS' : 'FAIL';
  const lines = [
    `artifacts/live/${scenarioKey}/${jobId}.txt`,
    '─────────────────────────────────────────',
    `Live agent run — ${scenarioKey}`,
    '',
    `job_id    ${jobId}`,
    `route     ${route}`,
    `agent     ${agent}`,
    `tool      ${chosenTool}`,
  ];
  if (exitCode !== null) lines.push(`exit      ${exitCode}`);
  lines.push(`elapsed   ${elapsed}${agentElapsedMs !== null ? ` (gateway ${agentElapsedMs} ms)` : ''}`);
  if (resultRef) lines.push(`stored    ${resultRef}`);
  if (output) {
    const compact = output.length > 1200 ? `${output.slice(0, 1200)}\n…[truncated]` : output;
    lines.push('', 'Output', compact);
  }
  lines.push('', `Final: ${verdict}`);
  return lines.join('\n');
}

runDemoBtn.addEventListener('click', () => {
  const scenarioKey = currentScenario || 'terminal-agent';
  if (!currentScenario) applyPlanned(scenarioKey);
  const scenario = scenarios[scenarioKey];
  if (!scenario) return;

  clearRunTimers();
  liveRunId += 1;
  liveArchitecturePinned = false;
  runDemoBtn.textContent = liveBackendAvailable ? 'Running (live)…' : 'Running...';
  runDemoBtn.disabled = true;

  if (liveBackendAvailable) {
    runLiveWalkthrough(scenarioKey);
  } else {
    runSimulatedWalkthrough(scenarioKey);
  }
});

// ---- agent command form ------------------------------------------------

const agentForm = document.getElementById('agent-command-form');
const agentInput = document.getElementById('agent-command-input');
const agentSubmit = document.getElementById('agent-command-submit');
const agentStatusEl = document.getElementById('agent-command-status');
// Panel-local log: keep agent-command output visible right under the form
// instead of scrolling the user down to the scenario-level "Live command log".
// The previous wiring appended to commandLogEl, which lives in a different
// section — easy to miss, so users reported "no logs output" even when the
// command had succeeded.
const agentLogEl = document.getElementById('agent-command-log');
const agentSubmitOriginalLabel = agentSubmit ? agentSubmit.textContent : 'Run agent command';

function setAgentStatus(text, kind) {
  if (!agentStatusEl) return;
  agentStatusEl.textContent = text || '';
  agentStatusEl.dataset.kind = kind || '';
}

function resetAgentLog() {
  if (!agentLogEl) return;
  agentLogEl.textContent = '';
}

function appendAgentLog(text) {
  if (!agentLogEl) return;
  agentLogEl.textContent += (agentLogEl.textContent ? '\n' : '') + text;
  agentLogEl.scrollTop = agentLogEl.scrollHeight;
}

// Format an OpenClaw gateway response (the body wrapped under
// status.result.response by offload-worker._dispatch_agent_invoke) into
// log lines, emitted via `log(line)`. Shared by the live walkthrough's
// command log and the agent command panel so both surfaces stay in sync.
function emitAgentResult(payload, log) {
  if (!payload || typeof payload !== 'object') {
    log(`[agent] empty payload`);
    return;
  }
  if (payload.status === 'error') {
    log(`[agent error] ${payload.error || 'unknown error'}`);
    return;
  }
  if (payload.status !== 'ok') {
    // Anything else (missing field, unrecognized value) shouldn't render as
    // healthy. Mirrors runLiveWalkthrough's verdict guard so the log and
    // the Result panel agree.
    log(`[agent error] unexpected status=${payload.status === undefined ? 'missing' : String(payload.status)}`);
    return;
  }
  const elapsed = typeof payload.elapsed_ms === 'number' ? `${payload.elapsed_ms} ms` : '?';
  log(`[agent ok] tool=${payload.tool} elapsed=${elapsed}`);
  if (Array.isArray(payload.trace) && payload.trace.length) {
    payload.trace.forEach((step) => {
      log(`  [trace ${step.step}] ${step.tool}: ${step.summary}`);
    });
  }
  const result = payload.result;
  if (!result) return;

  // The `command` tool wraps an inner tool result. Render the inner one.
  const inner = result.result && result.chosen_tool ? result.result : result;
  const innerTool = result.chosen_tool || payload.tool;
  if (result.chosen_tool) {
    log(`  [agent picked] ${result.chosen_tool} (${result.rationale})`);
  }
  if (innerTool === 'shell') {
    log(`  $ ${(inner.argv || []).join(' ')}  (cwd=${inner.cwd}, exit=${inner.exit_code})`);
    if (inner.stdout) log(`--- stdout ---\n${inner.stdout.trimEnd()}`);
    if (inner.stderr) log(`--- stderr ---\n${inner.stderr.trimEnd()}`);
  } else if (innerTool === 'read_file') {
    log(`  read ${inner.path} (${inner.bytes} bytes${inner.truncated ? ', truncated' : ''})`);
    log(`--- content ---\n${(inner.content || '').trimEnd()}`);
  } else if (innerTool === 'list_files') {
    log(`  list ${inner.root} (${(inner.entries || []).length} entries)`);
    (inner.entries || []).forEach((e) => {
      const sz = e.size === null || e.size === undefined ? '' : ` ${e.size}B`;
      log(`   - ${e.kind === 'dir' ? 'd' : 'f'} ${e.name}${sz}`);
    });
  } else if (innerTool === 'summarize') {
    log(`  summary of ${inner.input_chars} chars`);
    log(`  first sentence: ${inner.first_sentence}`);
    const top = (inner.top_words || []).map((w) => `${w.word}(${w.count})`).join(', ');
    if (top) log(`  top words: ${top}`);
  } else if (innerTool === 'echo') {
    log(`  echo: ${JSON.stringify(inner.echo || inner, null, 2)}`);
  } else {
    log(JSON.stringify(inner, null, 2));
  }
}

function renderAgentResult(payload) {
  emitAgentResult(payload, appendAgentLog);
}

function agentResultSummary(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, tool: 'unknown', lines: ['No agent response.'] };
  if (payload.status === 'error') return { ok: false, tool: payload.tool || 'agent', lines: [`Agent error: ${payload.error || 'unknown error'}`] };
  if (payload.status !== 'ok') return { ok: false, tool: payload.tool || 'agent', lines: [`Unexpected agent status: ${payload.status || 'missing'}`] };

  const result = payload.result || {};
  const chosen = result.chosen_tool || payload.tool || 'agent';
  const rationale = result.rationale || '';
  const inner = result.result && result.chosen_tool ? result.result : result;
  const lines = [
    'Route: web demo → System A control plane → System B offload-worker → System B agent-stub',
    `Agent: System B agent-stub`,
    `Tool selected: ${chosen}${rationale ? ` — ${rationale}` : ''}`,
  ];

  if (chosen === 'shell') {
    lines.push(`Command: ${(inner.argv || []).join(' ') || 'shell'}`);
    lines.push(`Exit code: ${inner.exit_code}`);
    if (inner.stdout) lines.push(`Output:\n${inner.stdout.trimEnd()}`);
    if (inner.stderr) lines.push(`Stderr:\n${inner.stderr.trimEnd()}`);
  } else if (chosen === 'read_file') {
    lines.push(`Read: ${inner.path || '(unknown file)'}`);
    lines.push((inner.content || '').trimEnd() || '(empty file)');
  } else if (chosen === 'list_files') {
    lines.push(`List: ${inner.root || '.'}`);
    const entries = (inner.entries || []).map((e) => `${e.kind === 'dir' ? 'dir ' : 'file'} ${e.name}`);
    lines.push(entries.length ? entries.join('\n') : '(no entries)');
  } else if (chosen === 'summarize') {
    lines.push(inner.first_sentence ? `Summary: ${inner.first_sentence}` : 'Summary complete.');
  } else if (chosen === 'echo') {
    const echoed = inner.echo && inner.echo.text ? inner.echo.text : (inner.text || '');
    lines.push(`No execution rule matched, so the gateway echoed the input instead of running a command.`);
    if (echoed) lines.push(`Echo: ${echoed}`);
  } else {
    lines.push(JSON.stringify(inner, null, 2));
  }
  return { ok: true, tool: chosen, lines };
}

function renderAgentCommandOnArchitecture(tool, status = 'running') {
  setCrossArrow(true);
  const terminal = status === 'done' || status === 'error';
  if (terminal) {
    sysBOffloadEl.innerHTML = `
      <div class="agent-row planned">
        <span class="agent-name">agent-stub gateway</span>
        <span class="agent-cpu">System B</span>
        <span class="agent-status">${status === 'error' ? 'failed' : 'completed'}</span>
      </div>
    `;
  } else {
    sysBOffloadEl.innerHTML = agentRowHtml('agent-stub gateway', 1, 'running');
  }
  renderCapacityB(terminal ? 0 : 1);
  renderToolActivity([
    { icon: '🌐', tool: 'submit', value: 'POST /api/offload', status: 'done' },
    { icon: '🧭', tool: 'route', value: 'System A → System B', status: 'done' },
    { icon: '🤖', tool: 'agent-stub', value: tool || 'classifying', status: status === 'error' ? 'error' : status }
  ]);
}

async function runAgentCommand(text) {
  if (!liveBackendAvailable) {
    setAgentStatus(BACKEND_REQUIRED_MSG, 'warn');
    return;
  }
  const sessionId = `web-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setAgentStatus(`running on System B agent-stub…`, 'pending');
  // Each invocation is its own transcript — clearing avoids piling history on
  // top of an old run that may have errored or been about a different tool.
  resetAgentLog();
  appendAgentLog(`Input: ${text}`);
  appendAgentLog(`Route: web demo → System A control plane → System B offload-worker → System B agent-stub`);
  renderAgentCommandOnArchitecture('classifying', 'active');

  // Deadline guards the entire submit+poll flow. Each fetchJson call gets
  // an explicit timeout derived from the remaining budget; without this,
  // fetchJson's 60s default could let one stalled request blow past the
  // advertised 30s window.
  const deadline = Date.now() + 30_000;
  const remainingMs = () => Math.max(0, deadline - Date.now());

  let submit;
  try {
    submit = await fetchJson(`${API_BASE}/offload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: remainingMs(),
      body: JSON.stringify({
        task_type: 'agent_invoke',
        payload: { tool: 'command', args: { text } },
        session_id: sessionId,
      }),
    });
  } catch (err) {
    setAgentStatus(`submit failed: ${err.message}`, 'error');
    appendAgentLog(`[error] submit failed: ${err.message}`);
    renderAgentCommandOnArchitecture('submit failed', 'error');
    return;
  }

  appendAgentLog(`Job: ${submit.job_id} (${submit.status})`);

  // The control-plane forwards synchronously, so the first GET typically
  // already returns terminal. Poll briefly to stay correct if that ever
  // becomes async.
  let status = null;
  while (Date.now() < deadline) {
    const callTimeout = remainingMs();
    if (callTimeout <= 0) break;
    try {
      status = await fetchJson(
        `${API_BASE}/offload/${submit.job_id}`,
        { timeoutMs: callTimeout }
      );
    } catch (err) {
      setAgentStatus(`poll failed: ${err.message}`, 'error');
      appendAgentLog(`[error] poll failed: ${err.message}`);
      renderAgentCommandOnArchitecture('poll failed', 'error');
      return;
    }
    if (status.status === 'completed' || status.status === 'error') break;
    await sleep(300);
  }

  if (!status || (status.status !== 'completed' && status.status !== 'error')) {
    setAgentStatus('agent did not respond within 30s', 'error');
    appendAgentLog(`[error] agent did not respond within 30s`);
    renderAgentCommandOnArchitecture('timeout', 'error');
    return;
  }
  if (status.status === 'error') {
    setAgentStatus(`worker error: ${status.error || 'unknown'}`, 'error');
    appendAgentLog(`[worker error] ${status.error || 'unknown'}`);
    renderAgentCommandOnArchitecture('worker error', 'error');
    return;
  }

  // offload-worker's agent_invoke wraps the gateway response under
  // result.response (or .response_text if the body wasn't JSON). When the
  // wrapped response is larger than the worker's inline cutoff (4 KB) it's
  // pushed to MinIO and we get result_ref instead of result — common for
  // `read <large file>` or verbose summaries.
  let agentPayload = null;
  if (status.result) {
    const wrapper = status.result;
    agentPayload = wrapper.response || wrapper.response_text || wrapper;
  } else if (status.result_ref) {
    agentPayload = await fetchArtifactPayload(status.result_ref);
    if (!agentPayload) {
      // fetchArtifactPayload already logged the failure mode; surface a
      // clear final status instead of falsely claiming "agent returned ok".
      setAgentStatus(
        `agent finished, but response is stored as artifact ${status.result_ref} (fetch failed)`,
        'warn'
      );
      renderAgentCommandOnArchitecture('artifact fetch failed', 'error');
      return;
    }
  } else {
    appendAgentLog(`[agent] empty response (no inline result, no artifact ref)`);
    setAgentStatus(`agent returned no payload (job ${submit.job_id})`, 'warn');
    renderAgentCommandOnArchitecture('empty response', 'error');
    return;
  }

  const summary = agentResultSummary(agentPayload);
  resetAgentLog();
  summary.lines.forEach(appendAgentLog);

  // Surface gateway-level errors honestly: when the agent itself reported
  // status="error" (e.g. read on a missing file), the badge must reflect
  // that. The log already shows the error; don't end with "agent returned ok".
  const isAgentError = (agentPayload && agentPayload.status === 'error') || !summary.ok;
  const chosen = agentPayload && agentPayload.result && agentPayload.result.chosen_tool;
  if (isAgentError) {
    setAgentStatus(
      `agent error: ${agentPayload.error || 'see log'} (job ${submit.job_id})`,
      'error'
    );
  } else {
    setAgentStatus(
      chosen ? `System B agent-stub ran ${chosen} (job ${submit.job_id})` : `System B agent-stub returned ok (job ${submit.job_id})`,
      'ok'
    );
  }
  renderAgentCommandOnArchitecture(chosen || summary.tool, isAgentError ? 'error' : 'done');
}

async function fetchArtifactPayload(ref, log = appendAgentLog) {
  // Two hops: control-plane presigns a MinIO URL, then we fetch the JSON
  // from MinIO directly. The MinIO fetch crosses origins (web on :8080,
  // MinIO on :9000); if CORS isn't configured the browser will block it,
  // which is why we degrade to a clear status message instead of crashing.
  // `log` defaults to the agent-panel log; the live walkthrough passes its
  // own logger so error lines land next to the matching command.
  log(`[agent result stored as artifact ${ref}; fetching…]`);
  // Don't encodeURIComponent: the worker constructs refs as
  // `offload/<session>/<task>.json` from server-controlled alphanumerics
  // and the nginx /api/artifacts/<ref> location accepts raw `/`. Encoding
  // here would turn `/` into `%2F`, which neither the regex (no `%` class)
  // nor nginx's variable-substitution path handling round-trips cleanly.
  let presigned;
  try {
    presigned = await fetchJson(`${API_BASE}/artifacts/${ref}`);
  } catch (err) {
    log(`[error] artifact presign failed: ${err.message}`);
    return null;
  }
  // 10s timeout on the cross-origin MinIO fetch so a stalled/blocked request
  // can't strand the live walkthrough or the agent-command flow indefinitely.
  // The presigned URL carries short-lived MinIO credentials in the query
  // string; do NOT log it to the visible UI panel — operators can inspect
  // the failed request in DevTools if a manual retrieve is needed.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(presigned.url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) {
      log(`[error] artifact fetch HTTP ${r.status}`);
      return null;
    }
    const wrapper = await r.json();
    return wrapper.response || wrapper.response_text || wrapper;
  } catch (err) {
    log(`[error] artifact fetch failed: ${err.message} (CORS on MinIO?)`);
    log(`  presigned URL omitted from UI log; inspect the failed request in DevTools if needed`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

if (agentForm) {
  agentForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = (agentInput.value || '').trim();
    if (!text) {
      setAgentStatus('Type a command first.', 'warn');
      return;
    }
    if (!liveBackendAvailable) {
      setAgentStatus(BACKEND_REQUIRED_MSG, 'warn');
      return;
    }
    agentSubmit.disabled = true;
    agentSubmit.textContent = 'Running…';
    try {
      await runAgentCommand(text);
    } finally {
      agentSubmit.disabled = false;
      agentSubmit.textContent = agentSubmitOriginalLabel;
    }
  });
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchJson(url, init) {
  const opts = init || {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60_000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) {
      // Static-only deployments (python http.server, generic CDNs) answer
      // with HTML 404 pages; surfacing that body verbatim renders raw
      // markup in the UI. Strip HTML/whitespace-only bodies so the
      // message is just "HTTP <status> <statusText>".
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      let detail = '';
      if (!ct.includes('html')) {
        const text = await r.text().catch(() => '');
        const trimmed = text.trim();
        if (trimmed && !trimmed.startsWith('<')) {
          detail = `: ${trimmed.slice(0, 200)}`;
        }
      }
      const err = new Error(`HTTP ${r.status}${r.statusText ? ' ' + r.statusText : ''}${detail}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function setHealthDot(el, state, detail) {
  if (!el) return;
  el.classList.remove('ok', 'warn', 'down', 'idle', 'unknown');
  el.classList.add(state);
  const labels = {
    ok: 'healthy',
    warn: 'degraded',
    down: 'unreachable',
    idle: 'not configured',
    unknown: 'reachability unknown'
  };
  el.setAttribute('aria-label', labels[state] || state);
  if (detail) {
    el.setAttribute('title', detail);
  } else {
    el.removeAttribute('title');
  }
}

async function probeDependency(name) {
  // Hits control-plane's /probe/<name>. Returns { state, detail } where
  // state is one of "ok"|"down"|"unconfigured". Network errors translate
  // to "down" so the UI doesn't get stuck on the previous color.
  try {
    const body = await fetchJson(`${API_BASE}/probe/${name}`, { timeoutMs: 3000 });
    return body;
  } catch (err) {
    return { state: 'down', detail: err.message };
  }
}

function dotStateForProbe(probe) {
  if (!probe) return 'down';
  if (probe.state === 'ok') return 'ok';
  if (probe.state === 'unconfigured') return 'idle';
  return 'down';
}

async function probeBackend() {
  // /health says the relay is up; /ready says the worker is also reachable.
  // We additionally probe OpenClaw because Run demo now submits
  // task_type=agent_invoke, which the worker forwards to the gateway —
  // a healthy worker with an unset/unreachable OPENCLAW_GATEWAY_URL would
  // fail every live run, so live mode must require gateway reachability too.
  let cpHealthy = false;
  let workerReady = false;
  try {
    await fetchJson(`${API_BASE}/health`, { timeoutMs: 2500 });
    cpHealthy = true;
  } catch (_) {
    cpHealthy = false;
  }
  if (cpHealthy) {
    try {
      await fetchJson(`${API_BASE}/ready`, { timeoutMs: 2500 });
      workerReady = true;
    } catch (_) {
      workerReady = false;
    }
  }
  setHealthDot(healthDots.systemA, cpHealthy ? 'ok' : 'down');
  // System B / OpenClaw / LiteLLM / SambaNova all sit behind the control
  // plane — we can only probe them through it. When the relay is down we
  // genuinely don't know their state, so show "unknown" (gray) instead of
  // "unreachable" (red). Red on those rows would imply we'd confirmed
  // they're broken, which we haven't.
  const cpDownTip = 'Control plane unreachable — cannot probe upstream';
  if (cpHealthy) {
    setHealthDot(healthDots.systemB, workerReady ? 'ok' : 'warn');
  } else {
    setHealthDot(healthDots.systemB, 'unknown', cpDownTip);
  }
  // OpenClaw / LiteLLM / SambaNova are probed honestly via the control
  // plane. When a probe URL isn't configured the dot stays neutral
  // ("not configured") instead of mirroring the relay's health.
  let openclawOk = false;
  if (cpHealthy) {
    const [openclaw, litellm, sambanova] = await Promise.all([
      probeDependency('openclaw'),
      probeDependency('litellm'),
      probeDependency('sambanova')
    ]);
    openclawOk = openclaw && openclaw.state === 'ok';
    setHealthDot(
      healthDots.openclaw,
      dotStateForProbe(openclaw),
      openclaw && openclaw.detail ? openclaw.detail : (openclaw && openclaw.target) || ''
    );
    setHealthDot(
      healthDots.litellm,
      dotStateForProbe(litellm),
      litellm && litellm.detail ? litellm.detail : (litellm && litellm.target) || ''
    );
    setHealthDot(
      healthDots.sambanova,
      dotStateForProbe(sambanova),
      sambanova && sambanova.detail ? sambanova.detail : (sambanova && sambanova.target) || ''
    );
  } else {
    setHealthDot(healthDots.openclaw, 'unknown', cpDownTip);
    setHealthDot(healthDots.litellm, 'unknown', cpDownTip);
    setHealthDot(healthDots.sambanova, 'unknown', cpDownTip);
  }
  liveBackendAvailable = cpHealthy && workerReady && openclawOk;
  runDemoBtn.title = liveBackendAvailable
    ? 'Live backend detected — submits agent_invoke through /api/offload to the OpenClaw gateway.'
    : (cpHealthy && workerReady && !openclawOk
        ? 'OpenClaw gateway unreachable — runs scripted walkthrough only.'
        : 'Backend not detected — runs scripted walkthrough only.');
}

applyIdle();
probeBackend();
setInterval(probeBackend, 15_000);

// ---------- Multi-agent fan-out ----------
//
// Owns the "Spawn N sessions" panel. The control plane decides whether
// each session is a real k8s Job (kube backend) or an in-memory
// simulation (local backend); the panel reports the backend so demo
// viewers know what they're watching.
//
// Polling: while any session is non-terminal we refresh every 1s; once
// they all settle we slow to 5s (still useful for the operator if they
// trigger another spawn). Polling is paused when the panel isn't visible
// and stopped entirely when the page unloads.

const multiSessionPanel = document.getElementById('multi-session-panel');
const multiSessionForm = document.getElementById('multi-session-form');
const multiSessionScenario = document.getElementById('multi-session-scenario');
const multiSessionProfile = document.getElementById('multi-session-profile');
const multiSessionTarget = document.getElementById('multi-session-target');
const multiSessionAgent = document.getElementById('multi-session-agent');
const multiSessionCount = document.getElementById('multi-session-count');
const multiSessionSpawn = document.getElementById('multi-session-spawn');
const multiSessionStatus = document.getElementById('multi-session-status');
const multiSessionSummary = document.getElementById('multi-session-summary');
const multiSessionRows = document.getElementById('multi-session-rows');
const multiSessionBackend = document.getElementById('multi-session-backend');
const multiSessionRefresh = document.getElementById('multi-session-refresh');
const multiSessionClear = document.getElementById('multi-session-clear');

// Tracks the session_ids this browser session asked the backend to
// spawn. The control plane shows ALL sessions, but the table only shows
// ones we created so two demo viewers don't crowd each other's tables.
//
// `hasSpawnedHere` flips true the first time this tab spawns anything
// and stays true forever after. Without this flag, "Clear list" would
// empty trackedSessionIds and the next refresh would flip back to
// "show all sessions" — which in a shared demo immediately repopulates
// the table with whatever other viewers are doing, defeating the
// per-tab isolation.
const trackedSessionIds = new Set();
let hasSpawnedHere = false;
const TERMINAL_STATUSES = new Set(['Completed', 'Failed']);

let multiSessionPollTimer = null;
let multiSessionPolling = false;

function setMultiSessionStatus(text, kind) {
  if (!multiSessionStatus) return;
  multiSessionStatus.textContent = text || '';
  multiSessionStatus.dataset.kind = kind || '';
}

// Map a target_system value to a short, friendly column label. Defaulted
// (null) sessions show "default" so the operator can tell the difference
// between "I picked scenario default" and "I picked System A".
function formatTargetSystem(rec) {
  const t = rec.target_system;
  if (!t) return 'default';
  if (t === 'system_a') return 'System A';
  if (t === 'system_b') return 'System B';
  return t;
}

// For terminal rows (Completed/Failed) the wall-clock age column carries
// no useful signal — the task already ran and the elapsed-since-create
// just keeps growing. Swap in the actual run duration
// (completed_at − started_at) once both timestamps are available; fall
// back to age otherwise so partial records (e.g. a session restored from
// the SQLite cache without started_at) still render something.
function formatAgeOrDuration(rec, now) {
  if (TERMINAL_STATUSES.has(rec.status) && rec.completed_at && rec.started_at) {
    return `${formatAge(rec.completed_at - rec.started_at)} (run)`;
  }
  return formatAge(now - (rec.created_at || now));
}

function renderMultiSessionRows(records) {
  if (!multiSessionRows) return;
  if (!records.length) {
    multiSessionRows.innerHTML = '<tr class="multi-session-empty"><td colspan="9">No tasks yet. Spawn some above.</td></tr>';
    return;
  }
  const now = Date.now() / 1000;
  multiSessionRows.innerHTML = records
    .map((rec) => {
      const ageOrDuration = formatAgeOrDuration(rec, now);
      const podOrJob = rec.pod_name || rec.job_name || '—';
      const statusClass = `status-${(rec.status || 'unknown').toLowerCase()}`;
      const agentLabel = rec.agent_id ? rec.agent_id : 'ephemeral';
      // Don't show a Delete button for already-terminal rows — it works
      // (returns 404 if the backend GC'd it), but adds noise.
      const canDelete = !TERMINAL_STATUSES.has(rec.status);
      const deleteBtn = canDelete
        ? `<button class="ghost small multi-session-del" data-session-id="${escapeHtml(rec.session_id)}" type="button">Delete</button>`
        : '';
      return `
        <tr>
          <td><code>${escapeHtml(rec.session_id)}</code></td>
          <td>${escapeHtml(rec.scenario || '—')}</td>
          <td>${escapeHtml(rec.profile || '—')}</td>
          <td>${escapeHtml(formatTargetSystem(rec))}</td>
          <td>${rec.agent_id ? `<code>${escapeHtml(agentLabel)}</code>` : `<span class="agent-cell-ephemeral">${escapeHtml(agentLabel)}</span>`}</td>
          <td><span class="session-status ${statusClass}">${escapeHtml(rec.status || '—')}</span></td>
          <td><code>${escapeHtml(podOrJob)}</code></td>
          <td>${escapeHtml(ageOrDuration)}</td>
          <td>${deleteBtn}</td>
        </tr>
      `;
    })
    .join('');
}

function renderMultiSessionSummary(records, backend) {
  if (!multiSessionSummary) return;
  if (!records.length) {
    multiSessionSummary.hidden = true;
    return;
  }
  const counts = {};
  records.forEach((r) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  const parts = Object.entries(counts).map(
    ([status, n]) => `<span class="status-pill status-${status.toLowerCase()}">${escapeHtml(status)}: ${n}</span>`
  );
  multiSessionSummary.innerHTML = `
    <span class="multi-session-summary-label">Backend: <code>${escapeHtml(backend || 'unknown')}</code></span>
    <span class="multi-session-summary-label">Tracked: ${records.length}</span>
    ${parts.join('')}
  `;
  multiSessionSummary.hidden = false;
}

async function refreshMultiSession() {
  if (multiSessionPolling) return; // Avoid overlap if a poll is in flight.
  multiSessionPolling = true;
  try {
    const body = await fetchJson(`${API_BASE}/sessions`, { timeoutMs: 5000 });
    const all = Array.isArray(body && body.sessions) ? body.sessions : [];
    if (multiSessionBackend) {
      multiSessionBackend.textContent = `backend: ${body.backend || 'unknown'}`;
    }
    // Filter to sessions this tab tracks. The flag (not the set's
    // current size) gates this: once a tab has spawned anything, it
    // stays in "show only mine" mode even after Clear list, otherwise a
    // shared demo would re-show every other viewer's sessions on the
    // very next refresh.
    const records = hasSpawnedHere
      ? all.filter((r) => trackedSessionIds.has(r.session_id))
      : all;
    renderMultiSessionRows(records);
    renderMultiSessionSummary(records, body.backend);

    // Mirror the session list into the System A agent pool so the operator
    // sees rows + capacity bar move when fan-out spawns Jobs. Always filter
    // by trackedSessionIds — `records` is the *table*'s view, which falls
    // back to "all sessions" when this tab has never spawned (so a fresh
    // viewer can see the shared backend at a glance). The pool/capacity bar
    // must stay strictly per-tab so other viewers' Jobs don't inflate
    // capacity for someone who hasn't spawned anything yet.
    lastSessionRecords = records.filter((r) => trackedSessionIds.has(r.session_id));
    redrawSystemA();
    redrawSystemB();

    // Slow polling once everything settles; speed back up when a new
    // batch is in flight.
    const anyPending = records.some((r) => !TERMINAL_STATUSES.has(r.status));
    scheduleMultiSessionPoll(anyPending ? 1000 : 5000);
  } catch (err) {
    // 404 on /api/sessions means there's no control-plane behind the page
    // (Tier 0 static-only deployment — python http.server, plain nginx,
    // CDN). That's expected, not a failure: report it neutrally and back
    // off polling. Any other error stays loud so a real outage is visible.
    const noBackend = err && err.status === 404;
    if (multiSessionBackend) {
      multiSessionBackend.textContent = noBackend ? 'backend: not detected' : 'backend: unreachable';
    }
    if (noBackend) {
      setMultiSessionStatus(
        'Control plane not reachable — session lifecycle is unavailable.',
        'warn'
      );
      renderMultiSessionRows([]);
      renderMultiSessionSummary([], null);
      scheduleMultiSessionPoll(15000);
    } else {
      setMultiSessionStatus(`Session list fetch failed: ${err.message}`, 'error');
      scheduleMultiSessionPoll(5000);
    }
  } finally {
    multiSessionPolling = false;
  }
}

function scheduleMultiSessionPoll(ms) {
  if (multiSessionPollTimer) clearTimeout(multiSessionPollTimer);
  multiSessionPollTimer = setTimeout(() => {
    multiSessionPollTimer = null;
    refreshMultiSession();
  }, ms);
}

async function spawnSessionBatch(scenario, profile, count, targetSystem, agentId) {
  // targetSystem is the form's raw value: '' = "scenario default" (omit
  // from the wire payload so the server records null) or 'system_a' /
  // 'system_b'. agentId is similarly optional: '' = ephemeral (today's
  // behavior), otherwise pin every spawned task to that registered
  // agent. The status line shows both explicit choices so the operator
  // sees what they're about to submit.
  const targetLabel = targetSystem ? ` → ${targetSystem}` : '';
  const agentLabel = agentId ? ` @ ${agentId}` : '';
  setMultiSessionStatus(
    `Submitting ${count} × ${scenario} (${profile})${targetLabel}${agentLabel}…`,
    'pending'
  );
  multiSessionSpawn.disabled = true;
  const originalLabel = multiSessionSpawn.textContent;
  multiSessionSpawn.textContent = 'Submitting…';
  try {
    const payload = { scenario, profile, count };
    if (targetSystem) payload.target_system = targetSystem;
    if (agentId) payload.agent_id = agentId;
    const body = await fetchJson(`${API_BASE}/sessions/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 30_000,
    });
    const created = Array.isArray(body && body.sessions) ? body.sessions : [];
    created.forEach((rec) => trackedSessionIds.add(rec.session_id));
    if (created.length) hasSpawnedHere = true;
    const errored = body && body.by_status && body.by_status._error;
    if (errored) {
      // Backend now serializes the failure reason on `body.error` so the
      // user doesn't have to dig through server logs to find out why the
      // batch was partial. Fall back to the older "see server logs" text
      // when the field isn't present (older control-plane build).
      const reason = body && body.error ? `: ${body.error}` : '. See server logs.';
      setMultiSessionStatus(
        `Spawned ${created.length} (partial — backend bailed before reaching ${count})${reason}`,
        'warn'
      );
    } else {
      setMultiSessionStatus(
        `Spawned ${created.length} session${created.length === 1 ? '' : 's'} on backend "${body.backend}".`,
        'ok'
      );
    }
    refreshMultiSession();
  } catch (err) {
    setMultiSessionStatus(`Spawn failed: ${err.message}`, 'error');
  } finally {
    multiSessionSpawn.disabled = false;
    multiSessionSpawn.textContent = originalLabel;
  }
}

if (multiSessionForm) {
  multiSessionForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const scenario = multiSessionScenario.value;
    const profile = multiSessionProfile.value;
    const targetSystem = multiSessionTarget ? multiSessionTarget.value : '';
    const agentId = multiSessionAgent ? multiSessionAgent.value : '';
    const count = Math.max(1, Math.min(50, parseInt(multiSessionCount.value, 10) || 1));
    spawnSessionBatch(scenario, profile, count, targetSystem, agentId);
  });
}

if (multiSessionRefresh) {
  multiSessionRefresh.addEventListener('click', () => refreshMultiSession());
}

if (multiSessionClear) {
  multiSessionClear.addEventListener('click', async () => {
    // Issue DELETEs for everything we currently track. Errors are
    // tolerated — the backend may have already GC'd a finished session,
    // and a 404 is a successful no-op from the user's perspective.
    const ids = Array.from(trackedSessionIds);
    setMultiSessionStatus(`Deleting ${ids.length} tracked session${ids.length === 1 ? '' : 's'}…`, 'pending');
    await Promise.allSettled(
      ids.map((sid) =>
        fetchJson(`${API_BASE}/sessions/${encodeURIComponent(sid)}`, {
          method: 'DELETE',
          timeoutMs: 5000,
        }).catch(() => null)
      )
    );
    trackedSessionIds.clear();
    setMultiSessionStatus('Tracked sessions cleared.', 'ok');
    refreshMultiSession();
  });
}

if (multiSessionRows) {
  // Event-delegation so per-row Delete buttons don't need to be rebound
  // on every render.
  multiSessionRows.addEventListener('click', async (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('multi-session-del')) return;
    const sid = target.dataset.sessionId;
    if (!sid) return;
    target.disabled = true;
    target.textContent = 'Deleting…';
    try {
      await fetchJson(`${API_BASE}/sessions/${encodeURIComponent(sid)}`, {
        method: 'DELETE',
        timeoutMs: 5000,
      });
      trackedSessionIds.delete(sid);
      refreshMultiSession();
    } catch (err) {
      setMultiSessionStatus(`Delete ${sid} failed: ${err.message}`, 'error');
      target.disabled = false;
      target.textContent = 'Delete';
    }
  });
}

// Kick off the poll loop. refreshMultiSession() schedules the next tick,
// so we don't need a setInterval here.
if (multiSessionPanel) {
  refreshMultiSession();
}

// ---------- Agents panel (long-lived) ----------
//
// Read-only view over /api/agents. Renders a per-system pool with status
// dots and powers the "Agent" picker on the Tasks form. Polled on a slow
// timer (30s) — agents are long-lived, so high-frequency polling is
// wasted bandwidth. Picker is rebuilt on every poll so freshly added
// agents (operator runs an OpenClawInstance smoke test, the registry
// picks it up) become selectable without a page reload.

const agentsPanel = document.getElementById('agents-panel');
const agentsPoolA = document.getElementById('agents-pool-system_a');
const agentsPoolB = document.getElementById('agents-pool-system_b');
const agentsSummary = document.getElementById('agents-summary');
const agentsRefresh = document.getElementById('agents-refresh');

const AGENT_STATUS_CLASS = {
  Ready: 'ok',
  Provisioning: 'warn',
  Degraded: 'warn',
  Stopped: 'error',
  Unknown: ''
};

function renderAgentRow(agent) {
  const dotClass = AGENT_STATUS_CLASS[agent.status] || '';
  const cap = (agent.capabilities || []).join(', ') || '—';
  const msg = agent.message ? ` · ${escapeHtml(agent.message)}` : '';
  return `
    <div class="agent-card" data-agent-id="${escapeHtml(agent.id)}" data-status="${escapeHtml(agent.status)}">
      <div class="agent-card-head">
        <span class="agent-status-dot ${dotClass}" title="${escapeHtml(agent.status)} (${escapeHtml(agent.source)})"></span>
        <span class="agent-card-name">${escapeHtml(agent.name)}</span>
        <span class="agent-card-kind">${escapeHtml(agent.kind)}</span>
      </div>
      <div class="agent-card-meta">
        <code>${escapeHtml(agent.id)}</code>
        <span class="agent-card-caps">${escapeHtml(cap)}</span>
      </div>
      <div class="agent-card-status">${escapeHtml(agent.status)}${msg}</div>
    </div>
  `;
}

function renderAgentPool(el, agents) {
  if (!el) return;
  if (!agents.length) {
    el.innerHTML = '<div class="agents-pool-empty">no agents registered</div>';
    return;
  }
  el.innerHTML = agents.map(renderAgentRow).join('');
}

// Refill the Tasks-form Agent picker. Preserve the current selection if
// the picked agent is still registered; otherwise fall back to "ephemeral".
function refreshAgentPicker(agents) {
  if (!multiSessionAgent) return;
  const current = multiSessionAgent.value;
  const opts = ['<option value="">ephemeral (no agent)</option>'];
  agents.forEach((a) => {
    const sysShort = a.system === 'system_a' ? 'A' : a.system === 'system_b' ? 'B' : a.system;
    const label = `${a.id} — ${a.kind} on Sys ${sysShort} (${a.status})`;
    opts.push(
      `<option value="${escapeHtml(a.id)}"${current === a.id ? ' selected' : ''}>${escapeHtml(label)}</option>`
    );
  });
  multiSessionAgent.innerHTML = opts.join('');
  if (!agents.some((a) => a.id === current)) {
    multiSessionAgent.value = '';
  }
}

let agentsPollTimer = null;
// Monotonic sequence guard. The Refresh button + the 30s timer can
// race when the backend is slow: an earlier in-flight request may
// resolve AFTER a newer one and overwrite a fresh successful render
// with stale rows or stale "fetch failed" copy. Each call captures its
// own seq before the await; only the latest gets to mutate UI state.
let agentsRefreshSeq = 0;

async function refreshAgents() {
  const seq = ++agentsRefreshSeq;
  try {
    const body = await fetchJson(`${API_BASE}/agents`, { timeoutMs: 5000 });
    if (seq !== agentsRefreshSeq) return;
    const agents = Array.isArray(body && body.agents) ? body.agents : [];
    const a = agents.filter((x) => x.system === 'system_a');
    const b = agents.filter((x) => x.system === 'system_b');
    renderAgentPool(agentsPoolA, a);
    renderAgentPool(agentsPoolB, b);
    refreshAgentPicker(agents);
    if (agentsSummary) {
      const ready = agents.filter((x) => x.status === 'Ready').length;
      agentsSummary.textContent = agents.length
        ? `agents: ${agents.length} (${ready} Ready)`
        : 'agents: none registered';
    }
  } catch (err) {
    if (seq !== agentsRefreshSeq) return;
    if (agentsSummary) {
      const noBackend = err && err.status === 404;
      agentsSummary.textContent = noBackend
        ? 'agents: backend not detected'
        : `agents: fetch failed (${err.message})`;
    }
    renderAgentPool(agentsPoolA, []);
    renderAgentPool(agentsPoolB, []);
    // Drop any options the picker carried over from the last
    // successful poll so the operator can't submit a task pinned to
    // an agent the backend may already have removed. The empty-list
    // call collapses the picker back to the "ephemeral" option only.
    refreshAgentPicker([]);
  } finally {
    // Only the latest call schedules the next tick; earlier calls
    // returning here after a newer one started must not stack timers
    // (would compound into multiple polls per cycle).
    if (seq === agentsRefreshSeq) {
      if (agentsPollTimer) clearTimeout(agentsPollTimer);
      agentsPollTimer = setTimeout(refreshAgents, 30_000);
    }
  }
}

if (agentsRefresh) {
  agentsRefresh.addEventListener('click', () => refreshAgents());
}

if (agentsPanel) {
  refreshAgents();
}

// ---------- Optional service launchers ----------
//
// Three layers of "off":
//   1. compose `profiles: [authoring]` — Flowise / OpenWebUI not started
//   2. probeService() auto-hides any card whose service doesn't respond
//   3. user clicks "Hide panel" (persists to localStorage) or appends
//      ?services=off to the URL for a single demo session
//
// Operators can override URLs by editing this list directly or by setting
// the `demoServices` localStorage key to a JSON array of {id,name,url,...}.
const DEFAULT_SERVICES = [
  {
    id: 'minio',
    name: 'MinIO console',
    sub: 'artifact bucket',
    url: 'http://127.0.0.1:9001/',
    tag: 'tier 1',
    tagClass: ''
  },
  {
    id: 'flowise',
    name: 'Flowise',
    sub: 'visual scenario authoring',
    url: 'http://127.0.0.1:3000/',
    tag: 'authoring profile',
    tagClass: 'optional'
  },
  {
    id: 'litellm',
    name: 'LiteLLM admin',
    sub: 'model routing dashboard',
    url: 'http://127.0.0.1:4000/ui/',
    tag: 'tier 2',
    tagClass: ''
  },
  {
    id: 'open-webui',
    name: 'OpenWebUI',
    sub: 'direct chat with the local SLM',
    url: 'http://127.0.0.1:3030/',
    tag: 'authoring profile',
    tagClass: 'optional'
  }
];

const SERVICES_HIDE_KEY = 'demoServicesHidden';
const SERVICES_OVERRIDE_KEY = 'demoServices';

function getConfiguredServices() {
  try {
    const raw = localStorage.getItem(SERVICES_OVERRIDE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (_) { /* fall through to default */ }
  return DEFAULT_SERVICES;
}

function isServicesPanelHidden() {
  if (new URLSearchParams(window.location.search).get('services') === 'off') return true;
  try {
    return localStorage.getItem(SERVICES_HIDE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

async function probeService(url) {
  // Cross-origin services rarely send CORS headers; use no-cors and treat
  // any fulfilled fetch (even an opaque response) as "reachable". A network
  // failure rejects, which we treat as "down".
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function renderServiceCard(svc, reachable) {
  const card = document.createElement('div');
  card.className = 'service-card' + (reachable ? '' : ' service-card-down');
  card.setAttribute('role', 'listitem');
  card.dataset.service = svc.id;

  const head = document.createElement('div');
  head.className = 'service-card-head';
  const dot = document.createElement('span');
  dot.className = 'dot ' + (reachable ? 'ok' : 'down');
  const title = document.createElement('span');
  title.className = 'service-card-title';
  title.textContent = svc.name;
  head.append(dot, title);

  if (svc.tag) {
    const tag = document.createElement('span');
    tag.className = 'service-card-tag' + (svc.tagClass ? ' ' + svc.tagClass : '');
    tag.textContent = svc.tag;
    head.append(tag);
  }

  const sub = document.createElement('div');
  sub.className = 'service-card-sub';
  sub.textContent = svc.sub || '';

  const link = document.createElement('a');
  link.className = 'service-card-link';
  link.href = svc.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = reachable ? 'Open ↗' : 'Not reachable';
  if (!reachable) {
    link.setAttribute('aria-disabled', 'true');
    link.tabIndex = -1;
  }

  card.append(head, sub, link);
  return card;
}

async function renderServiceLaunchers() {
  const panel = document.getElementById('services-panel');
  const grid = document.getElementById('services-grid');
  const empty = document.getElementById('services-empty');
  const hideBtn = document.getElementById('services-hide');
  if (!panel || !grid) return;

  if (isServicesPanelHidden()) {
    panel.hidden = true;
    return;
  }

  if (hideBtn && !hideBtn.dataset.bound) {
    hideBtn.addEventListener('click', () => {
      try { localStorage.setItem(SERVICES_HIDE_KEY, '1'); } catch (_) {}
      panel.hidden = true;
    });
    hideBtn.dataset.bound = '1';
  }

  const services = getConfiguredServices();
  const probes = await Promise.all(services.map((s) => probeService(s.url)));
  const visible = services.filter((_, i) => probes[i]);

  grid.innerHTML = '';
  if (visible.length === 0) {
    panel.hidden = false;
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (let i = 0; i < services.length; i += 1) {
    if (probes[i]) grid.append(renderServiceCard(services[i], true));
  }
  panel.hidden = false;
}

// Reset clears the "hide panel" preference so a fresh demo run shows it again.
const resetBtn = document.querySelector('[data-action="reset"]');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    try { localStorage.removeItem(SERVICES_HIDE_KEY); } catch (_) {}
    renderServiceLaunchers();
  });
}

renderServiceLaunchers();
setInterval(renderServiceLaunchers, 30_000);
