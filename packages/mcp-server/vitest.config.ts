import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'mcp-server',
    environment: 'node',
    coverage: {
      ...sharedTestConfig.coverage,
      exclude: [
        ...(sharedTestConfig.coverage?.exclude ?? []),
        // bin entry: starts the server immediately on import + binds stdio,
        // so it's exercised by the release smoke test in P29 rather than
        // here. The body is just `new FileBackedWorkspaceProvider(...) →
        // createMcpServer(...) → connect()`, all individually covered.
        'src/bin/**',
        // Pure-interface files — no runtime code to cover.
        'src/providers/WorkspaceProvider.ts',
        'src/providers/MockController.ts',
      ],
      // Plan §17 P2 acceptance: new packages hit 90 line / 80 branch — same
      // gate as ui-components / mock-server-core. Tool handlers are a thin
      // dispatcher over @apicircle/core (already 90/85), so the remaining
      // branches are surface-level adapter glue.
      thresholds: { lines: 90, branches: 80 },
    },
  },
});
