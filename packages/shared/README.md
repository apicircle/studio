<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle" width="120" height="120" />
</p>

<h1 align="center">@apicircle/shared</h1>

<p align="center">
  <strong>The TypeScript contract for everything API Circle reads, writes, and ships.</strong><br />
  One package, one source of truth — types, IDs, field validators, auth and mock defaults, and legacy MCP names kept for compatibility.
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
desktop app, web app, VS Code extension, and the paid `apicircle-lens` CLI and
MCP server — agrees on **one workspace schema**. That schema lives here.

If you are building a third-party tool that reads, writes, syncs, lints, or
visualises an API Circle workspace, this is the only dependency you need to
stay byte-for-byte compatible with it.

> **MCP status:** this repository ships no MCP server; MCP is a paid
> [Lens feature of API Circle](https://apicircle.dev/lens). The MCP names here
> are retained as legacy shared API so existing consumers do not break.
>
> **Use this directly when** you are writing a workspace
> linter, a Git pre-commit hook, a migration script, or any other tool that
> needs to understand the workspace format without pulling in the
> full execution engine.

## Install

```bash
npm install @apicircle/shared
# pnpm add @apicircle/shared
# yarn add @apicircle/shared
```

Ships dual ESM + CJS builds and full `.d.ts` types. Zero runtime dependencies.

## What's in the box

| Surface              | What you get                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace schema** | `WorkspaceSynced` (the git-tracked document) and `WorkspaceLocal` (per-device state) — every entity type the workspace knows about, fully typed.                                                                                                  |
| **Entity types**     | Requests, folders, environments, mock-server definitions, plans, assertions, releases, linked workspaces, global assets (schemas, GraphQL, files, spec assets, and their referenced files after npm 2.0.0), history runs, secret-crypto metadata. |
| **`generateId()`**   | The only sanctioned way to mint entity IDs — a UUID v4 (`crypto.randomUUID()` where available).                                                                                                                                                   |
| **Validators**       | Field validators (URLs, AWS regions, mock paths, env-var names, header names, JSON, JSON paths, regexes, durations) returning a `ValidationResult`.                                                                                               |
| **Auth defaults**    | `REQUEST_AUTH_TYPES`, `defaultAuthFor(type)` and `normalizeAuth(input)` for the 15 auth schemes plus `none` and `inherit`.                                                                                                                        |
| **Mock helpers**     | Mock-server types, default responses and request schemas, and `requestShapeFromMockEndpoint` (a mock endpoint as a request's method, URL, query, headers and path params).                                                                        |
| **Spec references**  | `specRefTargetKind(target)` (after npm 2.0.0) — whether a split spec's `$ref` target is a JSON/YAML `'document'`, a `'text'` document (Markdown, plain text, HTML, a code sample's source) or `'unknown'`, by its extension.                      |
| **Constants**        | `RUN_HIDDEN_VALUE` (`[hidden]`, what History shows for a secret; after npm 2.0.0), `WORKSPACE_SHARING_ENABLED` (`false` in shipped builds), `GIT_HOST_KINDS` / `GIT_HOST_LABELS`.                                                                 |
| **Legacy MCP names** | `MCP_TOOL_NAMES`, `McpToolName` and `McpError` (the `{ code, message, details }` error shape) remain for backward-compatible shared API.                                                                                                          |

## A taste of it

```ts
import {
  MCP_TOOL_NAMES,
  generateId,
  type McpToolName,
  type WorkspaceSynced,
  type Request,
} from '@apicircle/shared';

// Build a request the way API Circle would — same ID shape, same schema.
const now = new Date().toISOString();
const req: Request = {
  id: generateId(),
  name: 'List Pets',
  folderId: null,
  method: 'GET',
  url: 'https://api.example.com/pets',
  headers: [],
  query: [],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
  contextVars: [],
  extractions: [],
  assertions: [],
  createdAt: now,
  updatedAt: now,
};

// Type a workspace document loaded from disk / Git.
declare const raw: string; // the text of a workspace.json
const synced: WorkspaceSynced = JSON.parse(raw);

// Iterate the legacy catalogue of MCP tool names (kept for compatibility).
for (const name of MCP_TOOL_NAMES) {
  console.log(name); // 'workspace.list', 'request.create', 'mock.start', ...
}

function dispatch(name: McpToolName) {
  // McpToolName is a string literal union, so a `switch (name)` over it can be checked for exhaustiveness.
}
```

## Where this fits in the ecosystem

```
@apicircle/shared              ◀── you are here (types + utilities)
├── @apicircle/core            (request engine, auth, imports, applyMutation)
├── @apicircle/mock-server-core (Hono mock-server runtime)
└── the apicircle-lens CLI and MCP server (paid Lens features of API Circle)
```

This repository no longer publishes `@apicircle/cli` or `@apicircle/mcp-server`;
the CLI and MCP server are paid [Lens features of API Circle](https://apicircle.dev/lens).
You only need `@apicircle/shared` when you're the one **building** something
that talks to an API Circle workspace.

## Stability

The workspace schema is the public contract API Circle cares about most.
Breaking changes are versioned per [semver](https://semver.org); the schema
is exercised by **1,900+ unit and integration tests** across the wider
codebase, and every release (desktop and web) pins the same
`@apicircle/shared` version.

## Learn more

- **Repository & docs**: <https://github.com/apicircle/studio>
- **MCP status**: MCP is a paid Lens feature of API Circle — <https://apicircle.dev/lens>.
- **Architecture overview**: <https://github.com/apicircle/studio/blob/main/docs/architecture/platform.md>

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
