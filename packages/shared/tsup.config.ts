import { defineConfig } from 'tsup';

// Dual ESM/CJS + .d.ts output. @apicircle/shared has no runtime
// dependencies, so the published bundle resolves entirely from itself.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
});
