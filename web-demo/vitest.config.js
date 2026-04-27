import { defineConfig } from 'vitest/config';

// Vitest only picks up tests under tests/unit/ to keep Playwright smoke
// (tests/smoke.spec.js) out of its scope — Playwright owns the e2e
// runner; Vitest only runs pure-JS units.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    reporters: 'default'
  }
});
