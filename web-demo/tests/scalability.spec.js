const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:8765';

test('scalability page renders the default scenario tiles + chart', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/scalability.html');
  await expect(page.locator('h2')).toContainText(/scaled out/i);

  // Tabs render with all scenarios (2 single-node + 3 rack-scale).
  const tabs = page.locator('#sc-tabs .sc-tab');
  await expect(tabs).toHaveCount(5);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  // Instance card populated, without the old hardware ownership wording.
  await expect(page.locator('#sc-instance')).toContainText(/Xeon CWF/);
  await expect(page.locator('#sc-instance')).not.toContainText(/owned hardware/i);

  // Single-node CWF scenario shows 6 compute tiles (no economics).
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(6);

  // Headline tile values are non-empty and look numeric.
  await expect(tiles.first().locator('.sc-tile-value')).toContainText(/\d/);

  // Specific expected numbers from JSON for the first CWF scenario:
  //  density = floor(min(576/1, 1536/2)) = 576 agents
  //  sweet spot at concurrency=460, throughput=3450/min
  //  daily volume = 3450 * 60 * 24 = 4,968,000 tasks
  await expect(page.locator('#sc-tiles')).toContainText(/576 agents/);
  await expect(page.locator('#sc-tiles')).toContainText(/4,968,000 tasks/);

  // Money / cost framing is intentionally absent from the page.
  const pageText = (await page.locator('main').textContent()) || '';
  expect(pageText).not.toMatch(/\$\d/);
  expect(pageText).not.toMatch(/API cost|cost avoided|frontier-API spend|marginal cost/i);

  // Chart has SVG content.
  const paths = page.locator('#sc-chart path');
  await expect(paths).toHaveCount(2);  // p50 + p95

  // Chart note.
  await expect(page.locator('#sc-chart-note')).toContainText(/under 2× baseline/i);

  // Notes panel populated.
  const notes = page.locator('#sc-notes li');
  expect(await notes.count()).toBeGreaterThanOrEqual(2);

  expect(consoleErrors).toEqual([]);
});

test('switching to GNR scenario re-renders tiles + chart', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');
  const gnrTab = page.locator('#sc-tabs .sc-tab[data-id="gnr-research-volume"]');
  await gnrTab.click();
  await expect(gnrTab).toHaveAttribute('aria-selected', 'true');

  await expect(page.locator('#sc-instance')).toContainText(/Intel GNR/);
  // GNR scenario: density = floor(min(256/4, 1024/8)) = 64 agents
  // sweet spot at concurrency=50, throughput=66.7/min
  // daily volume = 66.7 * 60 * 24 = 96,048 tasks
  await expect(page.locator('#sc-tiles')).toContainText(/64 agents/);
  await expect(page.locator('#sc-tiles')).toContainText(/96,048 tasks/);
});

test('rack-scale CWF scenario reports 32-node rack capacity and rack-scale volume', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');
  // Tabs are rendered with data-id=<scenario.id>; selecting by id keeps
  // this test stable if scenarios get reordered in the JSON.
  const cwfRackTab = page.locator('#sc-tabs .sc-tab[data-id="xeon-cwf-rack-density"]');
  await cwfRackTab.click();
  await expect(cwfRackTab).toHaveAttribute('aria-selected', 'true');

  // Rack scenarios show 7 tiles (rack_capacity prepended to the
  // single-node 6-tile set).
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(7);

  // Rack-capacity tile highlights the overall rack size.
  await expect(page.locator('#sc-tiles')).toContainText(/32 nodes/);
  await expect(page.locator('#sc-tiles')).toContainText(/18,432 vCPU/);
  // Density at the rack: floor(min(18432/1, 49152/2)) = 18,432 agents.
  await expect(page.locator('#sc-tiles')).toContainText(/18,432 agents/);
  // Sweet-spot throughput = 110,400/min → 158,976,000 tasks/day.
  await expect(page.locator('#sc-tiles')).toContainText(/158,976,000 tasks/);
});

test('mixed rack scenario shows the CWF + GNR composition breakdown', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');
  const mixedRackTab = page.locator('#sc-tabs .sc-tab[data-id="mixed-rack-blend"]');
  await mixedRackTab.click();
  await expect(mixedRackTab).toHaveAttribute('aria-selected', 'true');

  // The rack-capacity tile should call out the mixed composition.
  await expect(page.locator('#sc-tiles')).toContainText(/16× Intel Xeon CWF/);
  await expect(page.locator('#sc-tiles')).toContainText(/16× Intel GNR/);
  // Density tile reflects only the 16-node CWF agent half:
  //   floor(min(9216/1, 24576/2)) = 9,216 agents.
  await expect(page.locator('#sc-tiles')).toContainText(/9,216 agents/);
});

