import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**'],
    // Coverage instrumentation (v8) adds significant overhead — integration
    // tests that touch the disk + child processes can blow past the default
    // 5s timeout. Bump to 30s so the suite stays green under `--coverage`.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      // `extension.ts` is activation glue (command registration, lifecycle
      // wiring) — covered by integration tests in `test/integration/`. Unit
      // tests can verify smoke activation, but the bulk of the file is dispatch
      // boilerplate where line coverage is misleading.
      //
      // Webview HTML strings (inside `webview/`) are large template literals
      // whose unit-testable surface is the message parser (covered) — the HTML
      // body itself is rendered in VS Code's webview host, not in Node tests.
      //
      // Notebook serializer's HEADER comment / display-only side is exercised
      // via integration tests.
      //
      // `test/`, `*.test.ts`, and `*.d.ts` are excluded from the measured set
      // (they're test code or type-only).
      // Only measure source files we ship — exclude config files, test
      // helpers, and the activation glue.
      include: ['src/**/*.ts'],
      exclude: [
        'src/extension.ts',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'test/**',
        'coverage/**',
        'dist/**',
        'coverage-report.mjs',
        'coverage-lowest.mjs',
        'tsup.config.ts',
        'vitest.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      // The `vscode` module is only available at runtime inside VS Code.
      // For Vitest unit tests we redirect imports to our hand-rolled mock.
      vscode: resolve(__dirname, 'test/mocks/vscode.ts'),
    },
  },
});
