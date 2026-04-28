import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'mock-server-core',
    environment: 'node',
    coverage: {
      ...sharedTestConfig.coverage,
      // Plan §17 P2 acceptance: new packages hit 90 line / 80 branch — the
      // remaining branches are defensive `?? null` / optional-chain paths
      // in the OpenAPI / Postman / Insomnia parsers that v8 counts
      // strictly even though they're effectively unreachable. Same gate
      // as ui-components which has the same defensive-style codebase.
      thresholds: { lines: 90, branches: 80 },
    },
  },
});
