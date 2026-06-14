<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/core</h1>

<p align="center">
  <strong>An embeddable API engine — execute requests, sign auth, import specs, and mutate workspaces from any JavaScript runtime.</strong><br />
  The same engine that powers the API Circle Studio desktop app, web app, CLI, and MCP server.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@apicircle/core"><img src="https://img.shields.io/npm/v/@apicircle/core?color=cb3837&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/auth%20schemes-17-blueviolet" alt="17 auth schemes" />
  <img src="https://img.shields.io/badge/imports-OpenAPI%20%C2%B7%20Postman%20%C2%B7%20Insomnia%20%C2%B7%20cURL-blue" alt="Importers" />
  <img src="https://img.shields.io/badge/runtimes-Node%20%C2%B7%20Bun%20%C2%B7%20Browser-success" alt="Runtimes" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen" alt="Node ≥ 20" />
</p>

---

## What it is

`@apicircle/core` is the headless engine behind [API Circle Studio](https://github.com/apicircle/studio).
It does **everything an API client needs to do** — except draw a UI:

- Builds and executes HTTP requests with redirect, retry, and timeout handling.
- Signs **17 different auth schemes** end-to-end, including the full OAuth2 grant set.
- Imports **OpenAPI 3.x, Swagger 2.0, Postman v2/v2.1, Insomnia v4, and cURL** into a typed workspace.
- Mutates workspace state through a single, audited choke point (`applyMutation`).
- Runs saved execution plans headlessly — perfect for CI / regression gates.
- Reads and writes workspace JSON to disk with advisory locking, in either a single-folder or multi-workspace registry layout.

If you've ever wanted to embed "the Postman engine" inside a Node script,
a CI runner, an internal portal, or your own product — this is that engine,
typed and treeshakable.

## Install

```bash
npm install @apicircle/core @apicircle/shared
# pnpm add @apicircle/core @apicircle/shared
```

Dual ESM + CJS, full `.d.ts`, no native deps. Browser-safe — all crypto and
signing primitives run on WebCrypto.

## What you can do with it

### Execute any request, with real auth

```ts
import { executeRequest } from '@apicircle/core';

const result = await executeRequest({
  method: 'POST',
  url: 'https://api.example.com/charges',
  headers: [{ key: 'X-Idempotency-Key', value: 'k-001' }],
  body: { kind: 'json', json: { amount: 4200, currency: 'usd' } },
  auth: {
    type: 'oauth2',
    grant: 'client_credentials',
    clientId: 'cid',
    clientSecret: 'csec',
    tokenUrl: 'https://auth.example.com/token',
    scope: 'charges:write',
  },
});

console.log(result.response.status, result.response.bodyText);
```

Behind the scenes the engine acquires a token, caches it for its TTL,
refreshes it transparently when it expires, and signs the request. Every
other auth scheme — Bearer, Basic, API key, custom header, AWS SigV4, Digest
(with `stale=true` nonce rotation), NTLM (with the full 3-message handshake +
MIC), Hawk, JWT — works the same way: declarative config in, signed request out.

### The 17 auth schemes, in one place

| Family      | Schemes                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| Token       | Bearer, API key, custom header                                                                               |
| Credentials | Basic, Digest (MD5/SHA-256/SHA-512-256), NTLM v2, Hawk                                                       |
| AWS         | SigV4 (header & query)                                                                                       |
| JWT         | HS / RS / ES / PS family, custom claims                                                                      |
| OAuth2      | Client Credentials, Authorization Code (+ PKCE), Password, Implicit, Device Code, Refresh, `private_key_jwt` |
| None        | …because sometimes the API just lets you in                                                                  |

Every implementation is verified against the original RFCs (1320, 1321, 2202,
2617, 7616, 7636, [MS-NLMP]) plus NIST CAVS vectors and Mozilla's Hawk
fixtures. See [`docs/auth.md`](https://github.com/apicircle/studio/blob/main/docs/auth.md)
for the full matrix.

### Import a spec, get a typed collection

```ts
import { importOpenApi, importPostman, importInsomnia, importCurl } from '@apicircle/core';

const { requests, folders, warnings } = await importOpenApi(rawYamlOrJson, {
  format: 'yaml',
});
```

All four importers return the same typed shape, ready to merge into a
workspace with `applyMutation`.

### Run a saved plan in CI

```ts
import { runPlan, loadFromFile } from '@apicircle/core/workspace/file-backed';

const { synced, local } = await loadFromFile('./workspace');
const planId = synced.plans.find((p) => p.name === 'Smoke Tests')!.id;

const result = await runPlan({ synced, local }, planId, { bail: true });
process.exit(result.passed ? 0 : 1);
```

Plans chain requests, evaluate assertions, and pass extracted variables
forward — exit code 0 on green, non-zero on red. Drop it straight into GitHub
Actions, GitLab CI, or any pipeline.

### Mutate workspace state — one function, every entity

```ts
import { applyMutation, generateId } from '@apicircle/core';

const next = applyMutation(state, {
  kind: 'request.create',
  id: generateId(),
  name: 'List Users',
  parentFolderId: null,
  method: 'GET',
  url: 'https://api.example.com/users',
});
```

`WorkspacePatch` is a discriminated union over `request.* | folder.* |
environment.* | assertion.* | mock.* | plan.*`. Adding a new entity in your
own UI? One union variant + one switch case. The CLI, MCP server, and desktop
app all flow through this single function — it's the audit log seam.

## Entry points

```ts
// Engine API
import { executeRequest, applyMutation, runPlan } from '@apicircle/core';

// Disk-backed single-workspace helpers (load/save/withWorkspace under an advisory lock)
import { loadFromFile, saveToFile, withWorkspace } from '@apicircle/core/workspace/file-backed';

// Multi-workspace registry (registry.json + per-id subdirectories)
import {
  defaultApicircleRoot,
  loadRegistry,
  saveRegistry,
  loadWorkspaceById,
  saveWorkspaceById,
  registerWorkspace,
  setActiveWorkspace,
  deleteWorkspaceById,
  findWorkspaceEntry,
  workspaceDirFor,
  type WorkspaceRegistry,
} from '@apicircle/core/workspace/registry';
```

- **`/workspace/file-backed`** — one workspace, one folder. `proper-lockfile`
  advisory locking, so concurrent CLI runs don't corrupt each other.
- **`/workspace/registry`** — many workspaces, one root. `registry.json` at
  the top, `workspaces/<id>/` subdirectories underneath. All surfaces
  (desktop, CLI, MCP, VS Code) default to `~/.apicircle/` via
  `defaultApicircleRoot()`.

## Use cases

- Build an **internal API explorer** for your engineering team.
- Run **regression smoke tests** against staging in CI, with real OAuth2.
- Generate a **runtime mock** from an OpenAPI spec on the fly.
- Embed an **AI-powered request authoring** flow in your own product.
- Migrate a Postman library into a typed, Git-trackable workspace.
- Lint or validate workspaces in a pre-commit hook.

## Where it fits

```
@apicircle/shared              (types + IDs + crypto + MCP catalog)
└── @apicircle/core            ◀── you are here
    ├── @apicircle/mcp-server  (wraps core as MCP tools)
    ├── @apicircle/cli         (wraps core as a CLI binary)
    └── @apicircle/mock-server-core (sister package — mock-server engine)
```

## Stability & test coverage

- **1,911 unit + integration tests** in the OAuth2 / signing / executor suites
  alone (mock IdP exercises every grant, every refresh path, every CSRF guard).
- Every auth primitive is **CAVS-verified** against the original spec vectors.
- The engine is built ESM-first and ships dual CJS bundles for legacy consumers.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
