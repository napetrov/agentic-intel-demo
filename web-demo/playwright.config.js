// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Playwright owns *.spec.js. Vitest unit tests live under tests/unit/
  // and use *.test.js — without an explicit match, Playwright would
  // try to load them and crash on the `import { ... } from 'vitest'`
  // line.
  testMatch: ['**/*.spec.js'],
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
