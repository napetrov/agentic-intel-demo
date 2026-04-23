// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const SCENARIOS = ['terminal-agent', 'market-research', 'large-build-test'];

async function expectToolRowsAtLeast(page, min, message) {
  const rows = page.locator('#tool-activity .tool-row:not(.empty)');
  await expect.poll(async () => rows.count(), { message, timeout: 5000 })
    .toBeGreaterThanOrEqual(min);
}

test('page loads with expected landmarks', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  await expect(page.locator('h2')).toContainText(/scenario/i);
  await expect(page.locator('#run-demo')).toBeVisible();
  await expect(page.locator('#run-demo')).toContainText(/walkthrough/i);
});

test('each scenario card populates tool activity with at least 3 rows', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  for (const scenario of SCENARIOS) {
    await page.locator(`[data-scenario="${scenario}"]`).click();
    await expectToolRowsAtLeast(page, 3, `scenario ${scenario} should produce >=3 tool rows`);
    await expect(page.locator('#result')).not.toHaveText(/waiting/i);
  }
});

test('run animated walkthrough disables then re-enables the button', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  const btn = page.locator('#run-demo');
  const originalLabel = (await btn.textContent() || '').trim();
  await btn.click();
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText(/running/i);
  // Full walkthrough runs in ~11.6s of staged steps + 250ms cleanup.
  await expect(btn).toBeEnabled({ timeout: 20000 });
  await expect(btn).toHaveText(originalLabel);
  await expectToolRowsAtLeast(page, 3, 'walkthrough should leave >=3 tool rows');
});
