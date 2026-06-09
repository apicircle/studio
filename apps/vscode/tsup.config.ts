import { defineConfig } from 'tsup';

// Build the VS Code extension entry point as a single CJS bundle. The `vscode`
// API is provided at runtime by the host process, so it must be marked
// external. `@apicircle/*` workspace packages are bundled (noExternal) so the
// .vsix is self-contained at the source-code layer.
//
// P12-1 — heavy MCP/Hono deps are EXTERNAL (not bundled). `vsce` packages
// `dependencies` into the .vsix's `node_modules`, so Node's runtime resolver
// finds them when the extension loads. The wins:
//
//   - `@modelcontextprotocol/sdk` (~500 KB) — only the embedded host (P10)
//     and the legacy stdio server consume this. Externalising removes the
//     SDK from `dist/extension.js`; resolved at runtime via standard Node
//     module resolution against the .vsix's node_modules.
//   - `@hono/node-server` + `hono` (~150 KB) — used by `mock-server-core`
//     when a mock actually starts AND by the SDK's StreamableHTTP transport.
//     Same externalise rationale.
//
// Trade-off: `dist/extension.js` shrinks but the published .vsix carries
// extra files in `node_modules`. Net byte count is similar; the WIN is
// extension activation cost — VS Code only parses `dist/extension.js`, not
// the whole node_modules tree, and the heavy deps stay on disk until the
// first `require()` fires lazily through the @apicircle/* layer.
// P12-3 redo — ESM output. VS Code 1.94+ supports ESM extensions when the
// entry file ends in `.mjs` (Node treats it as ESM regardless of the
// package's `"type"` field). We keep the package as default `commonjs` so
// test files (`*.test.ts` compiled by Vitest) and the vscode mock continue
// to run unchanged; only the bundled extension entry is ESM.
//
// `outExtension` overrides the default `.js` → `.mjs` because esbuild can't
// emit ESM `.js` without forcing `"type": "module"` at the package level,
// which would break the test runner's CJS expectations.
export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  // Disable code-splitting — a single `extension.mjs` is simpler for VS Code's
  // extension loader and matches the previous CJS single-file output. The
  // lazy-load wins are already captured by `external` (P12-1).
  splitting: false,
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  external: [
    'vscode',
    // P12-1: heavy MCP + Hono deps resolved at runtime, not bundled.
    '@modelcontextprotocol/sdk',
    '@hono/node-server',
    'hono',
  ],
  noExternal: [
    '@apicircle/core',
    '@apicircle/mcp-server',
    '@apicircle/mock-server-core',
    '@apicircle/shared',
    'yaml',
  ],
});
