// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const SCENARIOS = ['terminal-agent', 'market-research', 'large-build-test'];

test('page loads with expected landmarks', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  await expect(page.locator('h2')).toContainText(/scenario/i);
  await expect(page.locator('#run-demo')).toBeVisible();
  await expect(page.locator('#run-demo')).toContainText(/walkthrough/i);
});

test('each scenario card populates timeline with at least 3 items', async ({ page }) => {
  await page.goto(BASE_URL + '/');
  for (const scenario of SCENARIOS) {
    await page.locator(`[data-scenario="${scenario}"]`).click();
    const count = await page.locator('#timeline li:not(.empty)').count();
    expect(count, `scenario ${scenario} should produce ≥3 timeline items`).toBeGreaterThanOrEqual(3);
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
  // Timeline should be non-empty after the walkthrough.
  const count = await page.locator('#timeline li:not(.empty)').count();
  expect(count).toBeGreaterThanOrEqual(3);
});
