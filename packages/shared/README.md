<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/shared</h1>

<p align="center">
  <strong>The TypeScript contract for everything API Circle Studio reads, writes, and ships.</strong><br />
  One package, one source of truth — types, IDs, validators, crypto, and the MCP tool catalog.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@apicircle/shared"><img src="https://img.shields.io/npm/v/@apicircle/shared?color=cb3837&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/types-included-blue?logo=typescript" alt="TypeScript types included" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen" alt="Node ≥ 20" />
  <img src="https://img.shields.io/badge/zero%20runtime%20deps-yes-success" alt="Zero runtime dependencies" />
</p>

---

## Why this package exists

Every other `@apicircle/*` package — the request engine, the mock server, the
MCP host, the CLI, the desktop app — agrees on **one workspace schema**.
That schema lives here.

If you are building a third-party tool that reads, writes, syncs, lints, or
visualises an API Circle workspace, this is the only dependency you need to
stay byte-for-byte compatible with Studio.

> **Use this directly when** you are writing a custom MCP client, a workspace
> linter, a Git pre-commit hook, a migration script, or any other tool that
> needs to understand the Studio workspace format without pulling in the
> full execution engine.

## Install

```bash
npm install @apicircle/shared
# pnpm add @apicircle/shared
# yarn add @apicircle/shared
```

Ships dual ESM + CJS builds and full `.d.ts` types. Zero runtime dependencies.

## What's in the box

| Surface              | What you get                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace schema** | `WorkspaceSynced` (the git-tracked document) and `WorkspaceLocal` (per-device state) — every entity type Studio knows about, fully typed.                                             |
| **Entity types**     | Requests, folders, environments, mock-server definitions, plans, assertions, releases, linked workspaces, global assets (schemas, GraphQL, files), history runs, secret-crypto blobs. |
| **`generateId()`**   | The only sanctioned way to mint entity IDs — collision-resistant, URL-safe, length-bounded.                                                                                           |
| **Validators**       | Lightweight shape checks for workspace documents and imported specs — handy when you're loading untrusted JSON.                                                                       |
| **Crypto helpers**   | AES-GCM via WebCrypto for at-rest secret material. Browser-safe, no Node-only modules.                                                                                                |
| **MCP catalog**      | `MCP_TOOL_NAMES` — the canonical list of every tool the MCP server exposes, plus the `McpToolName` union type. Stay in lockstep with the server, by version.                          |
| **Envelope types**   | Discriminated unions for MCP responses (`multiple-workspaces`, error envelopes, etc.) so your client gets exhaustive narrowing for free.                                              |

## A taste of it

```ts
import {
  MCP_TOOL_NAMES,
  generateId,
  type McpToolName,
  type WorkspaceSynced,
  type Request,
} from '@apicircle/shared';

// Build a request the way Studio would — same ID shape, same schema.
const req: Request = {
  id: generateId(),
  name: 'List Pets',
  method: 'GET',
  url: 'https://api.example.com/pets',
  headers: [],
  params: [],
  auth: { type: 'none' },
  bodies: {},
  activeBody: 'none',
};

// Validate a workspace document loaded from disk / Git.
const synced: WorkspaceSynced = JSON.parse(raw);

// Iterate every MCP tool the server knows about — useful for building
// custom MCP clients, dashboards, or documentation generators.
for (const name of MCP_TOOL_NAMES) {
  console.log(name); // 'workspace.list', 'request.create', 'mock.start', ...
}

function dispatch(name: McpToolName) {
  // McpToolName is a string literal union, so the switch is exhaustive.
}
```

## Where this fits in the ecosystem

```
@apicircle/shared              ◀── you are here (types + utilities)
├── @apicircle/core            (request engine, auth, imports, applyMutation)
├── @apicircle/mock-server-core (Hono mock-server runtime)
├── @apicircle/mcp-server       (MCP stdio host + tool catalog)
└── @apicircle/cli              (apicircle binary)
```

Most users will install `@apicircle/cli` or `@apicircle/mcp-server` and never
touch this package directly. You only need `@apicircle/shared` when you're
the one **building** something that talks to a Studio workspace.

## Stability

The workspace schema is the public contract API Circle Studio cares about most.
Breaking changes are versioned per [semver](https://semver.org); the schema
is exercised by **1,900+ unit and integration tests** across the wider Studio
codebase, and every Studio release (desktop, web, CLI, MCP) pins the same
`@apicircle/shared` version.

## Learn more

- **Studio repo & docs**: <https://github.com/apicircle/studio>
- **MCP tool reference**: <https://github.com/apicircle/studio/blob/main/docs/mcp-tools-reference.md>
- **Architecture overview**: <https://github.com/apicircle/studio/blob/main/docs/architecture/platform.md>

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
