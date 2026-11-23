<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle" width="120" height="120" />
</p>

<h1 align="center">@apicircle/core</h1>

<p align="center">
  <strong>An embeddable API engine — execute requests, sign auth, parse collections, and mutate workspaces from any JavaScript runtime.</strong><br />
  The same engine that powers API Circle's desktop app, web app, and VS Code extension. The paid <code>apicircle-lens</code> CLI and MCP server compose this core through the public package boundary.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@apicircle/core"><img src="https://img.shields.io/npm/v/@apicircle/core?color=cb3837&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/auth%20schemes-15-blueviolet" alt="15 auth schemes" />
  <img src="https://img.shields.io/badge/imports-Postman%20%C2%B7%20Insomnia%20%C2%B7%20cURL%20%C2%B7%20API%20Circle-blue" alt="Importers" />
  <img src="https://img.shields.io/badge/runtimes-Node%20%C2%B7%20Bun%20%C2%B7%20Browser-success" alt="Runtimes" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen" alt="Node ≥ 20" />
</p>

---

## What it is

`@apicircle/core` is the headless engine behind [API Circle](https://github.com/apicircle/studio),
the free, source-available API workspace.
It does **everything an API client needs to do** — except draw a UI:

- Builds and executes HTTP requests with redirect and timeout handling.
- Signs **15 auth schemes** end-to-end (plus No Auth and Inherit), including the full OAuth2 grant set.
- Parses **Postman v2.x collections and environments, Insomnia v4 exports, cURL commands, and API Circle folder / environment exports** (`.apicircle.json`). OpenAPI / Swagger parsing is in [`@apicircle/mock-server-core`](https://www.npmjs.com/package/@apicircle/mock-server-core).
- Mutates workspace state through a single, audited choke point (`applyMutation`).
- Runs saved execution plans headlessly — perfect for CI / regression gates.
- Reads and writes workspace JSON to disk with advisory locking, in either a single-folder or multi-workspace registry layout.
- Keeps secrets out of Git and history: scans a workspace for credential-shaped values before a push, and hides them in a run before it is saved.

If you've ever wanted to embed "the Postman engine" inside a Node script,
a CI runner, an internal portal, or your own product — this is that engine,
typed and treeshakable.

## Install

```bash
npm install @apicircle/core @apicircle/shared
# pnpm add @apicircle/core @apicircle/shared
```

Dual ESM + CJS, full `.d.ts`, no native deps. Browser-safe — all crypto and
signing primitives run on WebCrypto. Depends on `@apicircle/shared` and
`@apicircle/mock-server-core`.

## What you can do with it

### Execute any request, with real auth

```ts
import { executeRequest, runClientCredentials } from '@apicircle/core';
import { generateId, type Request } from '@apicircle/shared';

const token = await runClientCredentials({
  tokenUrl: 'https://auth.example.com/token',
  clientId: 'cid',
  clientSecret: 'csec',
  scope: 'charges:write',
});

const now = new Date().toISOString();
const req: Request = {
  id: generateId(),
  name: 'Create charge',
  folderId: null,
  method: 'POST',
  url: 'https://api.example.com/charges',
  headers: [{ key: 'X-Idempotency-Key', value: 'k-001', enabled: true }],
  query: [],
  body: { type: 'json', content: JSON.stringify({ amount: 4200, currency: 'usd' }) },
  auth: {
    type: 'oauth2-client-credentials',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'cid',
    clientSecret: 'csec',
    scope: 'charges:write',
    clientAuthMethod: 'header',
    accessToken: token.accessToken,
    tokenType: token.tokenType,
    refreshToken: token.refreshToken ?? '',
    expiresAt: token.expiresIn ? Date.now() + token.expiresIn * 1000 : null,
    obtainedScope: token.scope ?? '',
  },
  contextVars: [],
  extractions: [],
  assertions: [],
  createdAt: now,
  updatedAt: now,
};

const result = await executeRequest(req);
console.log(result.status, result.body);
```

`executeRequest` signs the request with the token you supply. When the auth
carries a refresh token and is within a minute of `expiresAt`, it refreshes
first and reports the new token through `authOptions.onTokenRefreshed`. Every
other auth scheme — Bearer, Basic, API key, custom header, AWS SigV4, Digest
(with `stale=true` nonce rotation), NTLM (with the full 3-message handshake +
MIC), Hawk, JWT — works the same way: declarative config in, signed request out.

### The 15 auth schemes (plus No Auth and Inherit), in one place

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

### Parse a collection

```ts
import { parsePostmanCollection } from '@apicircle/core';

const { collectionName, folders, requests, warnings } = parsePostmanCollection(rawJson);
```

`parseInsomniaCollection` returns the same shape; `parseCurl` returns one
request's method, URL, headers, query, body and auth. Turn each into a
`Request` (add `id`, `folderId` and the rest) and add it with `applyMutation`.

### Run a saved plan in CI

```ts
import { resolvePlanRef, runPlan } from '@apicircle/core';
import { loadFromFile } from '@apicircle/core/workspace/file-backed';

const state = (await loadFromFile('./.apicircle/workspace-<id>'))!;
const ref = resolvePlanRef(state.synced, 'Smoke Tests');
if (!ref.ok) throw new Error(ref.error);

const result = await runPlan(state, ref.id, { bail: true });
process.exit(result.passed ? 0 : 1);
```

Plans chain requests, evaluate assertions, and pass extracted variables
forward — exit code 0 on green, non-zero on red. Drop it straight into GitHub
Actions, GitLab CI, or any pipeline.

### Mutate workspace state — one function, every entity

```ts
import { applyMutation } from '@apicircle/core';
import { loadFromFile, saveToFile } from '@apicircle/core/workspace/file-backed';

const dir = './.apicircle/workspace-<id>';
const state = (await loadFromFile(dir))!;
// `req` is a Request, built as in the first example.
const { next, changedIds } = applyMutation(state, { kind: 'request.create', request: req });
await saveToFile(dir, next);
```

`WorkspacePatch` is a discriminated union over `request.* | folder.* |
environment.* | assertion.* | mock.* | plan.* | globalAsset.* | history.* |
snapshot.* | secret.* | secretKey.* | release.* | linkedWorkspace.* |
linkedOverride.*`. Adding a new entity in your own UI? One union variant + one
switch case. Headless writers (the `apicircle-lens` CLI and MCP server) and
most of API Circle's UI changes flow through this single function — it's the
audit log seam.

### Keep secrets out of Git and history

- `scanWorkspaceForSecrets(synced)` lists credential-shaped values a push would
  write (where each sits and why — never the value); `redactForGit(synced)`
  blanks the credential fields it knows about.
- `hideRunSecrets(run, knownSecrets)` replaces credential values in a run with
  `[hidden]` before you store it.
- `extractContext(result, extractions, knownSecrets)` returns
  `{ saved, held, warnings }`: `held` holds the captured values that look like
  credentials, which you keep in memory only.

## Entry points

```ts
// Engine API
import { executeRequest, applyMutation, runPlan } from '@apicircle/core';

// Disk-backed single-workspace helpers (load/save/withWorkspace under an advisory lock)
import { loadFromFile, saveToFile, withWorkspace } from '@apicircle/core/workspace/file-backed';

// Multi-workspace registry (registry.json + per-id subdirectories)
import {
  defaultApicircleRoot,
  resolveApicircleRoot,
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

// Workspace + mock providers for hosts (in-memory, file-backed, Git-backed, multi-workspace)
import {
  FileBackedWorkspaceProvider,
  MultiWorkspaceProvider,
  InProcessMockController,
} from '@apicircle/core/providers';
```

- **`/workspace/file-backed`** — one workspace, one folder. `proper-lockfile`
  advisory locking, so concurrent CLI runs don't corrupt each other.
- **`/workspace/registry`** — many workspaces, one root. `registry.json` at
  the top, `workspace-<id>/` subdirectories underneath. All surfaces
  (desktop, web, VS Code, and the `apicircle-lens` CLI and MCP server) default
  to `~/.apicircle/`. Use `resolveApicircleRoot()` to honor the
  `APICIRCLE_WORKSPACES_ROOT` override (CI / tests / relocated stores);
  `defaultApicircleRoot()` is the raw `~/.apicircle/` fallback it builds on.
- **`/providers`** — the `WorkspaceProvider` / `Workspaces` / `MockController`
  contracts and their implementations (`InMemoryWorkspaceProvider`,
  `FileBackedWorkspaceProvider`, `GitBackedWorkspaceProvider`,
  `MultiWorkspaceProvider`, `InProcessMockController`).
- **`/test/mock-idp`** — `startMockIdp()`, an OAuth2 identity provider for
  your own tests.

## Use cases

- Build an **internal API explorer** for your engineering team.
- Run **regression smoke tests** against staging in CI, with real OAuth2.
- Generate a **runtime mock** from an OpenAPI spec on the fly.
- Embed an **AI-powered request authoring** flow in your own product.
- Migrate a Postman library into a typed, Git-trackable workspace.
- Lint or validate workspaces in a pre-commit hook.

## Where it fits

```
@apicircle/shared               (types + IDs + validators + legacy MCP names)
├── @apicircle/mock-server-core (mock-server engine + spec parsing)
└── @apicircle/core             ◀── you are here (uses both)
    └── the apicircle-lens CLI and MCP server (paid Lens features of API Circle)
```

## Stability & test coverage

- Every OAuth2 grant, refresh path and CSRF guard runs against a mock IdP
  (`@apicircle/core/test/mock-idp`).
- Every auth primitive is **CAVS-verified** against the original spec vectors.
- The engine is built ESM-first and ships dual CJS bundles for legacy consumers.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
