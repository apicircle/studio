import { defineConfig } from 'tsup';

// Five entry points, mirrored one-to-one in publishConfig.exports:
//   • src/index.ts                            — the main engine API
//   • src/workspace/fileBackedWorkspace.ts     — disk-backed single-workspace
//     helpers (loadFromFile / saveToFile / withWorkspace), imported as
//     `@apicircle/core/workspace/file-backed`
//   • src/workspace/workspaceRegistry.ts       — multi-workspace registry +
//     per-id helpers, imported as `@apicircle/core/workspace/registry`
//   • src/auth/oauth2/__fixtures__/mockIdp.ts  — a dependency-free mock OAuth2
//     IdP, handy for consumers writing auth tests
//   • src/providers/index.ts                   — workspace + mock providers,
//     imported as `@apicircle/core/providers`. They live here rather than in
//     the MCP package because the free VS Code mock server and workspace
//     persistence depend on them.
//
// @apicircle/shared stays external — it is published to npm alongside this
// package, so consumers install it rather than getting a bundled copy.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'workspace/file-backed': 'src/workspace/fileBackedWorkspace.ts',
    'workspace/registry': 'src/workspace/workspaceRegistry.ts',
    'test/mock-idp': 'src/auth/oauth2/__fixtures__/mockIdp.ts',
    providers: 'src/providers/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  external: ['@apicircle/shared', '@apicircle/mock-server-core'],
});