test('demo setup follows the selected scenario and renders live tiles', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');

  // Builder is now merged into the scenario overview panel as the selected demo setup.
  await expect(page.locator('#sc-builder-title')).toContainText(/demo setup/i);
  await expect(page.locator('#sc-builder-title')).toContainText(/rack builder/i);

  // The default scenario is the single-node CWF case, so setup starts at 1× CWF.
  const summary = page.locator('#sc-builder-summary');
  await expect(summary).toContainText(/1× CWF/);
  await expect(summary).toContainText(/0× GNR/);
  await expect(summary).toContainText(/1 of 38 usable U occupied/);

  // Rack viz contains 42 U slots; one is tagged as CWF and none as GNR.
  await expect(page.locator('#sc-builder-rack > div')).toHaveCount(42);
  await expect(page.locator('#sc-builder-rack .sc-rack-u-cwf')).toHaveCount(1);
  await expect(page.locator('#sc-builder-rack .sc-rack-u-gnr')).toHaveCount(0);

  // Tiles recompute from the selected setup.
  const tiles = page.locator('#sc-builder-tiles .sc-tile');
  await expect(tiles).toHaveCount(4);
  await expect(page.locator('#sc-builder-tiles')).toContainText(/1 nodes/);
  await expect(page.locator('#sc-builder-tiles')).toContainText(/576 vCPU/);
  await expect(page.locator('#sc-builder-tiles')).toContainText(/5\.0 M tasks/);

  // Switching to the mixed rack preset updates setup counts and totals too.
  await page.locator('#sc-tabs .sc-tab[data-id="mixed-rack-blend"]').click();
  await expect(summary).toContainText(/16× CWF/);
  await expect(summary).toContainText(/16× GNR/);
  await expect(page.locator('#sc-builder-tiles')).toContainText(/32 nodes/);
  await expect(page.locator('#sc-builder-tiles')).toContainText(/13,312 vCPU/);
});

test('rack builder updates live when nodes are added or removed', async ({ page }) => {
  await page.goto(BASE + '/scalability.html');
  const cwfCount = page.locator('[data-id="count-cwf"]');
  const cwfInc = page.locator('[data-id="inc-cwf"]');

  await expect(cwfCount).toHaveText('1');

  // Add one CWF node — count, rack viz, and setup totals should update.
  await cwfInc.click();
  await expect(cwfCount).toHaveText('2');
  await expect(page.locator('#sc-builder-rack .sc-rack-u-cwf')).toHaveCount(2);
  await expect(page.locator('#sc-builder-tiles')).toContainText(/2 nodes/);
  await expect(page.locator('#sc-builder-tiles')).toContainText(/1,152 vCPU/);

  // Add and then remove a GNR node; rack viz should follow the count.
  const gnrInc = page.locator('[data-id="inc-gnr"]');
  const gnrDec = page.locator('[data-id="dec-gnr"]');
  await gnrInc.click();
  await expect(page.locator('[data-id="count-gnr"]')).toHaveText('1');
  await expect(page.locator('#sc-builder-rack .sc-rack-u-gnr')).toHaveCount(1);
  await gnrDec.click();
  await expect(page.locator('[data-id="count-gnr"]')).toHaveText('0');
  await expect(gnrDec).toBeDisabled();
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
//     — daily volume / tokens tiles must say "n/a", not "0 tasks".
//  2. Density derives from instance + workload; JSON edits to either
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

test('zero-throughput sweet spot renders n/a, not 0 tasks', async ({ page }) => {
  await injectMockScenario(page, {
    schema_version: '3',
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
      tiles: ['throughput', 'daily_volume', 'tokens_per_day'],
    }],
  });

  await page.goto(BASE + '/scalability.html');
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(3);

  // No tile should silently render "0 tasks" — must say "n/a" honestly.
  const tilesText = await page.locator('#sc-tiles').textContent();
  expect(tilesText).not.toMatch(/0 tasks(?!\s*[×x])/);
  // n/a appears at least three times (one per tile).
  const naMatches = tilesText.match(/n\/a/gi) || [];
  expect(naMatches.length).toBeGreaterThanOrEqual(3);
});

test('density tile fails safe when per-agent resources are zero', async ({ page }) => {
  // Regression: a JSON typo of 0 used to yield Infinity / NaN slots,
  // rendering nonsense like "∞ agents" instead of failing closed.
  await injectMockScenario(page, {
    schema_version: '3',
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
    schema_version: '3',
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
