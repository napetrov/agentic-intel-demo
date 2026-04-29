const SYSTEM_A_TOTAL_VCPU = 512;
const SYSTEM_B_TOTAL_VCPU = 100;

// Shown by the Direct tool call panel when the local stack isn't reachable.
// Both call sites (form-submit guard + runAgentCommand defensive guard) use
// the same copy so the wording can't drift as docs evolve.
const BACKEND_REQUIRED_MSG =
  'Control plane not reachable — direct tool calls are disabled.';

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
    // What "Run demo" sends when the live backend is reachable. These are
    // the server-side allow-listed scenario scripts in the System B
    // offload-worker, not ad-hoc shell commands. The Agent command panel is
    // the separate surface for direct agent_invoke/tool calls.
    liveScenario: { task_type: 'shell', payload: { scenario: 'terminal-agent', timeout_seconds: 120 } },
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
    liveScenario: { task_type: 'shell', payload: { scenario: 'market-research', timeout_seconds: 120 } },
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
    liveScenario: { task_type: 'shell', payload: { scenario: 'large-build-test', timeout_seconds: 120 } },
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
  },
  'taskflow-pull': {
    orchestrationActive: ['openclaw', 'litellm', 'sambanova'],
    primary: { name: 'TaskFlow puller', vcpu: 4 },
    subagent: null,
    services: { erag: false, 'ent-inference': false },
    crossSystemArrow: false,
    console: {
      mode: 'taskflow-pull demo',
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
      'taskflow source': 'TASKFLOW_API_URL or shipped fixture',
      'artifact view': 'taskflow audit / escalate / summary'
    },
    metrics: {
      Elapsed: '9.6s',
      Tokens: '1,840',
      Model: 'SambaNova via LiteLLM',
      Route: 'OpenClaw → System A',
      Tools: 'fetch, exec, validate',
      Artifacts: '1'
    },
    liveScenario: { task_type: 'shell', payload: { scenario: 'taskflow-pull', timeout_seconds: 120 } },
    toolActivity: [
      { icon: '💻', tool: 'terminal', value: 'openclaw demo run taskflow-pull --isolated' },
      { icon: '🌐', tool: 'api_call', value: 'GET ${TASKFLOW_API_URL}/tasks (fallback: fixture)' },
      { icon: '📖', tool: 'read_file', value: 'agents/scenarios/taskflow-pull/task-brief.md' },
      { icon: '🐍', tool: 'execute_code', value: 'python3 select task by priority/due-date' },
      { icon: '💻', tool: 'terminal', value: 'render bounded action → /tmp/taskflow-<id>.md' },
      { icon: '🔎', tool: 'search_files', value: 'grep -q "task <id>" /tmp/taskflow-<id>.md' },
      { icon: '📝', tool: 'summarize', value: 'JSON result fragment → result panel' }
    ],
    commandLog: `$ openclaw demo run taskflow-pull --isolated\nrequest accepted\nsession_id=demo-taskflow-0427 sandbox=created profile=engineering\n\n$ sed -n '1,12p' agents/scenarios/taskflow-pull/task-brief.md\n# TaskFlow Pull — Bounded Task Brief\n## Objective\nDemonstrate the full pull-and-run loop end-to-end:\nfetch a TaskFlow task -> select -> render -> execute -> validate -> summarize.\n\n$ ./scripts/route-task.sh --scenario taskflow-pull\n[classifier] workload=interactive engineering (extension scenario)\n[inference] provider=litellm/sambanova\n[executor] target=system-a\n[decision] use primary CWF path; pull-only\n\n$ python3 select task by priority/due-date\nsource_kind: fixture\nsource_ref:  agents/scenarios/taskflow-pull/fixtures/tasks.json\ntask_count: 5\npicked: 101 | high | overdue | 2026-04-10 | Audit overdue invoices for Q1\naction: escalate\nartifact: /tmp/taskflow-101.md\nwrote /tmp/taskflow-101.md\n\n$ test -s /tmp/taskflow-101.md && grep -q "task 101" /tmp/taskflow-101.md\nok\n\n$ tail -n 20 /tmp/taskflow-101.md\n## Escalation notice\n\nTask 101 is overdue with priority high.\nPer business rules, escalating to assignee \`alice\`.\nNext action: notify owner and re-evaluate due date.\nrun complete`,
    timeline: [
      ['Task received', 'OpenClaw accepts the request; System A reserves a 4 vCPU slot for the TaskFlow puller.'],
      ['Source resolved', 'Worker resolves TaskFlow source: live API when TASKFLOW_API_URL is set, else the shipped fixture.'],
      ['Task selected', 'Selection rules applied (overdue > open, high > medium > low, oldest due-date first).'],
      ['Action executed', 'Bounded action (audit/escalate/summarize) renders an artifact under /tmp/taskflow-<id>.<ext>.'],
      ['Result ready', 'Validation grep + structured JSON result fragment delivered; capacity returned to the pool.']
    ],
    result: [
      'artifacts/demo-taskflow/taskflow-pull-summary.md',
      '─────────────────────────────────────────',
      'TaskFlow pull — bounded extension scenario',
      '',
      'Source',
      '  source_kind: fixture',
      '  source_ref:  agents/scenarios/taskflow-pull/fixtures/tasks.json',
      '  task_count:  5',
      '',
      'Selection',
      '  rules:    overdue > open · high > medium > low · oldest due-date first',
      '  picked:   101 | high | overdue | 2026-04-10 | Audit overdue invoices for Q1',
      '',
      'Bounded action',
      '  action:   escalate',
      '  artifact: /tmp/taskflow-101.md',
      '',
      'Validation',
      '  test -s /tmp/taskflow-101.md           → ok',
      '  grep -q "task 101" /tmp/taskflow-101.md → ok',
      '',
      'Final summary: PASS — task 101 selected, escalation notice written, validation green.'
    ].join('\n')
  }
};

