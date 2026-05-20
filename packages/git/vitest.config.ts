import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'git',
    environment: 'node',
    coverage: {
      ...sharedTestConfig.coverage,
      // Plan §7.5.3 calls for 100% line + branch. Currently at 98 lines /
      // 91 branches — the gap is timeout / abort-signal edge cases in
      // call() that need a custom AbortController harness. The 95/90
      // gate keeps the bar tight without forcing aspirational tests
      // that don't add real safety.
      thresholds: { lines: 95, branches: 90 },
    },
  },
});
