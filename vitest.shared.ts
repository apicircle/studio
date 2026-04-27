// Shared Vitest defaults used by every package's vitest.config.ts.
import type { ViteUserConfig } from 'vitest/config';

export const sharedTestConfig: ViteUserConfig['test'] = {
  globals: false,
  passWithNoTests: false,
  reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'json-summary'],
    include: ['src/**/*.{ts,tsx}'],
    exclude: [
      // Test files and helpers
      'src/**/*.test.{ts,tsx}',
      'test/**',
      // Type definitions and barrel re-exports — no runtime code to cover
      'src/**/*.d.ts',
      'src/**/types.ts',
      'src/index.ts',
      'src/**/index.ts',
      // Build configs / bootstrap
      '**/*.config.{ts,js}',
      'src/main.tsx',
      // Build artifacts (defense-in-depth — should never be picked up anyway)
      'dist/**',
    ],
    // Plan §7.5.3 sets line + branch targets per area; function + statement
    // thresholds aren't in the plan and are dragged down by inline IDB
    // error-rejection callbacks (`() => reject(...)`) that fake-indexeddb
    // never triggers. We enforce the line/branch baseline that applies to
    // every area (matches the §7.5.3 floor for primitives / layout /
    // panels) and let the stricter per-area targets be tracked via
    // per-package runs rather than a single global gate.
    thresholds: {
      lines: 90,
      branches: 85,
    },
  },
};
