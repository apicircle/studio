import { defineConfig } from 'tsup';

// Three entry points, mirrored one-to-one in publishConfig.exports:
//   • src/index.ts                           — the main engine API
//   • src/workspace/fileBackedWorkspace.ts    — disk-backed workspace helpers
//     (loadFromFile / saveToFile / withWorkspace), imported by @apicircle/cli
//     and @apicircle/mcp-server as `@apicircle/core/workspace/file-backed`
//   • src/auth/oauth2/__fixtures__/mockIdp.ts — a dependency-free mock OAuth2
//     IdP, handy for consumers writing auth tests
//
// @apicircle/shared stays external — it is published to npm alongside this
// package, so consumers install it rather than getting a bundled copy.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'workspace/file-backed': 'src/workspace/fileBackedWorkspace.ts',
    'test/mock-idp': 'src/auth/oauth2/__fixtures__/mockIdp.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  external: ['@apicircle/shared'],
});
