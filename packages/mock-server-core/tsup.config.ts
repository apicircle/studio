import { defineConfig } from 'tsup';

// Dual ESM/CJS + .d.ts output. Consumed by:
//  • Electron desktop main process (Node/CJS via `require`)
//  • API Circle Lens CLI (Node/ESM via `import`)
//  • Future hosted-mock service (Bun/Node/Edge)
//
// The shared workspace dep keeps `@apicircle/shared` external — consumers
// have it bundled themselves.
//
// Two entries: the Node root (`index.ts`, swagger-parser + Node runtime) and
// the browser-safe parsing subpath (`parsing.ts`, in-document `$ref` only),
// imported by the web/desktop renderer via `@apicircle/mock-server-core/parsing`.
export default defineConfig({
  entry: ['src/index.ts', 'src/parsing.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  external: ['@apicircle/shared'],
});
