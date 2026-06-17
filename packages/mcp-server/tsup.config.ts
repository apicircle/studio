import { defineConfig } from 'tsup';

// Three entries:
//  • src/index.ts — programmatic API (createMcpServer, ToolDef, etc).
//    Bundled both ESM + CJS for use from Electron main (require) and CLI (import).
//  • src/prompts/mcpPrompts.ts — pure-data prompts catalog (no Node.js deps).
//    Sub-path export `./prompts` so ui-components can import without pulling
//    in the full mcp-server transitive deps (hono, MCP SDK) into the web build.
//  • src/bin/mcp-server.ts — stdio entry point invoked as `apicircle-mcp`.
//    CJS only with a shebang banner so node can spawn it directly.
//
// External: workspace siblings stay external; consumers bundle their own copy.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/prompts/mcpPrompts.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node20',
    external: ['@apicircle/shared', '@apicircle/core', '@apicircle/mock-server-core'],
  },
  {
    entry: { 'bin/mcp-server': 'src/bin/mcp-server.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
    external: ['@apicircle/shared', '@apicircle/core', '@apicircle/mock-server-core'],
  },
]);
