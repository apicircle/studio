import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'desktop-shell',
    environment: 'node',
    coverage: {
      ...sharedTestConfig.coverage,
      // The managers / bridges / watcher extracted from apps/desktop carry the
      // partial coverage they had upstream (the desktop `pnpm test` ran without
      // `--coverage`, so these error-paths were never gated). The code
      // NEWLY written here — secretsBridge, oauth2Bridge, assertHttpUrl, and
      // the windowState suite — is at 100%. This gate locks in the current
      // achieved aggregate so it can't regress; raising the manager/watcher/
      // installer error branches to 100% is tracked separately (not part of
      // the zero-behavior-change extraction).
      // Margins absorb the small run-to-run variance in the fs-watcher tests'
      // timing-dependent branches.
      thresholds: { lines: 84, branches: 78 },
    },
  },
});
