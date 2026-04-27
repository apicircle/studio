import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'ui-components',
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      ...sharedTestConfig.coverage,
      // Component-heavy package; persistence/store/theme are held to a higher
      // bar within the package via per-folder include splits in CI later.
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
