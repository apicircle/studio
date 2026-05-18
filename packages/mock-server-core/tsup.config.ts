import { defineConfig } from 'tsup';

// Dual ESM/CJS + .d.ts output. Consumed by:
//  • Electron desktop main process (Node/CJS via `require`)
//  • @apicircle/cli (Node/ESM via `import`)
//  • Future hosted-mock service (Bun/Node/Edge)
//
// The shared workspace dep keeps `@apicircle/shared` external — consumers
// have it bundled themselves.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  external: ['@apicircle/shared'],
});
