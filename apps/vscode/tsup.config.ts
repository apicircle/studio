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
  external: ['vscode'],
  // ESM-bundle-of-CJS compatibility shim. When tsup outputs ESM but we bundle
  // CJS deps via `noExternal` (proper-lockfile, parts of the MCP SDK,
  // @hono/node-server, etc.), esbuild rewrites their `require(...)` calls to
  // a stub that throws `Dynamic require of "X" is not supported` at runtime.
  // The banner wires Node's `createRequire(import.meta.url)` into module
  // scope so those `require()` calls resolve against real Node module
  // resolution. Without this banner, activation throws as soon as any
  // bundled CJS dep makes a dynamic require (e.g. proper-lockfile →
  // `require('path')`). The presence of this banner is pinned by a header
  // check in the bundleSize integration test.
  banner: {
    js: "import { createRequire as __apicircleCreateRequire } from 'node:module'; const require = __apicircleCreateRequire(import.meta.url);",
  },
  // P12-1 reverted: bundle the heavy MCP + Hono deps back into
  // `dist/extension.mjs` so `vsce package --no-dependencies` produces a
  // fully self-contained .vsix. The pnpm monorepo's `workspace:*` protocol
  // confuses vsce's `npm list` dep-resolution path, so we cannot rely on
  // the .vsix's `node_modules` to ship the externalized SDK + Hono. This
  // adds back ~470 KB to the bundle but eliminates a publishing-pipeline
  // failure mode.
  // EVERY runtime dependency listed in apps/vscode/package.json (other
  // than `vscode`, which the host provides) MUST appear here. We package
  // with `vsce package --no-dependencies`, so the .vsix contains no
  // `node_modules` — any import the bundle leaves external will throw
  // `Cannot find package <x>` at activation time, taking the whole
  // extension down (no commands register, no views populate). The
  // `manifestRegression` test pins this list against package.json so the
  // drift can't recur silently.
  noExternal: [
    '@apicircle/core',
    '@apicircle/git',
    '@apicircle/mcp-server',
    '@apicircle/mock-server-core',
    '@apicircle/shared',
    '@modelcontextprotocol/sdk',
    '@hono/node-server',
    'hono',
    'proper-lockfile',
    'smol-toml',
    'yaml',
  ],
});
