import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'core',
    environment: 'node',
    coverage: {
      ...sharedTestConfig.coverage,
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
