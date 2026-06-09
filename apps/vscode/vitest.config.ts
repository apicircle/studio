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
  },
  resolve: {
    alias: {
      // The `vscode` module is only available at runtime inside VS Code.
      // For Vitest unit tests we redirect imports to our hand-rolled mock.
      vscode: resolve(__dirname, 'test/mocks/vscode.ts'),
    },
  },
});
