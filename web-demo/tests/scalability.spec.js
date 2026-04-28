const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:8765';

test('scalability page renders all 8 tiles + chart for default scenario', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/scalability.html');
  await expect(page.locator('h2')).toContainText(/many agents/i);

  // Tabs render with all scenarios (2 single-node + 3 rack-scale).
  const tabs = page.locator('#sc-tabs .sc-tab');
  await expect(tabs).toHaveCount(5);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  // Instance card populated
  await expect(page.locator('#sc-instance')).toContainText(/Xeon CWF/);

  // 8 tiles
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(8);

  // Headline tile values are non-empty and look numeric/$
  await expect(tiles.first().locator('.sc-tile-value')).toContainText(/\d/);

  // Specific expected numbers from JSON for the first CWF scenario:
  //  density = floor(min(576/1, 1536/2)) = 576 agents
  //  sweet spot at concurrency=460, throughput=3450/min
  //  daily volume = 3450 * 60 * 24 = 4,968,000 tasks
  //  api cost avoided = (4,968,000 / 1000) * $4.40 = $21,859 / day
  //  marginal cost = $0
  await expect(page.locator('#sc-tiles')).toContainText(/576 agents/);
  await expect(page.locator('#sc-tiles')).toContainText(/4,968,000 tasks/);
  await expect(page.locator('#sc-tiles')).toContainText(/\$21,859/);
  await expect(page.locator('#sc-tiles')).toContainText(/\$0/);

  // Chart has SVG content
  const paths = page.locator('#sc-chart path');
  await expect(paths).toHaveCount(2);  // p50 + p95

  // Chart note
  await expect(page.locator('#sc-chart-note')).toContainText(/under 2× baseline/i);

  // Notes panel populated
  const notes = page.locator('#sc-notes li');
  expect(await notes.count()).toBeGreaterThanOrEqual(2);

  expect(consoleErrors).toEqual([]);
});

test('switching to GNR scenario re-renders tiles + chart', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');
  const tabs = page.locator('#sc-tabs .sc-tab');
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  await expect(page.locator('#sc-instance')).toContainText(/Intel GNR/);
  // GNR scenario: density = floor(min(256/4, 1024/8)) = 64 agents
  // sweet spot at concurrency=50, throughput=66.7/min
  // daily volume = 66.7 * 60 * 24 = 96,048 tasks
  // api cost avoided = (96,048 / 1000) * $24 = $2,305 / day
  await expect(page.locator('#sc-tiles')).toContainText(/64 agents/);
  await expect(page.locator('#sc-tiles')).toContainText(/96,048 tasks/);
  await expect(page.locator('#sc-tiles')).toContainText(/\$2,305/);
});

test('rack-scale CWF scenario reports 32-node rack capacity and rack-scale volume', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');
  const tabs = page.locator('#sc-tabs .sc-tab');
  // Tab order: 0 xeon-small-density, 1 gnr-research-volume,
  // 2 xeon-cwf-rack-density, 3 gnr-rack-research, 4 mixed-rack-blend.
  await tabs.nth(2).click();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');

  // Rack scenarios show 8 tiles (rack_capacity replaces marginal_cost).
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(8);

  // Rack-capacity tile highlights the overall rack size.
  await expect(page.locator('#sc-tiles')).toContainText(/32 nodes/);
  await expect(page.locator('#sc-tiles')).toContainText(/18,432 vCPU/);
  // Density at the rack: floor(min(18432/1, 49152/2)) = 18,432 agents.
  await expect(page.locator('#sc-tiles')).toContainText(/18,432 agents/);
  // Sweet-spot throughput = 110,400/min → 158,976,000 tasks/day,
  // displacing $699,494/day on the small-comparator API.
  await expect(page.locator('#sc-tiles')).toContainText(/158,976,000 tasks/);
  await expect(page.locator('#sc-tiles')).toContainText(/\$699,494/);
});

test('mixed rack scenario shows the CWF + GNR composition breakdown', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');
  const tabs = page.locator('#sc-tabs .sc-tab');
  await tabs.nth(4).click();
  await expect(tabs.nth(4)).toHaveAttribute('aria-selected', 'true');

  // The rack-capacity tile should call out the mixed composition.
  await expect(page.locator('#sc-tiles')).toContainText(/16× Intel Xeon CWF/);
  await expect(page.locator('#sc-tiles')).toContainText(/16× Intel GNR/);
  // Density tile reflects only the 16-node CWF agent half:
  //   floor(min(9216/1, 24576/2)) = 9,216 agents.
  await expect(page.locator('#sc-tiles')).toContainText(/9,216 agents/);
});

test('homepage hero has the Scalability story link', async ({ page }) => {
  await page.goto(BASE + '/');
  const link = page.locator('a[href="./scalability.html"]');
  await expect(link).toBeVisible();
  await expect(link).toContainText(/scalability story/i);
});

// Future-edit safety: the page is JSON-driven and editable by anyone.
// Cover edge cases a future edit could introduce:
//  1. A scaling curve where the sweet-spot datapoint has zero throughput
//     — volume / api-cost tiles must say "n/a", not "$0".
//  2. A scenario without a comparator — the api-cost tile must say "n/a".
//  3. Density derives from instance + workload; JSON edits to either
//     must reshape the density tile automatically.

function injectMockScenario(page, mock) {
  // Intercept the JSON fetch and substitute a single hand-crafted
  // scenario; reuses the page's own renderer end-to-end.
  return page.route('**/scalability-data.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mock),
    });
  });
}

