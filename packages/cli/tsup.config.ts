import { defineConfig } from 'tsup';

// Single bin entry. Output is CJS with a node shebang so package managers
// can drop the resulting `dist/index.cjs` straight into `bin/`. The
// @apicircle/* workspace deps stay external — they are published to npm
// alongside this package, so `require('@apicircle/core')` resolves to the
// installed dependency rather than a workspace .ts source file.
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
