# Platform surfaces — MCP, mock engine, CLI, desktop

Design record for the surfaces beyond the React UI: the MCP tool catalog,
the local mock-server engine, the CLI, and the desktop integrations that
wire them together. All of these share the same workspace mutation API,
the same parsers, and the same persistence layer — the only thing that
changes is the host environment.

## Why these surfaces exist

The UI is one way into the workspace; it is not the only one. Two more
were added deliberately:

1. **AI integration via the Model Context Protocol** (open spec — Claude
   Desktop, ChatGPT, Cursor, GitHub Copilot, Continue, Cline, Zed,
   Windsurf all consume it). The workspace becomes a tool catalog any
   compliant client can drive.
2. **Local mock server.** Users describe APIs in OpenAPI / Postman /
   Insomnia and run a Hono-backed mock on `localhost`. Definitions are
   workspace-scoped (push to git so teams share); runtime is per-host.

## Locked-in decisions

| Decision                          | Choice                                                                                     | Why                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| npm scope                         | `@apicircle/*`                                                                             | Clean public branding                                          |
| MCP transport                     | stdio (HTTP/SSE deferred)                                                                  | Zero-config; matches every MCP client's default                |
| MCP SDK                           | `@modelcontextprotocol/sdk` (Anthropic, official)                                          | Open spec — works with every MCP client                        |
| Mock framework                    | Hono                                                                                       | Same code in Node, Bun, Workers/edge                           |
| OpenAPI parser                    | `@apidevtools/swagger-parser`                                                              | Battle-tested `$ref` deref + YAML                              |
| Mock storage                      | `WorkspaceSynced.mockServers` (defs, push) + `WorkspaceLocal.mockRuntime` (runtime, local) | Teams share definitions; runtime is per-host                   |
| Distribution                      | npm + Electron + platform binaries                                                         | All three audiences (devs, GUI users, CI) covered              |
| Build tool for shippable packages | tsup                                                                                       | Dual ESM/CJS + .d.ts, one command                              |
| CLI binary name                   | `apicircle`                                                                                | Single word; subcommands `apicircle mock / mcp / import / run` |

## Mutation API as a single choke point

`applyMutation(state, patch)` in `@apicircle/core` is the only function in
the codebase that mutates a workspace. UI store, MCP tool handlers, CLI
commands all funnel through it. As a result:

- The desktop UI can't produce workspace shapes the MCP server couldn't
  produce, and vice-versa.
- Every entity gets an `updatedAt` bump for free; we never forget.
- File-backed persistence (`@apicircle/core/workspace/file-backed`)
  acquires a `proper-lockfile` advisory lock around `load → mutate →
save`, so two concurrent CLI / MCP writers can't interleave.

`WorkspacePatch` is a discriminated union over `request.* | folder.* |
environment.* | assertion.* | mock.* | plan.*`. Adding a new entity type
is one variant + one switch case + one MCP tool definition.

## MCP server — provider abstraction

`@apicircle/mcp-server` doesn't know whether it's running:

- inline in the Electron main process,
- standalone via the CLI on a developer's laptop, or
- in some future hosted service.

Tool handlers depend on two interfaces:

- **`WorkspaceProvider`** — `read()` / `apply(patch)` / `write({ synced?, local? })`.
- **`MockController`** — `start(server)` / `stop(serverId)` / `list()`.

Three implementations ship with the package:

| Provider                        | Backed by                                      | Used by                            |
| ------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `InMemoryWorkspaceProvider`     | object in memory                               | unit tests, programmatic embedders |
| `FileBackedWorkspaceProvider`   | disk + `proper-lockfile`                       | CLI, headless MCP, CI              |
| (Future) `IpcWorkspaceProvider` | Electron IPC into the renderer's Zustand store | Desktop                            |
| `InProcessMockController`       | `@apicircle/mock-server-core` direct           | CLI, embedders                     |
| (Future) `IpcMockController`    | IPC into desktop main's `MockManager`          | Desktop                            |

The desktop today does not host an MCP server itself — it surfaces a
config snippet so each AI client spawns `apicircle-mcp` as its own child.
That keeps process lifecycle scoped to the AI client's session and avoids
a long-lived stdio child of Electron.

## Disk mirror + external-write watcher

The desktop maintains a JSON mirror of the IndexedDB-backed workspace
under `<userData>/workspaces/<id>/`. The CLI and MCP server read and
write those files directly under `proper-lockfile`. Three pieces keep
the IDB ↔ disk relationship coherent:

- **`WorkspaceFileManager`** (`apps/desktop/src/main/workspaceFile/`)
  owns the per-id queues that drain renderer-side writes to disk. Every
  write call records a `{ mtimeMs, size }` snapshot with the
  watcher so its own fs events don't trigger refresh loops.
- **`WorkspaceWatcher`** (same dir) tails the root + per-id dirs via
  `fs.watch`, debounces events, and emits an `externalChange` IPC
  event when the post-event file stat differs from the recorded
  snapshot — i.e. when an external writer (MCP, CLI, hand-edit)
  actually changed the bytes.
- **`hydrate()` and `refreshFromDisk()`** in the renderer's
  `workspaceStore` compare `meta.updatedAt` between IDB and disk and
  adopt whichever is newer. Boot-time IDB→disk write is gated on
  "memory wins" so an external writer that landed while the desktop
  was closed isn't silently overwritten.

`MultiWorkspaceProvider.activeProvider()` in the MCP server is a lazy
wrapper that re-reads `registry.json` per call, so the user can switch
workspaces in the desktop without restarting the MCP process.

