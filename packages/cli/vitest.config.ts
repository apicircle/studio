import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'cli',
    environment: 'node',
    coverage: {
      ...sharedTestConfig.coverage,
      exclude: [
        ...(sharedTestConfig.coverage?.exclude ?? []),
        // The mcp action body is `ensureWorkspace + createMcpServer + connect`
        // — every building block is covered (loadWorkspace.test, the mcp-server
        // package's own suite). The full lifecycle is exercised end-to-end by
        // the P29 release smoke test rather than from this unit suite.
        'src/commands/mcp.ts',
      ],
      // The mock action handler binds a port and blocks until SIGINT, so its
      // tail is left to the release smoke. Pure helpers (`inferType`,
      // `inferFormat`, `makeSource`, `ensureWorkspace`, import command) cover
      // the rest.
      thresholds: { lines: 80, branches: 70 },
    },
  },
});
