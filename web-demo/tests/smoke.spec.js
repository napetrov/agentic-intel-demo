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
});

test('each scenario card populates tool activity with at least 3 rows', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  // The two extension scenarios live inside the collapsed
  // .extensions-tray <details>. Opening it once at the top of the test
  // makes their cards clickable; the three main scenarios are visible
  // without it.
  await page.locator('details.extensions-tray summary').click();
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
