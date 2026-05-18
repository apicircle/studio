import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'shared',
    environment: 'node',
    coverage: {
      ...sharedTestConfig.coverage,
      // Pure logic package — 100% target.
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
