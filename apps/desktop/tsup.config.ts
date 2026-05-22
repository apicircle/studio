import { defineConfig } from 'tsup';

// Bundle the Electron main + preload entries.
//
// Why a bundler instead of plain `tsc`: every workspace `@apicircle/*` package
// advertises `"main": "./src/index.ts"` so Vite (web) can consume the raw TS
// source for HMR. electron-builder packages those workspace deps into the
// asar AS-IS, so a packaged build that does `require('@apicircle/...')` at
// runtime hits the unparsable `.ts` source and crashes with
// "SyntaxError: Cannot use import statement outside a module".
//
// Bundling here inlines all workspace deps into `dist/main/{main,preload}.js`,
// which means the asar's runtime never has to chase the source-pointing
// `main` fields. Electron / electron-updater / Node built-ins remain external
// (electron is provided by the runtime; electron-updater pulls native bits
// that don't bundle cleanly and is dynamically imported by autoUpdater.ts).

export default defineConfig({
  entry: {
    'main/main': 'src/main/main.ts',
    'main/preload': 'src/main/preload.ts',
  },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Force-inline workspace packages — their `main` fields point at TS source.
  noExternal: [/^@apicircle\//],
  // Electron itself is provided by the binary; electron-updater is dynamically
  // imported and bundles poorly. Both stay resolvable from node_modules in the
  // packaged asar.
  external: ['electron', 'electron-updater'],
  // Prefer CJS entry points over ESM when bundling node_modules deps.
  // tsup defaults to `['module', 'main']` (tree-shaking-friendly), which
  // pulls @jsdevtools/ono's ESM build into our CJS bundle and crashes at
  // runtime with "Cannot convert undefined or null to object" inside
  // Object.assign — an ESM/CJS interop mismatch. Forcing `main` priority
  // lands us on the CJS build, which inlines cleanly.
  esbuildOptions(options) {
    options.mainFields = ['main', 'module'];
    options.conditions = ['require', 'node'];
  },
});
