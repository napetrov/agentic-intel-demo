const scenarioCapacity = {
  'terminal-agent': { allocated: 2, scenarioMax: 8, clusterFree: 6 },
  'market-research': { allocated: 4, scenarioMax: 8, clusterFree: 4 },
  'large-build-test': { allocated: 16, scenarioMax: 32, clusterFree: 0 }
};

const scenarios = {
  'terminal-agent': {
    active: ['ui', 'openclaw', 'litellm', 'sambanova', 'systemA'],
    console: {
      mode: 'terminal-agent demo',
      'openclaw version': '2026.4.15',
      orchestrator: 'OpenClaw',
      'orchestration alt': 'Flowise (optional)',
      'litellm gateway': 'litellm/sambanova primary',
      'litellm endpoint': 'port 4000 /v1',
      'sambanova model': 'DeepSeek-V3.1',
      'gnr slm inference': 'available as alternate route',
      'model route': 'LiteLLM → SambaNova',
      'session scope': 'isolated per user',
      'current path': 'System A (CWF)',
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
    commandLog: `$ openclaw demo run terminal-agent --isolated\nrequest accepted\nsession_id=demo-term-0420 sandbox=created profile=engineering\n\n$ sed -n '1,40p' agents/scenarios/terminal-agent/terminal-bench-reference.md\n# Terminal Agent Demo — Reference Task Spec\n### Name\nrepo-structure-audit-and-fixup\n### Objective\nInspect the repo and produce a structured scenario/task inventory.\n\n$ ./scripts/session-bootstrap.sh --scenario terminal-agent\n[bootstrap] workspace mounted at /workspace-intel-dev/agentic-intel-demo\n[bootstrap] tools registered: exec, read, summarize\n[bootstrap] isolated temp dir: /tmp/demo-term-0420\n[check] demo-workspace/BOOTSTRAP.md loaded\n[check] scenario prompt loaded\n\n$ ./scripts/route-task.sh --scenario terminal-agent\n[classifier] workload=interactive engineering\n[inference] provider=litellm/sambanova\n[executor] target=system-a\n[decision] use primary CWF path\n\n$ git status --short\n M web-demo/app.js\n M web-demo/index.html\n M web-demo/styles.css\n\n$ find scripts -maxdepth 1 -type f | sort\n./scripts/demo-terminal-workflow.sh\n./scripts/session-bootstrap.sh\n./scripts/legacy/smoke-test-session.sh\n\n$ ./scripts/legacy/smoke-test-session.sh --profile terminal-agent\n[step] validating shell access\n[step] validating repo context\n[step] validating writable artifact dir\n[ok] shell access confirmed\n[ok] repo context confirmed\n[ok] artifact dir ready\n\n$ ./scripts/demo-terminal-workflow.sh --emit-trace\n[1/6] inspect workspace layout\n[2/6] read task brief\n[3/6] run command batch\n[4/6] collect stdout/stderr\n[5/6] package artifacts\n[6/6] render operator summary\nworkflow complete\n\n$ tail -n 14 /tmp/demo-term-0420/command-trace.txt\n22:31:04 task accepted\n22:31:05 workspace prepared\n22:31:06 route selected: LiteLLM -> SambaNova\n22:31:07 execution path selected: System A\n22:31:09 shell probe ok\n22:31:10 command batch started\n22:31:12 command batch completed\n22:31:13 artifacts packaged\n22:31:14 summary generated\n\n$ ls -la artifacts/demo-terminal\ntotal 20\ndrwxr-xr-x 2 openclaw openclaw 4096 Apr 20 22:31 .\ndrwxr-xr-x 3 openclaw openclaw 4096 Apr 20 22:31 ..\n-rw-r--r-- 1 openclaw openclaw  612 Apr 20 22:31 command-trace.txt\n-rw-r--r-- 1 openclaw openclaw  428 Apr 20 22:31 summary.md\n-rw-r--r-- 1 openclaw openclaw  191 Apr 20 22:31 route.json\n\n$ cat artifacts/demo-terminal/route.json\n{\n  "orchestrator": "OpenClaw",\n  "inference": "SambaNova via LiteLLM",\n  "execution": "System A (CWF)"\n}\n\n$ cat artifacts/demo-terminal/summary.md\nExecution complete.\nPrimary route: System A (CWF).\nInference: SambaNova via LiteLLM.\nOperator summary ready for user delivery.`,
    timeline: [
      ['Task received', 'OpenClaw receives the request from the web UI.'],
      ['Workspace prepared', 'The engineering workspace is initialized for execution.'],
      ['Command running', 'A terminal workflow is launched with visible command activity.'],
      ['Command completed', 'Execution finishes and logs are captured for the demo.'],
      ['Answer generated', 'The user receives a concise engineering result card and next steps.']
    ],
    result: `Terminal Agent\n\nOpenClaw orchestrates the run.\nLiteLLM routes model traffic.\nSambaNova provides inference.\nSystem A (CWF) executes the primary path.\n\nUser-visible outcome:\n- engineering summary\n- live route narrative\n- command evidence\n- recommended next action`
  },
  'market-research': {
    active: ['ui', 'openclaw', 'litellm', 'sambanova', 'systemB'],
    console: {
      mode: 'market-research demo',
      'openclaw version': '2026.4.15',
      orchestrator: 'OpenClaw',
      'orchestration alt': 'Flowise (optional)',
      'litellm gateway': 'litellm/sambanova primary',
      'litellm endpoint': 'port 4000 /v1',
      'sambanova model': 'DeepSeek-V3.1',
      'gnr slm inference': 'available as alternate route',
      'model route': 'LiteLLM → SambaNova',
      'session scope': 'isolated per user',
      'current path': 'System B (GNR)',
      'artifact view': 'research brief'
    },
    metrics: {
      Elapsed: '12.1s',
      Tokens: '2,180',
      Model: 'SambaNova via LiteLLM',
      Route: 'OpenClaw → System B',
      Tools: 'read, summarize',
      Artifacts: '1'
    },
    commandLog: `$ openclaw demo run market-research --isolated\nrequest accepted\nsession_id=demo-research-0420 sandbox=created profile=research\n\n$ sed -n '1,40p' agents/scenarios/market-research/report-task.md\n# Market Research Demo Task\nObjective: recommend which SMB segment to target first for an AI meeting notes product.\nInputs: synthetic repo data under demo-inputs/market-research/.\n\n$ ./scripts/session-bootstrap.sh --scenario market-research\n[bootstrap] workspace mounted\n[bootstrap] retrieval cache ready\n[bootstrap] summarize tool ready\n[check] research prompt loaded\n\n$ ./scripts/route-task.sh --scenario market-research\n[classifier] workload=research synthesis\n[inference] provider=litellm/sambanova\n[executor] target=system-b\n[decision] use GNR path for research/offload narrative\n\n$ ./scripts/research-brief.sh --topic market-map --emit-sources\n[1/5] normalize request\n[2/5] gather source snippets\n[3/5] cluster findings\n[4/5] synthesize summary\n[5/5] assemble brief\nbrief complete\n\n$ tail -n 12 /tmp/demo-research-0420/research.log\n22:32:01 request normalized\n22:32:03 5 source notes collected\n22:32:05 2 competitor clusters created\n22:32:07 synthesis routed through SambaNova\n22:32:09 risk section drafted\n22:32:10 final brief ready\n\n$ ls -la artifacts/research\ntotal 16\ndrwxr-xr-x 2 openclaw openclaw 4096 Apr 20 22:32 .\ndrwxr-xr-x 3 openclaw openclaw 4096 Apr 20 22:32 ..\n-rw-r--r-- 1 openclaw openclaw  548 Apr 20 22:32 brief.md\n-rw-r--r-- 1 openclaw openclaw  412 Apr 20 22:32 source-notes.txt\n\n$ sed -n '1,18p' artifacts/research/source-notes.txt\n[1] pricing pressure increasing\n[2] competitor launch window shifted\n[3] enterprise demand remains stable\n[4] infra cost risk elevated\n[5] integration story improving\n\n$ sed -n '1,16p' artifacts/research/brief.md\n# Market Brief\n- Top signals identified\n- Risks and blockers listed\n- Follow-up questions proposed\n- Summary ready for demo viewer`,
    timeline: [
      ['Input accepted', 'OpenClaw accepts the scenario request.'],
      ['Orchestration', 'The task is framed as a structured research workflow.'],
      ['Inference', 'SambaNova is used through LiteLLM for synthesis and summarization.'],
      ['Execution path', 'System B (GNR) is highlighted as the offload / alternate path.'],
      ['Result ready', 'The user gets a compact market snapshot with findings and risks.']
    ],
    result: `Market Research\n\nOpenClaw orchestrates the run.\nLiteLLM routes requests to SambaNova.\nSystem B (GNR) is presented as the analysis/offload path.\n\nUser-visible outcome:\n- market snapshot\n- risks and opportunities\n- why this route was chosen`
  },
  'large-build-test': {
    active: ['ui', 'openclaw', 'litellm', 'sambanova', 'slm', 'systemA', 'systemB'],
    console: {
      mode: 'large-build-test demo',
      'openclaw version': '2026.4.15',
      orchestrator: 'OpenClaw',
      'orchestration alt': 'Flowise (optional)',
      'litellm gateway': 'litellm/sambanova primary',
      'litellm endpoint': 'port 4000 /v1',
      'sambanova model': 'DeepSeek-V3.1',
      'gnr slm inference': 'active fallback / alternate route',
      'model route': 'LiteLLM → SambaNova + SLM on GNR',
      'session scope': 'isolated per user',
      'current path': 'System A + System B handoff',
      'artifact view': 'build/test summary'
    },
    metrics: {
      Elapsed: '26.7s',
      Tokens: '4,960',
      Model: 'SambaNova + SLM on GNR',
      Route: 'OpenClaw → System A/B',
      Tools: 'exec, read, summarize',
      Artifacts: '3'
    },
    commandLog: `$ openclaw demo run large-build-test --burst\nrequest accepted\nsession_id=demo-build-0420 profile=burst workload=heavy\n\n$ sed -n '1,40p' agents/scenarios/large-build-test/build-task.md\n# Large Build/Test Demo Task\nObjective: run a larger build/test workflow with explicit large-profile framing and concrete evidence.\n\n$ ./scripts/session-bootstrap.sh --scenario large-build-test\n[bootstrap] heavy profile enabled\n[bootstrap] artifact dir prepared\n[bootstrap] summary writer ready\n\n$ ./scripts/queue-reserve.sh --profile large-build\nqueue slot reserved\nprimary lane=system-a\nfallback lane=system-b\ninference routes=SambaNova,SLM-on-GNR\n\n$ ./scripts/route-task.sh --scenario large-build-test\n[classifier] workload=heavy build/test\n[inference] primary=litellm/sambanova\n[inference] alternate=gnr slm\n[executor] split plan=system-a + system-b\n[decision] enable offload narrative\n\n$ ./scripts/run-large-build-test.sh --emit-artifacts\n[1/7] load build graph\n[2/7] reserve compile lane\n[3/7] start compile on system-a\n[4/7] prepare test shard offload on system-b\n[5/7] summarize progress through SambaNova\n[6/7] validate fallback inference on GNR SLM\n[7/7] assemble build/test package\nflow complete\n\n$ tail -n 16 /tmp/demo-build-0420/build.log\n22:32:02 task accepted\n22:32:04 queue reserved\n22:32:06 split plan generated\n22:32:08 system-a compile started\n22:32:12 system-b shard prepared\n22:32:16 primary inference complete\n22:32:19 alternate inference path healthy\n22:32:22 artifacts bundled\n22:32:24 final summary ready\n\n$ ls -la artifacts/build-test\ntotal 20\ndrwxr-xr-x 2 openclaw openclaw 4096 Apr 20 22:32 .\ndrwxr-xr-x 3 openclaw openclaw 4096 Apr 20 22:32 ..\n-rw-r--r-- 1 openclaw openclaw  744 Apr 20 22:32 build-report.md\n-rw-r--r-- 1 openclaw openclaw  618 Apr 20 22:32 command-trace.txt\n-rw-r--r-- 1 openclaw openclaw  120 Apr 20 22:32 test-summary.json\n\n$ jq '.status,.failed,.passed,.offload_path' artifacts/build-test/test-summary.json\n"ok"\n0\n128\n"system-b"\n\n$ sed -n '1,16p' artifacts/build-test/build-report.md\n# Build/Test Report\n- primary execution: System A\n- offload path: System B\n- primary inference: SambaNova\n- alternate inference: GNR SLM\n- summary ready for demo viewer`,
    timeline: [
      ['Input accepted', 'OpenClaw receives the heavy workload request.'],
      ['Orchestration', 'The task is classified as a large execution profile.'],
      ['Inference', 'LiteLLM uses SambaNova and can fall back to SLM on GNR for alternate inference capacity.'],
      ['Execution path', 'System A handles the primary path while System B is shown as offload/handoff capacity.'],
      ['Result ready', 'The user sees build/test status, route decisions, and follow-up actions.']
    ],
    result: `Large Build/Test\n\nOpenClaw coordinates a heavier workflow.\nLiteLLM routes across SambaNova and SLM on GNR.\nSystem A is primary; System B is visible as overflow/offload capacity.\n\nUser-visible outcome:\n- execution status\n- route decision\n- result summary\n- next action`
  }
};

const toolActivityEl = document.getElementById('tool-activity');
const result = document.getElementById('result');
const consoleEl = document.getElementById('console');
const commandLogEl = document.getElementById('command-log');
const metricsEl = document.getElementById('metrics');
const fleetToastEl = document.getElementById('fleet-toast');
const addAgentBtn = document.getElementById('add-agent');
const runDemoBtn = document.getElementById('run-demo');
const dataModeEl = document.getElementById('data-mode');
const allocatedEl = document.getElementById('allocated-vcpu');
const headroomEl = document.getElementById('headroom-vcpu');
const scenarioMaxEl = document.getElementById('scenario-max');
const clusterFreeEl = document.getElementById('cluster-free');
const vcpuSliderEl = document.getElementById('vcpu-slider');
const nodeEls = document.querySelectorAll('[data-node]');
let fleetState = { total: 3, systemA: 2, systemB: 1 };
let currentScenario = 'terminal-agent';
let fleetToastTimer = null;

function resetArchitecture() {
  nodeEls.forEach((el) => el.classList.remove('active'));
}

function renderConsole(entries) {
  consoleEl.innerHTML = Object.entries(entries).map(([k, v]) => `
    <div class="console-line"><span class="console-key">${k}</span><span class="console-val">${v}</span></div>
  `).join('');
}

function computeHeadroom(capacity) {
  return Math.max(0, capacity.scenarioMax - capacity.allocated);
}

function renderToolActivity(rows) {
  toolActivityEl.innerHTML = rows.map((row) => `
    <div class="tool-row${row.empty ? ' empty' : ''}">
      ${row.empty ? row.label : `<span class="tool-name">${row.name}</span><span class="tool-status">${row.status}</span>`}
    </div>
  `).join('');
}

function renderCapacity() {
  const capacity = scenarioCapacity[currentScenario];
  if (!capacity) return;
  const headroom = computeHeadroom(capacity);
  allocatedEl.textContent = capacity.allocated;
  headroomEl.textContent = `+${headroom}`;
  scenarioMaxEl.textContent = capacity.scenarioMax;
  clusterFreeEl.textContent = capacity.clusterFree;
  vcpuSliderEl.min = 1;
  vcpuSliderEl.max = capacity.scenarioMax;
  vcpuSliderEl.value = capacity.allocated;
  vcpuSliderEl.disabled = capacity.clusterFree === 0 && capacity.allocated >= capacity.scenarioMax;
  dataModeEl.textContent = 'Static demo data';
}

function renderFleet() {
  document.getElementById('agents-total').textContent = fleetState.total;
  document.getElementById('agents-a').textContent = fleetState.systemA;
  document.getElementById('agents-b').textContent = fleetState.systemB;
}

function renderMetrics(entries) {
  metricsEl.innerHTML = Object.entries(entries).map(([k, v]) => `
    <div class="metric-card"><span class="metric-label">${k}</span><span class="metric-value">${v}</span></div>
  `).join('');
}

function renderScenario(key) {
  const scenario = scenarios[key];
  if (!scenario) return;
  resetArchitecture();
  scenario.active.forEach((id) => {
    const el = document.querySelector(`[data-node="${id}"]`);
    if (el) el.classList.add('active');
  });
  renderToolActivity([
    { name: 'read', status: 'expected' },
    { name: 'exec', status: key === 'market-research' ? 'optional' : 'expected' },
    { name: 'summarize', status: 'expected' }
  ]);
  commandLogEl.textContent = scenario.commandLog || 'No command log available.';
  renderMetrics(scenario.metrics || {
    Model: '—', Route: '—', Tools: '—', Artifacts: '—'
  });
  result.textContent = scenario.result;
  result.className = 'result';
  renderConsole(scenario.console);
  renderCapacity();
}

document.querySelectorAll('[data-scenario]').forEach((el) => {
  el.addEventListener('click', () => {
    currentScenario = el.dataset.scenario;
    renderScenario(currentScenario);
  });
});

document.querySelector('[data-action="status"]').addEventListener('click', () => {
  resetArchitecture();
  ['openclaw', 'litellm', 'sambanova', 'slm', 'systemA', 'systemB'].forEach((id) => {
    const el = document.querySelector(`[data-node="${id}"]`);
    if (el) el.classList.add('active');
  });
  renderToolActivity([
    { name: 'status probe', status: 'active' },
    { name: 'routing check', status: 'active' }
  ]);
  commandLogEl.textContent = 'Status mode shows stack availability only. It does not prove a real task execution happened.';
  renderMetrics({
    Model: 'LiteLLM → SambaNova / SLM on GNR',
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
    'gnr slm inference': 'available as alternate route',
    'model route': 'LiteLLM → SambaNova / SLM on GNR',
    'session scope': 'isolated per user',
    'current path': 'stack overview',
    'artifact view': 'status only'
  });
  renderFleet();
});

document.querySelector('[data-action="reset"]').addEventListener('click', () => {
  resetArchitecture();
  renderToolActivity([{ empty: true, label: 'Select a scenario to view expected tool usage.' }]);
  commandLogEl.textContent = 'Waiting for scenario selection.';
  renderMetrics({
    Model: '—',
    Route: '—',
    Tools: '—',
    Artifacts: '—'
  });
  result.textContent = 'Waiting for scenario selection.';
  result.className = 'result empty-state';
  renderConsole({
    mode: 'demo portal',
    'openclaw version': '2026.4.15',
    orchestrator: 'OpenClaw',
    'orchestration alt': 'Flowise (optional)',
    'litellm gateway': 'litellm/sambanova primary',
    'litellm endpoint': 'port 4000 /v1',
    'sambanova model': 'DeepSeek-V3.1',
    'gnr slm inference': 'available as alternate route',
    'model route': 'LiteLLM → SambaNova / SLM on GNR',
    'session scope': 'isolated per user',
    'current path': 'waiting for scenario',
    'artifact view': 'summary only'
  });
  renderFleet();
});

vcpuSliderEl.addEventListener('input', () => {
  const capacity = scenarioCapacity[currentScenario];
  if (!capacity) return;
  const next = Number(vcpuSliderEl.value);
  const maxReachable = Math.min(capacity.scenarioMax, capacity.allocated + capacity.clusterFree);
  if (next > maxReachable) {
    vcpuSliderEl.value = capacity.allocated;
    return;
  }
  const delta = next - capacity.allocated;
  capacity.allocated = next;
  capacity.clusterFree = Math.max(0, capacity.clusterFree - delta);
  renderCapacity();
});

addAgentBtn.addEventListener('click', () => {
  fleetState.total += 1;
  let target = 'System B';
  if (fleetState.systemA <= fleetState.systemB) {
    fleetState.systemA += 1;
    target = 'System A';
  } else {
    fleetState.systemB += 1;
    target = 'System B';
  }
  renderFleet();
  fleetToastEl.textContent = `Agent added to ${target}. Fleet updated.`;
  fleetToastEl.classList.remove('hidden');
  clearTimeout(fleetToastTimer);
  fleetToastTimer = setTimeout(() => fleetToastEl.classList.add('hidden'), 2200);
});

runDemoBtn.addEventListener('click', () => {
  const restoreLabel = runDemoBtn.textContent;
  runDemoBtn.textContent = 'Running...';
  runDemoBtn.disabled = true;

  const steps = [
    {
      at: 400,
      route: 'OpenClaw accepted request', tools: [
        { name: 'session init', status: 'active' }
      ], artifacts: '0',
      log: '$ openclaw demo run terminal-agent --isolated\nrequest accepted\nsession_id=demo-term-0420 sandbox=created\n'
    },
    {
      at: 2100,
      route: 'LiteLLM → SambaNova', tools: [
        { name: 'read', status: 'active' },
        { name: 'exec', status: 'queued' }
      ], artifacts: '0',
      log: '$ pwd\n/workspace-intel-dev/agentic-intel-demo\n$ find agents -maxdepth 3 -type f | sort\n...\n'
    },
    {
      at: 6800,
      route: 'System A (CWF)', tools: [
        { name: 'read', status: 'done' },
        { name: 'exec', status: 'active' },
        { name: 'summarize', status: 'queued' }
      ], artifacts: '1',
      log: '$ ./scripts/legacy/smoke-test-session.sh --profile terminal-agent\n[bootstrap] workspace mounted\n[exec] path=system-a\n'
    },
    {
      at: 11600,
      route: 'System A (CWF)', tools: [
        { name: 'read', status: 'done' },
        { name: 'exec', status: 'done' },
        { name: 'summarize', status: 'active' }
      ], artifacts: '2',
      log: '$ tail -n 10 /tmp/demo-terminal-workflow.log\ncommand completed\nartifacts packaged\nsummary generated\n'
    }
  ];

  const totalDuration = steps[steps.length - 1].at;

  commandLogEl.textContent = '';
  result.textContent = 'Demo in progress...';
  result.className = 'result';
  renderToolActivity([{ name: 'session init', status: 'active' }]);
  renderMetrics({
    Model: currentScenario === 'large-build-test' ? 'SambaNova + SLM on GNR' : 'SambaNova via LiteLLM',
    Route: 'preparing',
    Tools: 'initializing',
    Artifacts: '0'
  });

  steps.forEach((step) => {
    setTimeout(() => {
      commandLogEl.textContent += (commandLogEl.textContent ? '\n' : '') + step.log;
      commandLogEl.scrollTop = commandLogEl.scrollHeight;
      renderToolActivity(step.tools);
      renderMetrics({
        Model: currentScenario === 'large-build-test' ? 'SambaNova + SLM on GNR' : 'SambaNova via LiteLLM',
        Route: step.route,
        Tools: step.tools.map((tool) => tool.name).join(', '),
        Artifacts: step.artifacts
      });
    }, step.at);
  });

  setTimeout(() => {
    renderScenario(currentScenario);
    runDemoBtn.textContent = restoreLabel;
    runDemoBtn.disabled = false;
  }, totalDuration + 250);
});

renderFleet();
renderScenario(currentScenario);
