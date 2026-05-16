import { defineConfig } from 'tsup';

// Single bin entry. Output is CJS with a node shebang so package managers
// can drop the resulting `dist/index.cjs` straight into `bin/`. Workspace
// deps are bundled inline so the released CLI is self-contained — Node
// spawns the binary standalone (no workspace TS resolver in front), so
// `require('@apicircle/shared')` MUST resolve to bundled JS, not a .ts
// source file. The same reasoning applies to mcp-server/dist/bin.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: [
    '@apicircle/shared',
    '@apicircle/core',
    '@apicircle/mock-server-core',
    '@apicircle/mcp-server',
  ],
});
