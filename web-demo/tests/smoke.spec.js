// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const SCENARIOS = ['terminal-agent', 'market-research', 'large-build-test', 'taskflow-pull'];

async function expectToolRowsAtLeast(page, min, message) {
  const rows = page.locator('#tool-activity .tool-row:not(.empty)');
  await expect.poll(async () => rows.count(), { message, timeout: 5000 })
    .toBeGreaterThanOrEqual(min);
}

test('page loads with expected landmarks', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  // Hero thesis (the demo's headline claim) and the first scenario card
  // are the two landmarks that mark a successful page load. The old
  // "Pick a scenario..." h2 was replaced by the thesis line; the
  // scenario picker now lives in the .scenario-card row below it.
  await expect(page.locator('h2.hero-thesis')).toContainText(/agents on Intel/i);
  await expect(page.locator('.scenario-card').first()).toBeVisible();
  await expect(page.locator('#run-demo')).toBeVisible();
  await expect(page.locator('#run-demo')).toContainText(/run demo/i);

  // Density is a secondary fan-out control, so it stays below the live-log
  // workspace instead of interrupting the main demo flow.
  const densityAfterWorkspace = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace');
    const density = document.querySelector('#multi-session-panel');
    return Boolean(workspace && density && (workspace.compareDocumentPosition(density) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(densityAfterWorkspace).toBe(true);
});

test('each scenario card populates tool activity with at least 3 rows', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  // The two extension scenarios live inside the collapsed
  // .extensions-tray <details>. Open it only when actually closed so
  // we don't toggle it shut if a future change ships it open by
  // default. The three main scenario cards are visible without this.
  const tray = page.locator('details.extensions-tray');
  const isOpen = await tray.evaluate((el) => el.open);
  if (!isOpen) {
    await tray.locator('summary').click();
  }
  for (const scenario of SCENARIOS) {
    await page.locator(`[data-scenario="${scenario}"]`).click();
    // Selecting a scenario must NOT preload command output — the log stays
    // on the placeholder until the user explicitly clicks Run demo.
    await expect(page.locator('#command-log')).toContainText(/press "run demo"/i);
    await expect(page.locator('#command-log')).not.toContainText(/openclaw demo run/i);
    await expectToolRowsAtLeast(page, 3, `scenario ${scenario} should produce >=3 tool rows`);
    await expect(page.locator('#result')).not.toHaveText(/waiting/i);
  }
});

test('density session table renders a bounded active preview', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/api/sessions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      backend: 'test',
      sessions: Array.from({ length: 30 }, (_, i) => ({
        session_id: `density-${String(i + 1).padStart(2, '0')}`,
        scenario: 'terminal-agent',
        profile: 'small',
        target_system: 'system_a',
        agent_id: null,
        status: 'Running',
        pod_name: `density-pod-${i + 1}`,
        created_at: now - i,
      })),
    }),
  }));
  await page.route('**/api/agents', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ agents: [] }),
  }));

  await page.goto(BASE_URL + '/');
  await expect(page.locator('#multi-session-summary')).toContainText(/Tracked: 30/);
  await expect(page.locator('#multi-session-rows tr').filter({ has: page.locator('td code') })).toHaveCount(12);
  await expect(page.locator('button[data-fold-toggle="active"]')).toContainText(/Showing 12 of 30 active/i);
  await expect(page.locator('#multi-session-rows')).not.toContainText(/density-30/);

  await page.locator('button[data-fold-toggle="active"]').click();
  await expect(page.locator('#multi-session-rows tr').filter({ has: page.locator('td code') })).toHaveCount(30);
  await expect(page.locator('#multi-session-rows')).toContainText(/density-30/);
});

test('run walkthrough replays the selected scenario', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  await page.locator('[data-scenario="market-research"]').click();
  await expect(page.locator('#data-mode')).toHaveText('Scenario: market-research');

  const btn = page.locator('#run-demo');
  const originalLabel = (await btn.textContent() || '').trim();
  await btn.click();
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText(/running/i);
  // Walkthrough replays the selected scenario across its timeline phases.
  await expect(btn).toBeEnabled({ timeout: 20000 });
  await expect(btn).toHaveText(originalLabel);
  await expect(page.locator('#result')).toContainText(/market research/i);
  await expectToolRowsAtLeast(page, 3, 'walkthrough should leave >=3 tool rows');
});