## Global File Asset provenance

Every file uploaded into the workspace — through the Global Assets
sidebar, a form-data row, a binary request body, or a mock-server
binary response — is a `GlobalFileAsset` entry in the synced doc, with
bytes living on disk under `.apicircle/attachments/<slotId>` after the
first push. Three pieces of state describe where the bytes live at any
moment:

- `synced.globalAssets.files[id]` — the asset entry itself, plus two
  optional ref slots:
  - `workingBranchRef` — bytes verified on the consumer's working
    branch. Populated by the push flow after `updateRef` resolves.
  - `baseBranchRef` — bytes verified on the base branch (typically
    `main`). Populated by the refresh-time verification pass when it
    detects the bytes on base — i.e. after a PR merges.
- `local.pendingFileUploads[id]` — bytes are in IDB but not on any Git
  ref yet (the "Uploaded locally" state pill).
- `local.assetUsageIndex[id]` — cross-cutting reference count per asset
  recomputed by `assetUsageAggregator` after every `commitSynced`,
  same pattern as `usedInAggregator` for the Secret Vault.
- `local.pendingAttachmentDeletes` — slotIds whose blob needs to be
  removed from the working branch on the next push. Queued by
  `removeGlobalFileAsset` (and the headless `globalAsset.removeFile`
  patch) when the asset being deleted had any push provenance.
  Without this queue, removing an asset would drop it from
  `workspace.json` but leave the orphan blob on the remote tree
  forever — and the PR merge would carry the orphan into the base
  branch. The push emits one `{path: '.apicircle/attachments/<slotId>',
sha: null}` tree entry per queued slot (GitHub treats `sha: null`
  layered over `base_tree` as a deletion), clears the queue post-
  `updateRef`, and a pre-emit safety filter drops any slotId that
  matches a currently-registered asset (defends against snapshot-
  restore bringing a previously-deleted asset back). The aggregator
  also self-heals ghost entries on every commit so the queue never
  grows unbounded.

The state machine driven by push + refresh:

| pendingFileUploads | workingBranchRef | baseBranchRef | UI badge                     |
| ------------------ | ---------------- | ------------- | ---------------------------- |
| ✔                  | null             | null          | "Uploaded locally"           |
| —                  | ✔                | null          | "On working branch"          |
| —                  | ✔                | ✔ (same blob) | "Merged to base" (transient) |
| —                  | null             | ✔             | "On main"                    |
| —                  | ✔                | ✔ (different) | "Diverged"                   |
| —                  | null             | null          | "Missing — re-upload"        |

**Cleanup invariant.** When both refs resolve and hold the same GitHub
blob sha, the refresh-time pass drops `workingBranchRef`. The base ref
is the single source of truth; the working ref was just a transient
"haven't fast-forwarded yet" marker.

**Read fallback.** Consumers read working → base in order. A 404 on the
working ref drops it; the next read tries base; if both are missing
and there's no local copy, the asset enters the `missing` state and
the UI prompts for re-upload.

**Verification grace window.** The refresh probe trusts any ref
stamped within the last 60 seconds without re-probing. GitHub's
strongly-consistent Git Data API is what the push commits through,
but the Contents API (which the verification probe uses) is
eventually consistent and can return 404 for the same blob for
several seconds after the push lands. Without the grace window, a
cold-launch refresh that fires right after push would null the
`workingBranchRef` the push just stamped and the status pill would
flicker "Missing" until the next probe (or until the PR merged and
the base-branch probe re-discovered the file). When a ref is null
AND a branch is connected, the probe also runs opportunistically,
so a previously-lost ref recovers on the next refresh.

All six state transitions flow through `applyMutation` via the new
`globalAsset.*` patch variants in `@apicircle/core/workspace/patches.ts`,
so MCP / CLI writers and the UI store apply the same semantics.

## Mock server — three runtimes, one engine

`@apicircle/mock-server-core` is a Hono app builder. The same factory
powers:

- The desktop `MockManager` (in-process Hono on the Electron main).
- The CLI (`apicircle mock <spec>`).
- The MCP `mock.start` tool (in-process via `InProcessMockController`).

OpenAPI / Postman / Insomnia parsers live in this package; the MCP
`import.*` tools reuse them so spec parsing is exactly identical between
the "import requests" and "create mock from spec" flows.

## Distribution

Released as five npm packages (one changeset bumps them together for
now):

- `@apicircle/shared`
- `@apicircle/core`
- `@apicircle/mock-server-core`
- `@apicircle/mcp-server`
- `@apicircle/cli`

Plus three artifact streams driven by the release workflow:

- **CLI binaries** (`@yao-pkg/pkg`): linux-x64, macos-x64, macos-arm64, win-x64.
- **Desktop installers** (`electron-builder`): `.dmg`, `.exe` (NSIS), `.AppImage` + `.deb`.
- **GitHub Release** auto-generated, with all of the above attached.

`apps/web` and `apps/desktop` stay private. Only the publishable
`packages/*` go to npm.

## What this enables

An AI agent on any MCP client can:

- Walk a Git repo's source files and propose a request collection
  (`codebase.extract_collection` → user confirms → `request.create` × N).
- Generate runnable code from a stored request (`generate.code` → user
  pastes into a project).
- Import a Swagger spec and immediately spin up a local mock against it
  (`mock.create_from_openapi` → `mock.start`).
- Author a multi-step execution plan from a natural-language prompt
  (`prompt.create_plan` validates every step id exists before
  persisting).

All without leaving the AI client's chat surface.
