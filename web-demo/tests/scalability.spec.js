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
