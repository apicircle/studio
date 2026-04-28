import { defineConfig } from 'tsup';

// Single bin entry. Output is CJS with a node shebang so package managers
// can drop the resulting `dist/index.cjs` straight into `bin/`. Workspace
// deps are bundled inline so the released CLI is self-contained.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  // Workspace deps: leave external — published versions resolve them at
  // install time. For platform binaries (P29 with @yao-pkg/pkg), we'll
  // bundle inline at that step.
  external: [
    '@apicircle/shared',
    '@apicircle/core',
    '@apicircle/mock-server-core',
    '@apicircle/mcp-server',
  ],
});
