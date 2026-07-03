import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

// Desktop main-process tests run in node. Electron APIs are mocked per-file
// (via vi.mock in each suite). The reusable managers/bridges now live in
// `@apicircle/desktop-shell` (with their own suites); what remains here is the
// Studio-specific composition — `autoUpdater.ts` (unit-tested) plus `main.ts` /
// `preload.ts` (Electron lifecycle, exercised by the release smoke + desktop E2E).
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
