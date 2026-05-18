import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

// apps/web has minimal in-process test surface (App.test, main.test) — the
// real coverage lives in packages/ui-components. The Playwright specs in
// e2e/ have to be excluded explicitly so vitest doesn't try to collect
// them as unit tests.

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    passWithNoTests: true,
  },
});
