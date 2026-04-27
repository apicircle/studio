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
      // Phase placeholder panels — empty PanelStub wrappers replaced by real
      // components in their target phase. Each gets real tests when it ships.
      '**/panels/env/**',
      '**/panels/execution/**',
      '**/panels/help/**',
      '**/panels/history/**',
      '**/panels/editor/**',
      '**/panels/link-workspace/**',
    ],
    thresholds: {
      lines: 90,
      branches: 85,
      functions: 90,
      statements: 90,
    },
  },
};
