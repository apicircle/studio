<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/core</h1>

The engine behind [API Circle Studio](https://github.com/apicircle/studio) — request execution, environment resolution, auth signing, assertions, spec imports, and the `applyMutation` workspace mutation API.

## Install

```bash
npm install @apicircle/core
```

## What's inside

- **Request execution** — `executeRequest`, request building, redirect and retry handling.
- **Auth signing** — all 17 `RequestAuth` schemes: Bearer, Basic, API key, custom header, the full OAuth2 grant set, AWS SigV4, Digest, NTLM, Hawk, and JWT.
- **`applyMutation(state, patch)`** — the single mutation choke point for every workspace write, over the `WorkspacePatch` discriminated union.
- **Imports** — cURL, OpenAPI / Swagger, Postman, and Insomnia parsers.
- **Assertions and execution plans** — `runPlan` executes a saved plan headlessly.
- **Git serialization** — stable JSON serialize / three-way merge for clean workspace diffs.

## Entry points

```ts
// Engine API
import { executeRequest, applyMutation, runPlan } from '@apicircle/core';

// Disk-backed single-workspace helpers (load/save/withWorkspace under lock)
import { loadFromFile, saveToFile, withWorkspace } from '@apicircle/core/workspace/file-backed';

// Multi-workspace registry (registry.json + per-id subdirectories)
import {
  loadRegistry,
  saveRegistry,
  loadWorkspaceById,
  saveWorkspaceById,
  registerWorkspace,
  setActiveWorkspace,
  deleteWorkspaceById,
  findWorkspaceEntry,
  migrateLegacyWorkspace,
  workspaceDirFor,
  type WorkspaceRegistry,
} from '@apicircle/core/workspace/registry';
```

`@apicircle/core/workspace/file-backed` provides disk-backed workspace helpers with `proper-lockfile` advisory locking — used by `@apicircle/cli` and the headless `@apicircle/mcp-server` for one-workspace flows.

`@apicircle/core/workspace/registry` adds the multi-workspace surface: a `registry.json` index at the root plus per-id subdirectories that each hold a single `{ synced, local }` pair. The desktop app, the CLI, and the MCP server all read this same on-disk shape, so an edit in one is visible to the others.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