const BASE_INSTANCE = {
  id: 'i', label: 'Test Instance', subtitle: '8 vCPU · 32 GB',
  vcpu: 8, memory_gb: 32,
  notes: 'test instance',
};
const BASE_WORKLOAD = {
  id: 'w', label: 'Test Workload', subtitle: 'unit-test',
  vcpu_per_agent: 1, memory_gb_per_agent: 2,
  task_duration_s: 10, tokens_per_task: 1000, human_minutes_per_task: 5,
  notes: 'test workload',
};

test('zero-throughput sweet spot renders n/a, not $0', async ({ page }) => {
  await injectMockScenario(page, {
    schema_version: '2',
    comparators: [{ id: 'c', label: 'Test Comparator', cost_per_1k_tasks_usd: 5.0, notes: 'n' }],
    instances: [BASE_INSTANCE],
    workloads: [BASE_WORKLOAD],
    scenarios: [{
      id: 's', label: 'Zero-throughput case', story: '',
      instance_id: 'i', workload_id: 'w',
      scaling: {
        model: 'queueing',
        // All datapoints have zero throughput — pathological but legal.
        datapoints: [
          { concurrency: 1, p50_s: 1, p95_s: 2, throughput_per_min: 0, utilization_pct: 0 },
          { concurrency: 2, p50_s: 1, p95_s: 2, throughput_per_min: 0, utilization_pct: 0 },
        ],
      },
      economics: { comparator_id: 'c' },
      tiles: ['throughput', 'daily_volume', 'tokens_per_day', 'api_cost_avoided'],
    }],
  });

  await page.goto(BASE + '/scalability.html');
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(4);

  // None of the volume / api-cost tiles should silently render $0 / 0 tasks.
  const tilesText = await page.locator('#sc-tiles').textContent();
  expect(tilesText).not.toMatch(/\$0\s*\/\s*day/);
  expect(tilesText).not.toMatch(/0 tasks(?!\s*[×x])/);
  // n/a appears at least four times (one per tile).
  const naMatches = tilesText.match(/n\/a/gi) || [];
  expect(naMatches.length).toBeGreaterThanOrEqual(4);
});

test('api_cost_avoided tile says n/a when no comparator is configured', async ({ page }) => {
  await injectMockScenario(page, {
    schema_version: '2',
    comparators: [],
    instances: [BASE_INSTANCE],
    workloads: [BASE_WORKLOAD],
    scenarios: [{
      id: 's', label: 'No comparator', story: '',
      instance_id: 'i', workload_id: 'w',
      scaling: {
        model: 'queueing',
        datapoints: [
          { concurrency: 1, p50_s: 10, p95_s: 12, throughput_per_min: 6, utilization_pct: 12 },
          { concurrency: 2, p50_s: 10, p95_s: 12, throughput_per_min: 12, utilization_pct: 25 },
        ],
      },
      // No economics block → no comparator wired up.
      tiles: ['api_cost_avoided', 'marginal_cost'],
    }],
  });

  await page.goto(BASE + '/scalability.html');
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(2);
  const tilesText = await page.locator('#sc-tiles').textContent();
  expect(tilesText).toMatch(/n\/a/i);
  // Marginal cost tile is data-independent and always renders "$0".
  expect(tilesText).toMatch(/\$0/);
});

test('density tile fails safe when per-agent resources are zero', async ({ page }) => {
  // Regression: a JSON typo of 0 used to yield Infinity / NaN slots,
  // rendering nonsense like "∞ agents" instead of failing closed.
  await injectMockScenario(page, {
    schema_version: '2',
    comparators: [],
    instances: [BASE_INSTANCE],
    // vcpu_per_agent=0 → division would explode without the guard.
    workloads: [{ ...BASE_WORKLOAD, vcpu_per_agent: 0 }],
    scenarios: [{
      id: 's', label: 'Bad workload', story: '',
      instance_id: 'i', workload_id: 'w',
      scaling: {
        model: 'queueing',
        datapoints: [
          { concurrency: 1, p50_s: 10, p95_s: 12, throughput_per_min: 6, utilization_pct: 12 },
        ],
      },
      tiles: ['density'],
    }],
  });

  await page.goto(BASE + '/scalability.html');
  const tilesText = await page.locator('#sc-tiles').textContent();
  expect(tilesText).toMatch(/n\/a/i);
  expect(tilesText).not.toMatch(/Infinity|NaN|∞/);
});

test('density tile derives slot count from instance + workload', async ({ page }) => {
  await injectMockScenario(page, {
    schema_version: '2',
    comparators: [],
    // 16 vCPU + 32 GB; per-agent 2 vCPU / 4 GB → min(8, 8) = 8 agents.
    instances: [{ ...BASE_INSTANCE, vcpu: 16, memory_gb: 32 }],
    workloads: [{ ...BASE_WORKLOAD, vcpu_per_agent: 2, memory_gb_per_agent: 4 }],
    scenarios: [{
      id: 's', label: 'Derived density', story: '',
      instance_id: 'i', workload_id: 'w',
      scaling: {
        model: 'queueing',
        datapoints: [
          { concurrency: 1, p50_s: 10, p95_s: 12, throughput_per_min: 6, utilization_pct: 12 },
        ],
      },
      tiles: ['density'],
    }],
  });

  await page.goto(BASE + '/scalability.html');
  await expect(page.locator('#sc-tiles')).toContainText(/8 agents/);
});