const idleConsole = {
  mode: 'demo portal',
  'openclaw version': '2026.4.15',
  orchestrator: 'OpenClaw',
  'model route': 'resolved per scenario',
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
const archNarrationEl = document.getElementById('arch-narration');
const archNarrationLabelEl = document.getElementById('arch-narration-label');
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
// Latest snapshot of long-lived agents from /api/agents. Long-lived agents
// render directly in the System A / System B architecture pools alongside
// the scenario primary and short-lived task rows; refreshAgents() refills
// this on a 30s timer and the pools redraw immediately.
let lastAgentRecords = [];
// Demo-only override: clicking a long-lived agent card flips it into a
// "force-running" state in the architecture pool so a presenter can light
// up the visual without touching the underlying runtime. Persisted in
// localStorage so a presenter doesn't lose the layout on reload.
const AGENT_DEMO_OVERRIDE_KEY = 'demo.agentRunningOverrides.v1';
function loadAgentDemoOverrides() {
  try {
    const raw = localStorage.getItem(AGENT_DEMO_OVERRIDE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch (_) {
    return new Set();
  }
}
function saveAgentDemoOverrides() {
  try {
    localStorage.setItem(
      AGENT_DEMO_OVERRIDE_KEY,
      JSON.stringify(Array.from(agentDemoRunningOverrides))
    );
  } catch (_) {
    // localStorage may be disabled (private browsing, sandboxed iframe);
    // the override still works for the current page life so swallow the
    // error rather than failing the click.
  }
}
const agentDemoRunningOverrides = loadAgentDemoOverrides();
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
  // responses can't overwrite the new mode (Reset / new scenario).
  // runLiveWalkthrough checks `myRunId === liveRunId` after each await and
  // bails out early when this counter advances.
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

// ---- T3: lockstep architecture animation ------------------------------
// Predicted phase tracks per scenario. The live walkthrough is
// synchronous on the wire (control-plane forwards the entire stdout in
// one block), so we can't drive these from real events. Instead we run
// a predicted timeline that matches the scenario's typical wall-clock
// shape — the architecture moves while the run is in flight, the
// narration strip tells the viewer where they are, and the final
// "done"/"error" state is set when the actual response lands.
const SCENARIO_PHASE_TRACKS = {
  'terminal-agent': [
    { label: 'Receiving request &mdash; OpenClaw accepts the scenario.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'Routing the model call through LiteLLM.', pulse: ['litellm'], system: 'a', cross: false },
    { label: 'Inference: SambaNova answers the planning prompt.', pulse: ['sambanova'], system: 'a', cross: false },
    { label: 'Running the bounded shell task on System A.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'Validating the artifact and assembling the result.', pulse: ['openclaw'], system: 'a', cross: false },
  ],
  'market-research': [
    { label: 'OpenClaw frames the question on System A.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'LiteLLM routes to SambaNova for synthesis.', pulse: ['litellm', 'sambanova'], system: 'a', cross: false },
    { label: 'Dispatching the pandas subagent &mdash; A &rarr; B.', pulse: ['openclaw'], system: 'both', cross: true, services: { erag: true } },
    { label: 'System B aggregates with pandas (groupby + weighted mean).', pulse: [], system: 'both', cross: true, services: { erag: true } },
    { label: 'Synthesizing the analyst note back on System A.', pulse: ['sambanova'], system: 'a', cross: false },
  ],
  'large-build-test': [
    { label: 'Reserving a 16 vCPU large slot on System A.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'LiteLLM splits inference across SambaNova and the SLM route.', pulse: ['litellm', 'sambanova', 'ent-inference-route'], system: 'a', cross: false, services: { 'ent-inference': true } },
    { label: 'Compiling the project (compileall) on System A.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'Running unittest discover &mdash; 8 tests across 2 modules.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'sklearn fit + holdout validation; assembling the summary.', pulse: ['openclaw'], system: 'a', cross: false },
  ],
  'taskflow-pull': [
    { label: 'Resolving TaskFlow source (live API or shipped fixture).', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'Fetching open tasks; selecting one by business rules.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'LiteLLM routes the planning call to SambaNova.', pulse: ['litellm', 'sambanova'], system: 'a', cross: false },
    { label: 'Rendering the bounded action artifact on System A.', pulse: ['openclaw'], system: 'a', cross: false },
    { label: 'Validating the artifact and emitting the JSON verdict.', pulse: ['openclaw'], system: 'a', cross: false },
  ],
};

// Approximate wall-clock per scenario. Driven from the scenario stats
// shown on the cards in index.html — keep these two in rough sync. Used
// to space phase advancement so the strip doesn't run out before the
// live response arrives.
const SCENARIO_DURATION_MS = {
  'terminal-agent':   25_000,
  'market-research':  40_000,
  'large-build-test': 60_000,
  'taskflow-pull':    30_000,
};

let scenarioPhaseTimers = [];
function clearScenarioPhaseTimers() {
  scenarioPhaseTimers.forEach((t) => clearTimeout(t));
  scenarioPhaseTimers = [];
}

function setArchNarration(state, label) {
  if (!archNarrationEl || !archNarrationLabelEl) return;
  archNarrationEl.dataset.state = state || 'idle';
  // Phase labels are static strings we author; using innerHTML so the
  // HTML entities (&rarr;, &mdash;) render rather than appearing as text.
  archNarrationLabelEl.innerHTML = label || '';
}

function setNodePulsing(nodeIds) {
  const set = new Set(nodeIds || []);
  document.querySelectorAll('.arch-node[data-node]').forEach((el) => {
    el.classList.toggle('pulsing', set.has(el.dataset.node));
  });
}

function playScenarioPhases(scenarioKey) {
  clearScenarioPhaseTimers();
  const track = SCENARIO_PHASE_TRACKS[scenarioKey];
  if (!track || !track.length) return;
  const total = SCENARIO_DURATION_MS[scenarioKey] || 30_000;
  // Spread phases evenly; the last phase parks at ~85% of duration so
  // the "running" state still has signal until the actual response
  // arrives. If the response comes earlier we cancel the rest.
  const step = Math.floor((total * 0.85) / track.length);
  track.forEach((phase, idx) => {
    const t = setTimeout(() => {
      setArchNarration('running', phase.label);
      setNodePulsing(phase.pulse || []);
      if (typeof phase.cross === 'boolean') setCrossArrow(phase.cross);
      if (phase.services) setServiceState(phase.services);
    }, idx * step);
    scenarioPhaseTimers.push(t);
  });
}

function stopScenarioPhases(finalState, finalLabel) {
  clearScenarioPhaseTimers();
  setNodePulsing([]);
  if (finalState && finalLabel !== undefined) {
    setArchNarration(finalState, finalLabel);
  }
}

// ---- T5: result tiles (artifact link only) ----------------------------
// The earlier version of this also rendered a $/task vs frontier-API
// economics tile; that was dropped to align with the scalability-page
// decision (schema v3) to keep the demo purely about compute and not
// ship an apples-to-oranges $ comparison against owned hardware.
function renderResultTiles(scenarioKey, jobId) {
  const tilesEl = document.getElementById('result-tiles');
  const artifactEl = document.getElementById('result-tile-artifact');
  const artifactValueEl = document.getElementById('result-tile-artifact-value');
  const artifactHintEl = document.getElementById('result-tile-artifact-hint');
  if (!tilesEl) return;

  // Artifact link — only market-research has a real MinIO bucket on the
  // shipped path. The other scenarios write artifacts under /tmp inside
  // the offload-worker pod and don't surface them externally; showing a
  // dead link there would be worse than no tile. Also gate on the
  // viewer being on localhost — a port-forwarded / remote demo would
  // hit a dead 127.0.0.1:9001 from the browser host.
  const isLocalHost =
    location.hostname === '127.0.0.1' ||
    location.hostname === 'localhost' ||
    location.hostname === '';
  let artifactShown = false;
  if (artifactEl) {
    if (scenarioKey === 'market-research' && jobId && isLocalHost) {
      const minioUrl = `http://127.0.0.1:9001/browser/demo-artifacts/${encodeURIComponent(jobId)}/`;
      artifactEl.href = minioUrl;
      artifactValueEl.textContent = `demo-artifacts/${jobId}/`;
      artifactHintEl.textContent = 'Open in MinIO console (Tier 1 dev: :9001)';
      artifactEl.hidden = false;
      artifactShown = true;
    } else {
      artifactEl.hidden = true;
    }
  }

  // Hide the whole tiles row when nothing's worth showing — avoids an
  // empty 1px container under the result text on scenarios that don't
  // surface an artifact.
  tilesEl.hidden = !artifactShown;
}

function clearResultTiles() {
  const tilesEl = document.getElementById('result-tiles');
  if (tilesEl) tilesEl.hidden = true;
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

// Long-lived agents render with a "long-lived" label in the cpu column and
// their registry status drives the row state: Ready behaves like a running
// row (green/active), Provisioning/Degraded look planned (dashed), Stopped
// dims out. Long-lived agents do NOT contribute to the vCPU capacity bar —
// the bar reflects task work in flight, not idle agents waiting for work.
const LONG_LIVED_STATE_BY_STATUS = {
  Ready: 'running',
  Provisioning: 'planned',
  Degraded: 'planned',
  Stopped: 'planned',
  Unknown: 'planned'
};

function longLivedAgentRowHtml(agent) {
  // Demo override: when the presenter has clicked this card, force the
  // visual into the green "running" state regardless of what /api/agents
  // reports. The actual probed status is preserved on the data attribute
  // so the override badge can reference it on hover.
  const isDemoRunning = agentDemoRunningOverrides.has(agent.id);
  const state = isDemoRunning
    ? 'running'
    : (LONG_LIVED_STATE_BY_STATUS[agent.status] || 'planned');
  const status = isDemoRunning ? 'running' : (agent.status || 'unknown').toLowerCase();
  const kind = agent.kind ? ` · ${escapeHtml(agent.kind)}` : '';
  // Confidential-compute slots (e.g. agents marked `confidential: tdx`
  // in config/agents.yaml) get a visible padlock + "TDX" pill in the
  // architecture so the audience sees the differentiator without
  // hovering. The /api/agents read forwards the field as `confidential`.
  const isTdx = agent.confidential === 'tdx';
  const tdxBadge = isTdx
    ? '<span class="agent-row-badge tdx-badge" title="Confidential session pod (Intel TDX, kata-qemu-tdx runtime)">&#x1F512; TDX</span>'
    : '';
  const demoBadge = isDemoRunning
    ? `<span class="agent-row-badge demo-badge" title="Demo override — click to clear (actual status: ${escapeHtml(agent.status || 'unknown')})">demo</span>`
    : '';
  const clickTitle = isDemoRunning
    ? 'Click to clear demo-running override'
    : 'Click to mark this agent as running for the demo presentation';
  return `
    <div class="agent-row ${state} persistent agent-row-toggle${isTdx ? ' tdx' : ''}${isDemoRunning ? ' demo-running' : ''}"
         data-agent-id="${escapeHtml(agent.id)}"
         data-status="${escapeHtml(agent.status || 'Unknown')}"
         role="button" tabindex="0" title="${clickTitle}">
      <span class="agent-name">${escapeHtml(agent.name || agent.id)}${tdxBadge}<span class="agent-row-badge">long-lived${kind}</span>${demoBadge}</span>
      <span class="agent-cpu">persistent</span>
      <span class="agent-status">${escapeHtml(status)}</span>
    </div>
  `;
}

function longLivedAgentsForSystem(systemKey) {
  return lastAgentRecords.filter((a) => a && a.system === systemKey);
}

// HTML fragment for the long-lived rows on a given system, or '' if none.
// Live-flow renderers prepend this so persistent agents stay visible while
// the architecture is pinned and the transient rows are rewritten.
function longLivedAgentsHtmlFor(systemKey) {
  return longLivedAgentsForSystem(systemKey).map(longLivedAgentRowHtml).join('');
}

function renderSystemA(scenario, phase) {
  const rows = [];
  let usedVcpu = 0;

  // Long-lived agents come first — they're persistent and frame the pool
  // before any transient scenario / task rows. They don't add to vCPU
  // utilization; the capacity bar tracks active task work only.
  for (const agent of longLivedAgentsForSystem('system_a')) {
    rows.push(longLivedAgentRowHtml(agent));
  }

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
  // System B's pool is populated from three sources:
  //   1. Long-lived agents registered against system_b (persistent).
  //   2. The scenario's offload subagent (only if the scenario routes
  //      to System B and the run has actually spawned it).
  //   3. Multi-session fan-out where the operator picked target_system
  //      = 'system_b' explicitly.
  // Long-lived agents don't add to the vCPU bar; the scenario subagent
  // and target_system=system_b tasks do.
  const rows = [];
  let usedVcpu = 0;

  for (const agent of longLivedAgentsForSystem('system_b')) {
    rows.push(longLivedAgentRowHtml(agent));
  }

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
  sysAAgentsEl.innerHTML = longLivedAgentsHtmlFor('system_a') + agentRowHtml('control-plane-offload', 1, rowState);
  renderCapacity(isRunning ? 1 : 0);
  sysBOffloadEl.innerHTML = longLivedAgentsHtmlFor('system_b') + `
    <div class="agent-row ${rowState}">
      <span class="agent-name">agent-stub gateway</span>
      <span class="agent-cpu">System B</span>
      <span class="agent-status">${isRunning ? 'running' : terminalLabel}</span>
    </div>
  `;
  renderCapacityB(isRunning ? 1 : 0);
  setCrossArrow(true);
  renderConsole({
    mode: 'live scenario',
    route: 'web demo → System A → System B',
    'system a': 'control-plane-offload',
    'system b': 'offload-worker scenario script',
    'worker runtime': 'System B offload-worker',
    'model route': 'scenario-defined / local tools',
    'artifact view': 'live scenario transcript'
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
    // legacy { name, status } shape used by live runs
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
  setSelectedScenarioCard(null);
  setDataMode('');
  setOrchestrationActive([]);
  setServiceState({});
  renderSystemA(null, 'idle');
  renderOffload(null, 'idle', false);
  setCrossArrow(false);
  stopScenarioPhases('idle', 'Pick a scenario above &mdash; the diagram will animate as the run progresses.');
  clearResultTiles();
  renderToolActivity([{ empty: true, label: 'Select a scenario to see the tool calls, API calls, and subagents it will use.' }]);
  commandLogEl.textContent = 'Waiting for scenario selection.';
  renderMetrics({ Model: '—', Route: '—', Tools: '—', Artifacts: '—' });
  // innerHTML so the placeholder copy can use <strong> for the CTA. Same
  // string lives in index.html so first-load and reset look identical.
  result.innerHTML =
    'Pick a scenario above and press <strong>Run demo</strong>. After the run this panel shows the verdict, exit code, and elapsed time, plus (for cross-system runs) a live MinIO console link to the produced artifact.';
  result.className = 'result empty-state';
  renderConsole(idleConsole);
}

function setSelectedScenarioCard(key) {
  document.querySelectorAll('[data-scenario]').forEach((el) => {
    const isMatch = key && el.dataset.scenario === key;
    el.classList.toggle('selected', Boolean(isMatch));
    if (isMatch) {
      el.setAttribute('aria-pressed', 'true');
    } else {
      el.setAttribute('aria-pressed', 'false');
    }
  });
}

function applyPlanned(key) {
  cancelRun();
  const scenario = scenarios[key];
  if (!scenario) return;
  currentScenario = key;
  currentPhase = 'planned';
  setSelectedScenarioCard(key);
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

document.querySelector('[data-action="reset"]').addEventListener('click', () => {
  applyIdle();
});

// The Density card is a virtual scenario: it doesn't have an entry in
// `scenarios` and doesn't go through `runLiveWalkthrough` (the offload-worker
// allow-list would reject it). Instead it drives the existing multi-session
// spawn pool with a small/system_a/20× preset and scrolls the viewer to the
// architecture so the capacity bars are visible while sessions appear.
document.querySelectorAll('[data-action="density"]').forEach((el) => {
  el.addEventListener('click', () => {
    runDensityPreset();
  });
});

function runDensityPreset() {
  // Open the multi-session details so the spawn table is on screen
  // before we kick the batch off; the form is folded by default so the
  // viewer doesn't see the configurator.
  const details = document.querySelector('details.multi-session-details');
  if (details) details.open = true;

  // Pre-fill the form so the operator can see what's about to be spawned;
  // also re-uses the existing validation and status-message paths.
  if (multiSessionScenario) multiSessionScenario.value = 'terminal-agent';
  if (multiSessionProfile) multiSessionProfile.value = 'small';
  if (multiSessionTarget) multiSessionTarget.value = 'system_a';
  if (multiSessionAgent) multiSessionAgent.value = '';
  if (multiSessionCount) multiSessionCount.value = '20';

  // Scroll the architecture into view first — that's where the visible
  // capacity-fill happens. The session table is below; viewer naturally
  // sees the whole story by scrolling down once.
  const arch = document.getElementById('architecture');
  if (arch) arch.scrollIntoView({ behavior: 'smooth', block: 'start' });

  spawnSessionBatch('terminal-agent', 'small', 20, 'system_a', '');
}

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
  playScenarioPhases(scenarioKey);
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
    stopScenarioPhases('done', 'Run complete (simulated) &mdash; result rendered below.');
    renderResultTiles(scenarioKey, null);
    restoreRunButton();
  }, totalDuration));
}

async function runLiveWalkthrough(scenarioKey) {
  const scenario = scenarios[scenarioKey];
  if (!scenario) return;
  const myRunId = ++liveRunId;
  const sessionId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const liveRoute = 'web demo → System A control-plane → System B offload-worker → allow-listed scenario script';
  const liveAgent = 'System B offload-worker';
  const liveScenario = scenario.liveScenario || { task_type: 'shell', payload: { scenario: scenarioKey, timeout_seconds: 120 } };
  const liveInput = `${liveScenario.task_type}:${(liveScenario.payload && liveScenario.payload.scenario) || scenarioKey}`;

  renderLiveAgentArchitecture(scenarioKey, 'running');
  playScenarioPhases(scenarioKey);

  // Run the real demo scenario scripts described in k8s/system-b/offload-worker.yaml.
  // These are server-side allow-listed scripts (`task_type=shell` with a scenario
  // name), not ad-hoc agent commands. The separate Agent command panel still uses
  // agent_invoke for direct OpenClaw-gateway tool calls.
  const submitBody = {
    task_type: liveScenario.task_type,
    payload: liveScenario.payload,
    session_id: sessionId
  };
  commandLogEl.textContent = [
    `Live scenario: ${scenarioKey}`,
    `Route: ${liveRoute}`,
    `Worker: ${liveAgent}`,
    `Task: ${liveInput}`,
    '',
    `[live 1/5] Health checks are green; preparing allow-listed scenario payload`,
    `[live 2/5] POST /api/offload → System A control-plane`
  ].join('\n');
  result.textContent = `Live scenario run started for ${scenarioKey}; executing System B scenario script…`;
  result.className = 'result empty-state';
  renderToolActivity([
    { icon: '🌐', tool: 'api_call', value: `POST /api/offload (${liveInput})`, status: 'active' }
  ]);
  renderMetrics({
    Status: 'submitting',
    Route: 'System A → System B',
    Worker: liveAgent,
    Scenario: scenarioKey
  });

  const stillCurrent = () => myRunId === liveRunId;
  const finish = () => { if (stillCurrent()) restoreRunButton(); };
  const finalizeLive = (state) => {
    if (!stillCurrent()) return;
    renderLiveAgentArchitecture(scenarioKey, state);
    if (state === 'error') {
      stopScenarioPhases('error', 'Live run failed &mdash; see log below.');
    } else {
      stopScenarioPhases('done', 'Run complete &mdash; result rendered below.');
    }
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

  appendLog(`[live 3/5] control-plane accepted job_id=${submit.job_id} initial_status=${submit.status}`);
  renderMetrics({
    Status: 'accepted',
    Route: 'System A → System B',
    Worker: liveAgent,
    Scenario: scenarioKey,
    'Job ID': submit.job_id
  });
  renderToolActivity([
    { icon: '🌐', tool: 'api_call', value: `POST /api/offload (${liveInput})`, status: 'done' },
    { icon: '🔁', tool: 'poll_job', value: `GET /api/offload/${submit.job_id}`, status: 'active' }
  ]);

  // Poll until terminal. The control-plane forwards synchronously so the
  // first GET typically already returns "completed" — the poll is here so we
  // stay correct if the relay ever switches to async.
  const renderPollError = (detail) => {
    renderToolActivity([
      { icon: '🌐', tool: 'api_call', value: `POST /api/offload (${liveInput})`, status: 'done' },
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
    appendLog(`[live 4/5] polled ${submit.job_id}: status=${status.status}`);
    renderMetrics({
      Status: status.status,
      Route: 'System A → System B',
      Worker: liveAgent,
      Scenario: scenarioKey,
      'Job ID': submit.job_id
    });
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

  let scenarioResult = status.result || null;
  if (!scenarioResult && status.result_ref) {
    scenarioResult = await fetchArtifactPayload(status.result_ref, appendLog);
    if (!stillCurrent()) return;
    if (!scenarioResult) {
      result.textContent = `Live scenario finished, but response artifact fetch failed (job ${submit.job_id}).`;
      finalizeLive('error');
      return;
    }
  }
  if (!scenarioResult || typeof scenarioResult !== 'object' || Array.isArray(scenarioResult)) {
    appendLog(`[scenario] invalid response payload (got ${typeof scenarioResult})`);
    result.textContent = `Live scenario returned no structured payload (job ${submit.job_id}).`;
    finalizeLive('error');
    return;
  }

  const elapsedMs = (status.completed_at && status.submitted_at)
    ? Math.max(0, (status.completed_at - status.submitted_at) * 1000)
    : null;
  const exitCode = typeof scenarioResult.exit_code === 'number' ? scenarioResult.exit_code : null;
  const succeeded = exitCode === null || exitCode === 0;
  const stdout = String(scenarioResult.stdout || '').trimEnd();
  const stderr = String(scenarioResult.stderr || '').trimEnd();
  appendLog(`[live 5/5] System B scenario script completed; rendering stdout/stderr`);
  if (stdout) appendLog(stdout);
  if (stderr) appendLog(`--- stderr ---\n${stderr}`);

  renderToolActivity([
    { icon: '🌐', tool: 'api_call', value: `POST /api/offload (${liveInput})`, status: 'done' },
    { icon: '🔁', tool: 'poll_job', value: `GET /api/offload/${submit.job_id}`, status: 'done' },
    { icon: '⚙️', tool: 'scenario_script', value: `${scenarioKey}${exitCode !== null ? ` exit=${exitCode}` : ''}`, status: succeeded ? 'done' : 'error' }
  ]);
  renderMetrics({
    Status: succeeded ? 'completed' : 'failed',
    Route: 'System A → System B',
    Worker: liveAgent,
    Scenario: scenarioKey,
    Exit: exitCode === null ? '—' : String(exitCode),
    Elapsed: elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(2)}s` : '—',
    'Job ID': submit.job_id
  });
  renderLiveAgentArchitecture(scenarioKey, succeeded ? 'done' : 'error');
  if (succeeded) {
    renderResultTiles(scenarioKey, submit.job_id);
  } else {
    clearResultTiles();
  }
  stopScenarioPhases(
    succeeded ? 'done' : 'error',
    succeeded
      ? 'Run complete &mdash; result rendered below.'
      : 'Run finished with errors &mdash; see stderr below.'
  );
  result.textContent = renderLiveArtifact({
    scenarioKey,
    jobId: submit.job_id,
    chosenTool: 'scenario_script',
    exitCode,
    elapsedMs,
    route: liveRoute,
    agent: liveAgent,
    succeeded,
    resultRef: status.result_ref || null,
    agentElapsedMs: null,
    output: [stdout, stderr ? `--- stderr ---\n${stderr}` : ''].filter(Boolean).join('\n')
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
    lines.push('', 'Output', output);
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
  const sysAPersistent = longLivedAgentsHtmlFor('system_a');
  const sysBPersistent = longLivedAgentsHtmlFor('system_b');
  sysAAgentsEl.innerHTML = sysAPersistent + (terminal
    ? `
      <div class="agent-row planned">
        <span class="agent-name">control-plane-offload</span>
        <span class="agent-cpu">System A</span>
        <span class="agent-status">${status === 'error' ? 'failed' : 'completed'}</span>
      </div>
    `
    : agentRowHtml('control-plane-offload', 1, 'running'));
  renderCapacity(terminal ? 0 : 1);
  if (terminal) {
    sysBOffloadEl.innerHTML = sysBPersistent + `
      <div class="agent-row planned">
        <span class="agent-name">agent-stub gateway</span>
        <span class="agent-cpu">System B</span>
        <span class="agent-status">${status === 'error' ? 'failed' : 'completed'}</span>
      </div>
    `;
  } else {
    sysBOffloadEl.innerHTML = sysBPersistent + agentRowHtml('agent-stub gateway', 1, 'running');
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
  const chosen = agentPayload && agentPayload.result && agentPayload.result.chosen_tool;
  const innerResult = agentPayload && agentPayload.result && agentPayload.result.result
    ? agentPayload.result.result
    : (agentPayload && agentPayload.result);
  const exitCode = innerResult && typeof innerResult === 'object' && 'exit_code' in innerResult
    ? innerResult.exit_code
    : null;
  const isAgentError = (agentPayload && agentPayload.status === 'error')
    || !summary.ok
    || (exitCode !== null && exitCode !== 0);
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
  // Run demo executes allow-listed scenario scripts through the worker.
  // The Agent command panel separately uses task_type=agent_invoke, which
  // the worker forwards to the gateway, so keep probing OpenClaw too.
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
    ? 'Live backend detected — runs the selected allow-listed scenario through /api/offload on System B.'
    : (cpHealthy && workerReady && !openclawOk
        ? 'OpenClaw gateway unreachable — scenario runner is healthy, but direct tool calls are disabled.'
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
const multiSessionClearCompleted = document.getElementById('multi-session-clear-completed');

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

// Default the completed-rows section to collapsed. A density run can drop
// dozens of terminal rows into the table at once and the operator usually
// only cares about what's still in flight; the fold toggle lets them peek
// at the history without scrolling past it on every refresh.
let completedRowsCollapsed = true;
// Active density runs can briefly produce dozens of Pending/Running rows.
// Keep the panel usable by rendering a bounded preview by default, with
// an explicit expand control when an operator needs the full table.
const MAX_VISIBLE_ACTIVE_ROWS = 12;
let activeRowsCollapsed = true;
// Cached snapshot of whatever was last passed to renderMultiSessionRows.
// Used by the fold toggle so flipping the collapse state can re-render
// from cache without making a /api/sessions round-trip. Distinct from
// lastSessionRecords: that one is filtered to trackedSessionIds for the
// architecture pool, while this one mirrors the *table* view (which
// falls back to "all sessions" when this tab has never spawned).
let lastRenderedRecords = [];

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

function renderSessionRowHtml(rec, now) {
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
}

function renderMultiSessionRows(records) {
  if (!multiSessionRows) return;
  // Cache for the fold toggle so collapse/expand re-renders from memory
  // instead of triggering a backend fetch. Defensive copy is overkill —
  // refreshMultiSession() always passes a fresh array.
  lastRenderedRecords = Array.isArray(records) ? records : [];
  if (!records.length) {
    multiSessionRows.innerHTML = '<tr class="multi-session-empty"><td colspan="9">No tasks yet. Spawn some above.</td></tr>';
    return;
  }
  const now = Date.now() / 1000;
  // Split active (Pending/Running/anything non-terminal) from terminal
  // rows so the long tail of "Completed" can be folded behind a single
  // toggle row. Active rows always render; terminal rows render only when
  // the operator expands the section.
  const activeRecs = [];
  const terminalRecs = [];
  for (const rec of records) {
    if (TERMINAL_STATUSES.has(rec.status)) terminalRecs.push(rec);
    else activeRecs.push(rec);
  }
  const visibleActiveRecs = activeRowsCollapsed && activeRecs.length > MAX_VISIBLE_ACTIVE_ROWS
    ? activeRecs.slice(0, MAX_VISIBLE_ACTIVE_ROWS)
    : activeRecs;
  const parts = visibleActiveRecs.map((rec) => renderSessionRowHtml(rec, now));

  if (activeRecs.length > MAX_VISIBLE_ACTIVE_ROWS) {
    const collapsed = activeRowsCollapsed;
    const hiddenCount = activeRecs.length - MAX_VISIBLE_ACTIVE_ROWS;
    const toggleLabel = collapsed
      ? `Showing ${MAX_VISIBLE_ACTIVE_ROWS} of ${activeRecs.length} active — show all`
      : `Showing all ${activeRecs.length} active — collapse preview`;
    const hint = collapsed
      ? `${hiddenCount} more running/pending rows hidden to keep the interface compact`
      : 'collapse to keep the density panel compact';
    const caret = collapsed ? '▸' : '▾';
    parts.push(`
      <tr class="multi-session-fold-row" data-fold-toggle="active" aria-expanded="${collapsed ? 'false' : 'true'}">
        <td colspan="9">
          <button type="button" class="multi-session-fold-btn" data-fold-toggle="active" aria-expanded="${collapsed ? 'false' : 'true'}">
            <span class="multi-session-fold-caret">${caret}</span>
            ${escapeHtml(toggleLabel)}
          </button>
          <span class="multi-session-fold-hint">${escapeHtml(hint)}</span>
        </td>
      </tr>
    `);
  }

  if (terminalRecs.length) {
    const collapsed = completedRowsCollapsed;
    const toggleLabel = collapsed
      ? `Show ${terminalRecs.length} completed`
      : `Hide ${terminalRecs.length} completed`;
    const caret = collapsed ? '▸' : '▾';
    parts.push(`
      <tr class="multi-session-fold-row" data-fold-toggle="completed" aria-expanded="${collapsed ? 'false' : 'true'}">
        <td colspan="9">
          <button type="button" class="multi-session-fold-btn" data-fold-toggle="completed" aria-expanded="${collapsed ? 'false' : 'true'}">
            <span class="multi-session-fold-caret">${caret}</span>
            ${escapeHtml(toggleLabel)}
          </button>
          <span class="multi-session-fold-hint">terminal rows tracked by this tab</span>
        </td>
      </tr>
    `);
    if (!collapsed) {
      for (const rec of terminalRecs) parts.push(renderSessionRowHtml(rec, now));
    }
  }

  multiSessionRows.innerHTML = parts.join('');
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

    // Fold toggles for active/completed groups. Flip the local flag and
    // re-render from the cached snapshot — no backend round-trip needed.
    const foldEl = target.closest('[data-fold-toggle]');
    const foldKind = foldEl ? foldEl.getAttribute('data-fold-toggle') : '';
    if (foldKind === 'active') {
      activeRowsCollapsed = !activeRowsCollapsed;
      renderMultiSessionRows(lastRenderedRecords);
      return;
    }
    if (foldKind === 'completed') {
      completedRowsCollapsed = !completedRowsCollapsed;
      renderMultiSessionRows(lastRenderedRecords);
      return;
    }

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

if (multiSessionClearCompleted) {
  multiSessionClearCompleted.addEventListener('click', async () => {
    // "Clear completed" only drops terminal rows from this tab's tracked
    // set. We don't issue DELETEs because the backend GC handles terminal
    // sessions on its own and the operator's intent here is "shrink the
    // table" rather than "free server resources".
    const terminal = lastSessionRecords.filter((r) => TERMINAL_STATUSES.has(r.status));
    if (!terminal.length) {
      setMultiSessionStatus('No completed sessions to clear.', 'ok');
      return;
    }
    for (const rec of terminal) trackedSessionIds.delete(rec.session_id);
    setMultiSessionStatus(
      `Cleared ${terminal.length} completed session${terminal.length === 1 ? '' : 's'} from this tab.`,
      'ok'
    );
    refreshMultiSession();
  });
}

// Kick off the poll loop. refreshMultiSession() schedules the next tick,
// so we don't need a setInterval here.
if (multiSessionPanel) {
  refreshMultiSession();
}

// ---------- Agents panel (long-lived) ----------
//
// Read-only view over /api/agents. Long-lived agents render directly in
// the System A / System B architecture pools (alongside scenario primary
// rows and short-lived task rows); this also powers the "Agent" picker on
// the Tasks form. Polled on a slow timer (30s) — agents are long-lived,
// so high-frequency polling is wasted bandwidth. Picker is rebuilt on
// every poll so freshly added agents (operator runs an OpenClawInstance
// smoke test, the registry picks it up) become selectable without a page
// reload.

const agentsSummary = document.getElementById('agents-summary');

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
// Monotonic sequence guard. A manual refresh + the 30s timer can race
// when the backend is slow: an earlier in-flight request may resolve
// AFTER a newer one and overwrite a fresh successful render with stale
// data. Each call captures its own seq before the await; only the
// latest gets to mutate UI state.
let agentsRefreshSeq = 0;

async function refreshAgents() {
  const seq = ++agentsRefreshSeq;
  try {
    const body = await fetchJson(`${API_BASE}/agents`, { timeoutMs: 5000 });
    if (seq !== agentsRefreshSeq) return;
    const agents = Array.isArray(body && body.agents) ? body.agents : [];
    lastAgentRecords = agents;
    redrawSystemA();
    redrawSystemB();
    refreshAgentPicker(agents);
    if (agentsSummary) {
      const ready = agents.filter((x) => x.status === 'Ready').length;
      agentsSummary.textContent = agents.length
        ? `agents: ${agents.length} (${ready} Ready)`
        : 'agents: none registered';
    }
  } catch (err) {
    if (seq !== agentsRefreshSeq) return;
    lastAgentRecords = [];
    redrawSystemA();
    redrawSystemB();
    if (agentsSummary) {
      const noBackend = err && err.status === 404;
      agentsSummary.textContent = noBackend
        ? 'agents: backend not detected'
        : `agents: fetch failed (${err.message})`;
    }
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

refreshAgents();

// Demo-only click handler for long-lived agent rows. Toggles the
// "force-running" override so a presenter can light up specific agents
// in the architecture pool without spawning real work. Bound on the
// pool containers (which are static) so re-rendering doesn't strand
// listeners.
function repaintPersistentAgentRow(agentId) {
  // Targeted in-place replacement so the override applies even while
  // liveArchitecturePinned is true (redrawSystemA/B no-op in pinned
  // mode, and that path leaves the click feeling broken). The row
  // selector matches both pools; the persistent class scopes us away
  // from transient session rows. Long-lived agents don't contribute to
  // the vCPU bar so no capacity recompute is needed here.
  const agent = lastAgentRecords.find((a) => a && a.id === agentId);
  if (!agent) return;
  const sel = `.agent-row.persistent[data-agent-id="${CSS.escape(agentId)}"]`;
  document.querySelectorAll(sel).forEach((row) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = longLivedAgentRowHtml(agent).trim();
    const fresh = tmp.firstElementChild;
    if (fresh) row.replaceWith(fresh);
  });
}

function handleAgentRowToggle(ev) {
  const row = ev.target instanceof HTMLElement
    ? ev.target.closest('.agent-row-toggle[data-agent-id]')
    : null;
  if (!row) return;
  // Keyboard activation: Enter or Space on the role="button" row.
  if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault();
  const agentId = row.dataset.agentId;
  if (!agentId) return;
  if (agentDemoRunningOverrides.has(agentId)) {
    agentDemoRunningOverrides.delete(agentId);
  } else {
    agentDemoRunningOverrides.add(agentId);
  }
  saveAgentDemoOverrides();
  // Targeted repaint covers the pinned-architecture case; redraw the
  // pools too so the unpinned path keeps a single source of truth (no
  // harm if it no-ops).
  repaintPersistentAgentRow(agentId);
  redrawSystemA();
  redrawSystemB();
}
if (sysAAgentsEl) {
  sysAAgentsEl.addEventListener('click', handleAgentRowToggle);
  sysAAgentsEl.addEventListener('keydown', handleAgentRowToggle);
}
if (sysBOffloadEl) {
  sysBOffloadEl.addEventListener('click', handleAgentRowToggle);
  sysBOffloadEl.addEventListener('keydown', handleAgentRowToggle);
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

// ---------- Flowise chat embed ----------
//
// Wires the Flowise chatbot widget (flowise-embed) into the demo page so the
// presenter can chat against a flow without leaving the demo. Two layers of
// "off":
//   1. compose `profiles: [authoring]` — Flowise is not started; probe
//      fails and the panel stays hidden.
//   2. user has not configured a chatflow id yet — the panel is visible
//      with the input form but no chatbot rendered.
//
// Chatflow id sources (first hit wins):
//   - URL param `?chatflowId=<id>` (per-session override)
//   - localStorage key `flowiseChatflowId` (persistent)
//   - manual paste via the input in the panel
//
// The flow must be marked "Make Chatflow Public" in Flowise so that
// /api/v1/prediction/<id> answers without an API key. CORS on the Flowise
// container must include this page's origin (set CORS_ORIGINS in
// docker-compose.flowise.yaml).
const FLOWISE_CHAT_BASE_URL = 'http://127.0.0.1:3000';
const FLOWISE_CHAT_EMBED_URL =
  'https://cdn.jsdelivr.net/npm/flowise-embed/dist/web.js';
const FLOWISE_CHAT_ID_KEY = 'flowiseChatflowId';

let flowiseChatRendered = false;
let flowiseEmbedModulePromise = null;

function getFlowiseChatflowId() {
  const fromUrl = new URLSearchParams(window.location.search).get('chatflowId');
  if (fromUrl) return fromUrl.trim();
  try {
    return (localStorage.getItem(FLOWISE_CHAT_ID_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

function setFlowiseChatStatus(message, kind) {
  const el = document.getElementById('flowise-chat-status');
  if (!el) return;
  el.textContent = message || '';
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

async function loadFlowiseEmbedModule() {
  if (!flowiseEmbedModulePromise) {
    flowiseEmbedModulePromise = import(/* @vite-ignore */ FLOWISE_CHAT_EMBED_URL).catch((err) => {
      flowiseEmbedModulePromise = null;
      throw err;
    });
  }
  return flowiseEmbedModulePromise;
}

async function mountFlowiseChat(chatflowId) {
  const mount = document.getElementById('flowise-chat-mount');
  if (!mount) return;
  mount.innerHTML = '';
  flowiseChatRendered = false;

  setFlowiseChatStatus('Loading chat widget…', 'pending');
  let mod;
  try {
    mod = await loadFlowiseEmbedModule();
  } catch (_) {
    setFlowiseChatStatus(
      'Could not load flowise-embed from CDN. Check network or self-host the bundle.',
      'error'
    );
    return;
  }

  const Chatbot = mod && (mod.default || mod.Chatbot);
  if (!Chatbot || typeof Chatbot.initFull !== 'function') {
    setFlowiseChatStatus('flowise-embed module did not expose initFull().', 'error');
    return;
  }

  // initFull renders the chat into the host element rather than as a
  // floating bubble. Theme keeps the widget legible against the dark panel.
  try {
    Chatbot.initFull({
      chatflowid: chatflowId,
      apiHost: FLOWISE_CHAT_BASE_URL,
      hostElement: mount,
      theme: {
        chatWindow: {
          backgroundColor: 'transparent',
          height: 520,
          fontSize: 14,
          welcomeMessage: 'Ask the Flowise-authored agent something.',
          textInput: { placeholder: 'Type a message and hit Enter' }
        }
      }
    });
    flowiseChatRendered = true;
    setFlowiseChatStatus(`Chatflow ${chatflowId.slice(0, 8)}… loaded.`, 'ok');
  } catch (err) {
    setFlowiseChatStatus(`Failed to init chat widget: ${err && err.message ? err.message : err}`, 'error');
  }
}

async function renderFlowiseChat() {
  const panel = document.getElementById('flowise-chat-panel');
  const input = document.getElementById('flowise-chat-id-input');
  const form = document.getElementById('flowise-chat-config-form');
  const resetBtn = document.getElementById('flowise-chat-reset');
  const mount = document.getElementById('flowise-chat-mount');
  if (!panel || !form || !input || !mount) return;

  const reachable = await probeService(`${FLOWISE_CHAT_BASE_URL}/api/v1/ping`);
  if (!reachable) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  if (!form.dataset.bound) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = input.value.trim();
      if (!id) {
        setFlowiseChatStatus('Paste a chatflow id first.', 'warn');
        return;
      }
      try { localStorage.setItem(FLOWISE_CHAT_ID_KEY, id); } catch (_) {}
      mountFlowiseChat(id);
    });
    form.dataset.bound = '1';
  }

  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.addEventListener('click', () => {
      try { localStorage.removeItem(FLOWISE_CHAT_ID_KEY); } catch (_) {}
      input.value = '';
      mount.innerHTML = '';
      flowiseChatRendered = false;
      flowiseEmbedModulePromise = null;
      setFlowiseChatStatus('Cleared. Paste a new chatflow id to reload.', 'warn');
    });
    resetBtn.dataset.bound = '1';
  }

  const chatflowId = getFlowiseChatflowId();
  if (chatflowId) {
    if (!input.value) input.value = chatflowId;
    if (!flowiseChatRendered) mountFlowiseChat(chatflowId);
  } else if (!flowiseChatRendered) {
    setFlowiseChatStatus(
      'No chatflow id saved yet — paste one to load the chat.',
      'warn'
    );
  }
}

renderFlowiseChat();
// Re-probe alongside the services panel so the chat appears once Flowise
// finishes booting without requiring a hard reload.
setInterval(() => {
  if (!flowiseChatRendered) renderFlowiseChat();
}, 30_000);
