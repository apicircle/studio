import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

// Desktop main-process tests run in node. Electron APIs are mocked per-file
// (see __mocks__/electron.ts via vi.mock in each suite). Workspace deps
// (`@apicircle/mock-server-core`, `@apicircle/mcp-server`) resolve to TS
// source through the workspace symlinks — vitest transpiles them on the fly.
export default defineConfig({
  test: {
    ...sharedTestConfig,
    name: 'desktop',
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
    coverage: {
      ...sharedTestConfig.coverage,
      include: ['src/main/**/*.ts'],
      exclude: [
        ...(sharedTestConfig.coverage?.exclude ?? []),
        // main.ts wires Electron lifecycle events; exercised by P29 release smoke
        // tests. Unit-testing it would require booting Electron.
        'src/main/main.ts',
        'src/main/preload.ts',
      ],
      thresholds: { lines: 90, branches: 80 },
    },
  },
});
