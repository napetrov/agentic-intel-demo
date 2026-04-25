const SYSTEM_A_TOTAL_VCPU = 512;
const SYSTEM_B_TOTAL_VCPU = 100;

const scenarios = {
  'terminal-agent': {
    orchestrationActive: ['openclaw', 'litellm', 'sambanova'],
    primary: { name: 'Terminal agent', vcpu: 128 },
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
      'placement': 'System A — 128/512 vCPU',
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
    commandLog: `$ openclaw demo run terminal-agent --isolated\nrequest accepted\nsession_id=demo-term-0420 sandbox=created profile=engineering\n\n$ sed -n '1,40p' agents/scenarios/terminal-agent/terminal-bench-reference.md\n# Terminal Agent Demo — Reference Task Spec\n### Name\nrepo-structure-audit-and-fixup\n### Objective\nInspect the repo and produce a structured scenario/task inventory.\n\n$ ./scripts/session-bootstrap.sh --scenario terminal-agent\n[bootstrap] workspace mounted at /workspace-intel-dev/agentic-intel-demo\n[bootstrap] tools registered: exec, read, summarize\n[bootstrap] isolated temp dir: /tmp/demo-term-0420\n[check] demo-workspace/BOOTSTRAP.md loaded\n[check] scenario prompt loaded\n\n$ ./scripts/route-task.sh --scenario terminal-agent\n[classifier] workload=interactive engineering\n[inference] provider=litellm/sambanova\n[executor] target=system-a\n[decision] use primary CWF path\n\n$ git status --short\n M web-demo/app.js\n M web-demo/index.html\n M web-demo/styles.css\n\n$ ./scripts/smoke-test-operator-instance.sh --profile terminal-agent\n[step] validating shell access\n[step] validating repo context\n[step] validating writable artifact dir\n[ok] shell access confirmed\n[ok] repo context confirmed\n[ok] artifact dir ready\n\n$ ./scripts/demo-terminal-workflow.sh --emit-trace\n[1/6] inspect workspace layout\n[2/6] read task brief\n[3/6] run command batch\n[4/6] collect stdout/stderr\n[5/6] package artifacts\n[6/6] render operator summary\nworkflow complete`,
    timeline: [
      ['Task received', 'OpenClaw accepts the request; System A reserves a 128 vCPU slice of the pool.'],
      ['Workspace prepared', 'Session pod mounted on System A. Tools registered: exec, read, summarize.'],
      ['Command running', 'Terminal workflow executes directly on System A; no offload needed.'],
      ['Command completed', 'Command batch finishes; artifacts collected in the local session pod.'],
      ['Answer generated', 'Engineering summary delivered; capacity returned to the pool.']
    ],
    result: `Terminal Agent\n\nSystem A spawns one 128 vCPU agent (¼ of the pool).\nLiteLLM routes inference to SambaNova.\nSystem B services stay idle — no offload needed.\n\nUser-visible outcome:\n- engineering summary\n- live route narrative\n- command evidence`
  },
  'market-research': {
    orchestrationActive: ['openclaw', 'litellm', 'sambanova'],
    primary: { name: 'Market Research agent', vcpu: 128 },
    subagent: { name: 'pandas subagent (spawned by MR)', vcpu: 25, spawnDelayMs: 2400 },
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
      'placement': 'System A 128/512 + System B 25/100 (subagent)',
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
    commandLog: `$ openclaw demo run market-research --isolated\nrequest accepted\nsession_id=demo-research-0420 sandbox=created profile=research\n\n$ sed -n '1,40p' agents/scenarios/market-research/report-task.md\n# Market Research Demo Task\nObjective: recommend which SMB segment to target first for an AI meeting notes product.\nInputs: synthetic repo data under demo-inputs/market-research/.\n\n$ ./scripts/session-bootstrap.sh --scenario market-research\n[bootstrap] workspace mounted\n[bootstrap] retrieval cache ready (eRAG)\n[bootstrap] summarize tool ready\n[check] research prompt loaded\n\n$ ./scripts/route-task.sh --scenario market-research\n[classifier] workload=research synthesis\n[inference] provider=litellm/sambanova\n[executor] primary=system-a\n[executor] subagent=system-b (pandas analytics)\n[decision] spawn cross-system subagent for offload analytics\n\n$ ./scripts/research-brief.sh --topic market-map --emit-sources\n[1/5] normalize request\n[2/5] gather source snippets via eRAG\n[3/5] dispatch pandas subagent to System B\n[4/5] synthesize summary\n[5/5] assemble brief\nbrief complete`,
    timeline: [
      ['Input accepted', 'OpenClaw accepts the scenario; MR agent takes 128 vCPU on System A.'],
      ['Subagent spawned', 'MR agent dispatches a 25 vCPU pandas subagent to System B; eRAG activates for retrieval.'],
      ['Analytics offload', 'pandas subagent crunches data on System B while MR continues on A.'],
      ['Synthesis', 'SambaNova via LiteLLM summarizes the combined findings.'],
      ['Result ready', 'Research brief delivered; subagent and eRAG wind down.']
    ],
    result: `Market Research\n\nSystem A spawns one 128 vCPU agent (¼ of the pool).\nThe MR agent spawns a 25 vCPU pandas subagent on System B for analytics offload.\neRAG service activates for retrieval; Enterprise Inference stays idle.\n\nUser-visible outcome:\n- market snapshot\n- risks and opportunities\n- why this route was chosen`
  },
  'large-build-test': {
    orchestrationActive: ['openclaw', 'litellm', 'sambanova', 'ent-inference-route'],
    primary: { name: 'Build/Test', vcpu: 512 },
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
      'placement': 'System A 512/512 (pool full)',
      'artifact view': 'build/test summary'
    },
    metrics: {
      Elapsed: '26.7s',
      Tokens: '4,960',
      Model: 'SambaNova + Ent. Inference SLM',
      Route: 'OpenClaw → System A (full)',
      Tools: 'exec, read, summarize',
      Artifacts: '3'
    },
    commandLog: `$ openclaw demo run large-build-test --burst\nrequest accepted\nsession_id=demo-build-0420 profile=burst workload=heavy\n\n$ sed -n '1,40p' agents/scenarios/large-build-test/build-task.md\n# Large Build/Test Demo Task\nObjective: run a larger build/test workflow with explicit large-profile framing and concrete evidence.\n\n$ ./scripts/session-bootstrap.sh --scenario large-build-test\n[bootstrap] heavy profile enabled\n[bootstrap] artifact dir prepared\n[bootstrap] summary writer ready\n\n$ ./scripts/queue-reserve.sh --profile large-build\nqueue slot reserved\nprimary lane=system-a (512 vCPU — pool fully reserved)\ninference routes=SambaNova,Ent.Inference SLM\n\n$ ./scripts/route-task.sh --scenario large-build-test\n[classifier] workload=heavy build/test\n[inference] primary=litellm/sambanova\n[inference] alternate=ent. inference SLM\n[executor] placement=system-a (full pool)\n\n$ ./scripts/run-large-build-test.sh --emit-artifacts\n[1/5] load build graph\n[2/5] reserve compile lane\n[3/5] run compile on system-a (full pool)\n[4/5] summarize via SambaNova; fall back to SLM where needed\n[5/5] assemble build/test package\nflow complete`,
    timeline: [
      ['Input accepted', 'OpenClaw accepts the heavy workload; System A reserves the full 512 vCPU pool.'],
      ['Orchestration', 'Build/test classified as large profile; Enterprise Inference SLM route lights up.'],
      ['Compile + test', 'Compile runs on System A (pool full); LiteLLM splits inference between SambaNova and SLM.'],
      ['Results assembled', 'Artifacts bundled and summary drafted.'],
      ['Result ready', 'Build/test status and route decision delivered; pool releases back to idle.']
    ],
    result: `Large Build/Test\n\nSystem A spawns one agent that takes the entire 512 vCPU pool.\nLiteLLM lights the Enterprise Inference SLM route alongside SambaNova.\nNo subagent spawn — the heavy work fits on A.\n\nUser-visible outcome:\n- execution status\n- route decision\n- result summary`
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
let runTimers = [];
const originalRunLabel = runDemoBtn.textContent;

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
      <span class="agent-name">${name}</span>
      <span class="agent-cpu">${vcpu} vCPU</span>
      <span class="agent-status">${label}</span>
    </div>
  `;
}

function renderSystemA(scenario, phase) {
  if (!scenario || phase === 'idle') {
    sysAAgentsEl.innerHTML = '<div class="agent-row-empty">agents: (idle — select a scenario)</div>';
    renderCapacity(0);
    return;
  }
  const { primary } = scenario;
  const state = phase === 'running' ? 'running' : 'planned';
  sysAAgentsEl.innerHTML = agentRowHtml(primary.name, primary.vcpu, state);
  renderCapacity(state === 'running' ? primary.vcpu : 0);
}

function renderOffload(scenario, phase, includeSubagent) {
  if (!scenario || !scenario.subagent || phase === 'idle') {
    sysBOffloadEl.innerHTML = '<div class="agent-row-empty">no offloaded workers</div>';
    renderCapacityB(0);
    return;
  }
  if (!includeSubagent) {
    sysBOffloadEl.innerHTML = '<div class="agent-row-empty">no offloaded workers (yet)</div>';
    renderCapacityB(0);
    return;
  }
  const { subagent } = scenario;
  const state = phase === 'running' ? 'running' : 'planned';
  sysBOffloadEl.innerHTML = agentRowHtml(subagent.name, subagent.vcpu, state);
  renderCapacityB(state === 'running' ? subagent.vcpu : 0);
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
  toolActivityEl.innerHTML = rows.map((row) => `
    <div class="tool-row${row.empty ? ' empty' : ''}">
      ${row.empty ? row.label : `<span class="tool-name">${row.name}</span><span class="tool-status">${row.status}</span>`}
    </div>
  `).join('');
}

function renderMetrics(entries) {
  metricsEl.innerHTML = Object.entries(entries).map(([k, v]) => `
    <div class="metric-card"><span class="metric-label">${k}</span><span class="metric-value">${v}</span></div>
  `).join('');
}

function applyIdle() {
  cancelRun();
  currentScenario = null;
  setDataMode('');
  setOrchestrationActive([]);
  setServiceState({});
  renderSystemA(null, 'idle');
  renderOffload(null, 'idle', false);
  setCrossArrow(false);
  renderToolActivity([{ empty: true, label: 'Select a scenario to view expected tool usage.' }]);
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
  setDataMode(`Scenario: ${key}`);
  setOrchestrationActive(scenario.orchestrationActive);
  setServiceState({});
  renderSystemA(scenario, 'planned');
  renderOffload(scenario, 'planned', false);
  setCrossArrow(false);
  renderToolActivity([
    { name: 'read', status: 'planned' },
    { name: 'exec', status: key === 'market-research' ? 'optional' : 'planned' },
    { name: 'summarize', status: 'planned' }
  ]);
  commandLogEl.textContent = scenario.commandLog;
  renderMetrics(scenario.metrics);
  result.textContent = scenario.result;
  result.className = 'result';
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
  setDataMode('Live status');
  setOrchestrationActive(['openclaw', 'litellm', 'sambanova', 'ent-inference-route']);
  setServiceState({ erag: true, 'ent-inference': true });
  renderSystemA(null, 'idle');
  renderOffload(null, 'idle', false);
  setCrossArrow(false);
  renderToolActivity([
    { name: 'status probe', status: 'active' },
    { name: 'routing check', status: 'active' }
  ]);
  commandLogEl.textContent = 'Status mode shows stack availability only. It does not prove a real task execution happened.';
  renderMetrics({
    Model: 'LiteLLM → SambaNova / Ent. Inference',
    Route: 'stack overview',
    Tools: 'status probes',
    Artifacts: '0'
  });
  result.textContent = 'Live architecture status for the demo stack.';
  result.className = 'result';
  renderConsole({
    mode: 'live status',
    'openclaw version': '2026.4.15',
    orchestrator: 'OpenClaw',
    'orchestration alt': 'Flowise (optional)',
    'litellm gateway': 'litellm/sambanova primary',
    'litellm endpoint': 'port 4000 /v1',
    'sambanova model': 'DeepSeek-V3.1',
    'enterprise inference': 'reachable',
    'model route': 'LiteLLM → SambaNova / Ent. Inference',
    'session scope': 'isolated per user',
    'placement': 'stack overview',
    'artifact view': 'status only'
  });
});

document.querySelector('[data-action="reset"]').addEventListener('click', () => {
  applyIdle();
});

function buildWalkthroughPhases(scenario) {
  const lines = (scenario.commandLog || '').split('\n');
  const toolNames = (scenario.metrics.Tools || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const timeline = (scenario.timeline && scenario.timeline.length)
    ? scenario.timeline
    : [['Walkthrough', 'Scenario replay']];
  const phaseCount = timeline.length;
  const chunkSize = Math.ceil(lines.length / phaseCount);
  const parsedArtifacts = Number(scenario.metrics.Artifacts);
  const artifactTotal = Number.isFinite(parsedArtifacts) ? parsedArtifacts : phaseCount;

  return timeline.map((entry, idx) => {
    const chunk = lines.slice(idx * chunkSize, (idx + 1) * chunkSize).join('\n');
    const tools = toolNames.map((name, toolIdx) => {
      let status = 'queued';
      const progress = idx / Math.max(1, phaseCount - 1);
      const toolProgress = toolIdx / Math.max(1, toolNames.length - 1);
      if (progress >= toolProgress) status = 'active';
      if (progress > toolProgress + 1 / Math.max(1, toolNames.length)) status = 'done';
      if (idx === phaseCount - 1 && toolIdx < toolNames.length - 1) status = 'done';
      return { name, status };
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
  result.textContent = `Walkthrough: ${scenario.result.split('\n')[0]}`;
  result.className = 'result';

  phases.forEach((phase, idx) => {
    runTimers.push(setTimeout(() => {
      commandLogEl.textContent += (commandLogEl.textContent ? '\n' : '') + phase.chunk;
      commandLogEl.scrollTop = commandLogEl.scrollHeight;
      renderToolActivity(phase.tools.length ? phase.tools : [{ empty: true, label: phase.detail }]);
      renderMetrics({
        Model: model,
        Route: `${route} · ${phase.label}`,
        Tools: phase.tools.map((tool) => tool.name).join(', ') || '—',
        Artifacts: phase.artifacts
      });
      if (idx === subagentPhaseIdx) {
        applyRunning(scenarioKey, { includeSubagentNow: true });
      }
    }, idx * phaseDurationMs));
  });

  const totalDuration = phases.length * phaseDurationMs;
  runTimers.push(setTimeout(() => {
    result.textContent = scenario.result;
    renderToolActivity([
      { name: 'read', status: 'done' },
      { name: scenarioKey === 'market-research' ? 'pandas (subagent on B)' : 'exec', status: 'done' },
      { name: 'summarize', status: 'done' }
    ]);
    restoreRunButton();
  }, totalDuration));
}

let liveRunId = 0;

async function runLiveWalkthrough(scenarioKey) {
  const scenario = scenarios[scenarioKey];
  if (!scenario) return;
  const myRunId = ++liveRunId;
  const sessionId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const route = scenario.metrics.Route || (scenario.console && scenario.console.placement) || '—';
  const model = scenario.metrics.Model || '—';

  applyRunning(scenarioKey, { includeSubagentNow: false });

  commandLogEl.textContent = `$ POST /api/offload {task_type:"shell", scenario:"${scenarioKey}"}\n`;
  result.textContent = `Live run: ${scenarioKey}`;
  result.className = 'result';
  renderToolActivity([{ name: 'offload submit', status: 'active' }]);
  renderMetrics({
    Model: model,
    Route: `${route} · submitting`,
    Tools: 'offload submit',
    Artifacts: '0'
  });

  const stillCurrent = () => myRunId === liveRunId;
  const finish = () => { if (stillCurrent()) restoreRunButton(); };

  let submit;
  try {
    submit = await fetchJson(`${API_BASE}/offload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_type: 'shell',
        payload: { scenario: scenarioKey },
        session_id: sessionId
      })
    });
  } catch (err) {
    if (!stillCurrent()) return;
    commandLogEl.textContent += `\n[error] submit failed: ${err.message}`;
    result.textContent = `Live run failed: ${err.message}`;
    finish();
    return;
  }
  if (!stillCurrent()) return;

  commandLogEl.textContent += `job_id=${submit.job_id} status=${submit.status}\n`;
  renderToolActivity([{ name: 'offload poll', status: 'active' }]);
  renderMetrics({
    Model: model,
    Route: `${route} · ${submit.status}`,
    Tools: 'offload poll',
    Artifacts: '0'
  });

  // Poll until terminal. The control-plane forwards synchronously so the
  // first GET typically already returns "completed" — the poll is here so we
  // stay correct if the relay ever switches to async.
  const deadline = Date.now() + 90_000;
  let status = null;
  while (Date.now() < deadline) {
    try {
      status = await fetchJson(`${API_BASE}/offload/${submit.job_id}`);
    } catch (err) {
      if (!stillCurrent()) return;
      commandLogEl.textContent += `\n[error] poll failed: ${err.message}`;
      finish();
      return;
    }
    if (!stillCurrent()) return;
    if (status.status === 'completed' || status.status === 'error') break;
    await sleep(500);
  }

  if (!status || (status.status !== 'completed' && status.status !== 'error')) {
    commandLogEl.textContent += `\n[error] job did not complete within 90s`;
    finish();
    return;
  }

  if (status.status === 'error') {
    commandLogEl.textContent += `\n[worker error] ${status.error || 'unknown error'}`;
    result.textContent = `Live run errored: ${status.error || 'see log'}`;
    finish();
    return;
  }

  const inline = status.result;
  const stdout = (inline && typeof inline === 'object' && 'stdout' in inline)
    ? inline.stdout
    : (status.result_ref
      ? `[result stored as artifact ${status.result_ref}]`
      : JSON.stringify(inline, null, 2));
  const exitCode = (inline && typeof inline === 'object' && 'exit_code' in inline)
    ? inline.exit_code
    : null;

  // Treat null exit_code as success when the result was punted to MinIO
  // (artifact-backed completion). Only an explicit non-zero exit_code is a
  // failure. status==="completed" already implies the worker reported ok.
  const shellSucceeded = exitCode === null || exitCode === 0;

  commandLogEl.textContent += `\n--- worker stdout ---\n${stdout}`;
  if (exitCode !== null) {
    commandLogEl.textContent += `\n--- exit_code=${exitCode} ---`;
  }
  commandLogEl.scrollTop = commandLogEl.scrollHeight;

  const elapsedMs = (status.completed_at && status.submitted_at)
    ? Math.max(0, (status.completed_at - status.submitted_at) * 1000)
    : null;
  renderToolActivity([
    { name: 'offload submit', status: 'done' },
    { name: 'offload poll', status: 'done' },
    { name: 'shell exec', status: shellSucceeded ? 'done' : 'error' }
  ]);
  renderMetrics({
    Model: model,
    Route: `${route} · live`,
    Tools: 'shell',
    Artifacts: status.result_ref ? '1' : '0',
    Elapsed: elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(2)}s` : '—',
    'Job ID': submit.job_id
  });
  result.textContent = shellSucceeded
    ? `Live run complete (exit ${exitCode === null ? 'n/a' : '0'}). job_id=${submit.job_id}`
    : `Live run finished with exit_code=${exitCode}. job_id=${submit.job_id}`;
  finish();
}

runDemoBtn.addEventListener('click', () => {
  const scenarioKey = currentScenario || 'terminal-agent';
  if (!currentScenario) applyPlanned(scenarioKey);
  const scenario = scenarios[scenarioKey];
  if (!scenario) return;

  clearRunTimers();
  liveRunId += 1;
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
const agentSubmitOriginalLabel = agentSubmit ? agentSubmit.textContent : 'Run agent command';

function setAgentStatus(text, kind) {
  if (!agentStatusEl) return;
  agentStatusEl.textContent = text || '';
  agentStatusEl.dataset.kind = kind || '';
}

function appendAgentLog(text) {
  if (!commandLogEl) return;
  commandLogEl.textContent += (commandLogEl.textContent ? '\n' : '') + text;
  commandLogEl.scrollTop = commandLogEl.scrollHeight;
}

function renderAgentResult(payload) {
  // payload is the agent-stub /tools/invoke response embedded under
  // status.result.response (set by offload-worker._dispatch_agent_invoke).
  if (!payload || typeof payload !== 'object') {
    appendAgentLog(`[agent] empty payload`);
    return;
  }
  if (payload.status === 'error') {
    appendAgentLog(`[agent error] ${payload.error || 'unknown error'}`);
    return;
  }
  const elapsed = typeof payload.elapsed_ms === 'number' ? `${payload.elapsed_ms} ms` : '?';
  appendAgentLog(`[agent ok] tool=${payload.tool} elapsed=${elapsed}`);
  if (Array.isArray(payload.trace) && payload.trace.length) {
    payload.trace.forEach((step) => {
      appendAgentLog(`  [trace ${step.step}] ${step.tool}: ${step.summary}`);
    });
  }
  const result = payload.result;
  if (!result) return;

  // The `command` tool wraps an inner tool result. Render the inner one.
  const inner = result.result && result.chosen_tool ? result.result : result;
  const innerTool = result.chosen_tool || payload.tool;
  if (result.chosen_tool) {
    appendAgentLog(`  [agent picked] ${result.chosen_tool} (${result.rationale})`);
  }
  if (innerTool === 'shell') {
    appendAgentLog(`  $ ${(inner.argv || []).join(' ')}  (cwd=${inner.cwd}, exit=${inner.exit_code})`);
    if (inner.stdout) appendAgentLog(`--- stdout ---\n${inner.stdout.trimEnd()}`);
    if (inner.stderr) appendAgentLog(`--- stderr ---\n${inner.stderr.trimEnd()}`);
  } else if (innerTool === 'read_file') {
    appendAgentLog(`  read ${inner.path} (${inner.bytes} bytes${inner.truncated ? ', truncated' : ''})`);
    appendAgentLog(`--- content ---\n${(inner.content || '').trimEnd()}`);
  } else if (innerTool === 'list_files') {
    appendAgentLog(`  list ${inner.root} (${(inner.entries || []).length} entries)`);
    (inner.entries || []).forEach((e) => {
      const sz = e.size === null || e.size === undefined ? '' : ` ${e.size}B`;
      appendAgentLog(`   - ${e.kind === 'dir' ? 'd' : 'f'} ${e.name}${sz}`);
    });
  } else if (innerTool === 'summarize') {
    appendAgentLog(`  summary of ${inner.input_chars} chars`);
    appendAgentLog(`  first sentence: ${inner.first_sentence}`);
    const top = (inner.top_words || []).map((w) => `${w.word}(${w.count})`).join(', ');
    if (top) appendAgentLog(`  top words: ${top}`);
  } else if (innerTool === 'echo') {
    appendAgentLog(`  echo: ${JSON.stringify(inner.echo || inner, null, 2)}`);
  } else {
    appendAgentLog(JSON.stringify(inner, null, 2));
  }
}

async function runAgentCommand(text) {
  if (!liveBackendAvailable) {
    setAgentStatus('Backend not available — agent command requires the local stack to be up.', 'warn');
    return;
  }
  const sessionId = `web-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setAgentStatus(`submitting "${text}"…`, 'pending');
  appendAgentLog(`$ POST /api/offload {task_type:"agent_invoke", tool:"command", text:${JSON.stringify(text)}}`);

  let submit;
  try {
    submit = await fetchJson(`${API_BASE}/offload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_type: 'agent_invoke',
        payload: { tool: 'command', args: { text } },
        session_id: sessionId,
      }),
    });
  } catch (err) {
    setAgentStatus(`submit failed: ${err.message}`, 'error');
    appendAgentLog(`[error] submit failed: ${err.message}`);
    return;
  }

  appendAgentLog(`job_id=${submit.job_id} status=${submit.status}`);

  // The control-plane forwards synchronously, so the first GET typically
  // already returns terminal. Poll briefly to stay correct if that ever
  // becomes async.
  const deadline = Date.now() + 30_000;
  let status = null;
  while (Date.now() < deadline) {
    try {
      status = await fetchJson(`${API_BASE}/offload/${submit.job_id}`);
    } catch (err) {
      setAgentStatus(`poll failed: ${err.message}`, 'error');
      appendAgentLog(`[error] poll failed: ${err.message}`);
      return;
    }
    if (status.status === 'completed' || status.status === 'error') break;
    await sleep(300);
  }

  if (!status || (status.status !== 'completed' && status.status !== 'error')) {
    setAgentStatus('agent did not respond within 30s', 'error');
    appendAgentLog(`[error] agent did not respond within 30s`);
    return;
  }
  if (status.status === 'error') {
    setAgentStatus(`worker error: ${status.error || 'unknown'}`, 'error');
    appendAgentLog(`[worker error] ${status.error || 'unknown'}`);
    return;
  }

  // offload-worker's agent_invoke wraps the gateway response under
  // result.response (or .response_text if the body wasn't JSON).
  const wrapper = status.result || {};
  const agentPayload = wrapper.response || wrapper.response_text || wrapper;
  renderAgentResult(agentPayload);
  const chosen = agentPayload && agentPayload.result && agentPayload.result.chosen_tool;
  setAgentStatus(
    chosen ? `agent ran ${chosen} (job ${submit.job_id})` : `agent returned ok (job ${submit.job_id})`,
    'ok'
  );
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
      setAgentStatus('Backend not detected — start docker compose to enable agent commands.', 'warn');
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
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function setHealthDot(el, state) {
  if (!el) return;
  el.classList.remove('ok', 'warn', 'down');
  el.classList.add(state);
  const labels = { ok: 'healthy', warn: 'degraded', down: 'unreachable' };
  el.setAttribute('aria-label', labels[state] || state);
}

async function probeBackend() {
  // /health says the relay is up; /ready says the worker is also reachable.
  // ready=true means "live mode available". We distinguish a
  // control-plane-up-but-worker-down state in the dots.
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
  liveBackendAvailable = cpHealthy && workerReady;
  setHealthDot(healthDots.systemA, cpHealthy ? 'ok' : 'down');
  setHealthDot(healthDots.systemB, workerReady ? 'ok' : (cpHealthy ? 'warn' : 'down'));
  // openclaw/litellm/sambanova aren't probed; warn when no backend is
  // reachable so the dots aren't lying.
  const fallback = cpHealthy ? 'ok' : 'warn';
  setHealthDot(healthDots.openclaw, fallback);
  setHealthDot(healthDots.litellm, fallback);
  setHealthDot(healthDots.sambanova, fallback);
  runDemoBtn.title = liveBackendAvailable
    ? 'Live backend detected — runs a real shell scenario via /api/offload.'
    : 'Backend not detected — runs scripted walkthrough only.';
}

applyIdle();
probeBackend();
setInterval(probeBackend, 15_000);
