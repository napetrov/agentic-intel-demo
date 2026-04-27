const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:8765';

test('scalability page renders all 8 tiles + chart for default scenario', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/scalability.html');
  await expect(page.locator('h2')).toContainText(/many agents/i);

  // Tabs render with 2 scenarios
  const tabs = page.locator('#sc-tabs .sc-tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  // Instance card populated
  await expect(page.locator('#sc-instance')).toContainText(/Xeon CWF/);

  // 8 tiles
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(8);

  // Headline tile values are non-empty and look numeric/$
  await expect(tiles.first().locator('.sc-tile-value')).toContainText(/\d/);

  // Specific expected numbers from JSON for the first scenario
  await expect(page.locator('#sc-tiles')).toContainText(/24 agents/);
  await expect(page.locator('#sc-tiles')).toContainText(/\$0\.13/);
  await expect(page.locator('#sc-tiles')).toContainText(/35×|35x/);
  await expect(page.locator('#sc-tiles')).toContainText(/256,320 tasks/);

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
  await expect(page.locator('#sc-tiles')).toContainText(/22 agents/);
  await expect(page.locator('#sc-tiles')).toContainText(/\$2\.50/);
});

test('homepage hero has the Scalability story link', async ({ page }) => {
  await page.goto(BASE + '/');
  const link = page.locator('a[href="./scalability.html"]');
  await expect(link).toBeVisible();
  await expect(link).toContainText(/scalability story/i);
});

// Future-edit safety: the page is JSON-driven and editable by anyone.
// Cover two edge cases a future edit could introduce:
//  1. A scaling curve where the sweet-spot datapoint has zero throughput
//     — economic tiles must say "n/a", not "$0.00".
//  2. A scenario whose per-task cost exceeds the comparator's price —
//     the vs-comparator tile must say "more expensive", not "cheaper".

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
  vcpu: 8, memory_gb: 32, hourly_usd: 1.0, idle_cost_usd: 0,
  notes: 'test instance',
};
const BASE_WORKLOAD = {
  id: 'w', label: 'Test Workload', subtitle: 'unit-test',
  vcpu_per_agent: 1, memory_gb_per_agent: 2,
  task_duration_s: 10, tokens_per_task: 1000, human_minutes_per_task: 5,
  notes: 'test workload',
};

test('zero-throughput sweet spot renders n/a, not $0.00', async ({ page }) => {
  await injectMockScenario(page, {
    schema_version: '1',
    comparators: [{ id: 'c', label: 'Test Comparator', cost_per_1k_tasks_usd: 5.0, notes: 'n' }],
    instances: [BASE_INSTANCE],
    workloads: [BASE_WORKLOAD],
    scenarios: [{
      id: 's', label: 'Zero-throughput case', story: '',
      instance_id: 'i', workload_id: 'w',
      scaling: {
        model: 'queueing',
        max_parallel_slots: 4,
        // All datapoints have zero throughput — pathological but legal.
        datapoints: [
          { concurrency: 1, p50_s: 1, p95_s: 2, throughput_per_min: 0, utilization_pct: 0 },
          { concurrency: 2, p50_s: 1, p95_s: 2, throughput_per_min: 0, utilization_pct: 0 },
        ],
      },
      economics: { comparator_id: 'c' },
      tiles: ['cost_per_task', 'throughput', 'vs_comparator', 'daily_volume'],
    }],
  });

  await page.goto(BASE + '/scalability.html');
  const tiles = page.locator('#sc-tiles .sc-tile');
  await expect(tiles).toHaveCount(4);

  // None of the cost / throughput / volume tiles should silently render $0.
  const tilesText = await page.locator('#sc-tiles').textContent();
  expect(tilesText).not.toMatch(/\$0\.00\s*\/\s*1/);
  expect(tilesText).toMatch(/n\/a/i);
});

test('scenario more expensive than comparator says "more expensive"', async ({ page }) => {
  await injectMockScenario(page, {
    schema_version: '1',
    // Comparator is cheap; our scenario will end up *more* expensive.
    comparators: [{ id: 'c', label: 'Cheap Reference', cost_per_1k_tasks_usd: 0.05, notes: 'n' }],
    instances: [{ ...BASE_INSTANCE, hourly_usd: 10.0 }],
    workloads: [BASE_WORKLOAD],
    scenarios: [{
      id: 's', label: 'Inverted-cost case', story: '',
      instance_id: 'i', workload_id: 'w',
      scaling: {
        model: 'queueing',
        max_parallel_slots: 4,
        datapoints: [
          { concurrency: 1, p50_s: 10, p95_s: 12, throughput_per_min: 6, utilization_pct: 12 },
          { concurrency: 2, p50_s: 10, p95_s: 12, throughput_per_min: 12, utilization_pct: 25 },
        ],
      },
      economics: { comparator_id: 'c' },
      tiles: ['vs_comparator', 'cost_per_task'],
    }],
  });

  await page.goto(BASE + '/scalability.html');
  const tilesText = await page.locator('#sc-tiles').textContent();
  expect(tilesText).toMatch(/more expensive/i);
  expect(tilesText).not.toMatch(/cheaper/i);
});
