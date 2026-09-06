> **MCP status:** API Circle Studio no longer ships, publishes, or configures MCP or the old Studio CLI. This document is a historical architecture record for the original Studio MCP design. Current MCP and CLI automation live in API Circle Lens and run through `apicircle-lens mcp` / Lens CLI commands against compatible `.apicircle` workspaces.

# Platform surfaces — mock engine, desktop, and Lens automation compatibility

Design record for Studio surfaces beyond the React UI: the local mock-server engine, desktop integrations, and compatibility points that Lens-owned CLI/MCP automation composes. Studio itself no longer ships or publishes MCP or the old CLI.

## Why these surfaces exist

The UI is one way into the workspace; it is not the only one. Two more
were added deliberately:

1. **Local mock server.** Users describe APIs in OpenAPI / Postman /
   Insomnia and run a Hono-backed mock on `localhost`. Definitions are
   workspace-scoped (push to git so teams share); runtime is per-host.

## Locked-in decisions

| Decision                          | Choice                                                                                     | Why                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| npm scope                         | `@apicircle/*`                                                                             | Clean public branding                             |
| Mock framework                    | Hono                                                                                       | Same code in Node, Bun, Workers/edge              |
| OpenAPI parser                    | `@apidevtools/swagger-parser`                                                              | Battle-tested `$ref` deref + YAML                 |
| Mock storage                      | `WorkspaceSynced.mockServers` (defs, push) + `WorkspaceLocal.mockRuntime` (runtime, local) | Teams share definitions; runtime is per-host      |
| Distribution                      | npm + Electron + platform binaries                                                         | All three audiences (devs, GUI users, CI) covered |
| Build tool for shippable packages | tsup                                                                                       | Dual ESM/CJS + .d.ts, one command                 |

## Mutation API as a single choke point

`applyMutation(state, patch)` in `@apicircle/core` is the only function in
the codebase that mutates a workspace. Studio UI flows and Lens-owned MCP/CLI automation funnel through it. As a result:

- The desktop UI and Lens-owned automation share the same workspace mutation contract.
- Every entity gets an `updatedAt` bump for free; we never forget.
- File-backed persistence (`@apicircle/core/workspace/file-backed`)
  acquires a `proper-lockfile` advisory lock around `load → mutate →
save`, so external Lens-owned headless writers cannot interleave.

`WorkspacePatch` is a discriminated union over `request.* | folder.* |
environment.* | assertion.* | mock.* | release.* | linkedWorkspace.* |
linkedOverride.* | plan.*`. Adding a new entity type is one variant + one switch
case, with Lens adding its own MCP tool definition outside Studio when needed.

## Lens-owned MCP/CLI compatibility

The original Studio MCP server and CLI moved to API Circle Lens. Studio keeps the workspace and mock-engine contracts Lens composes, but Studio no longer hosts, publishes, or configures an MCP server.

## Disk mirror + external-write watcher

The desktop maintains a JSON mirror of the IndexedDB-backed workspace
under `<userData>/workspaces/<id>/`. Lens-owned CLI/MCP automation can read and
write compatible workspace files under its own gate. Three pieces keep
the IDB ↔ disk relationship coherent:

- **`WorkspaceFileManager`** (`packages/desktop-shell/src/workspaceFile/`)
  owns the per-id queues that drain renderer-side writes to disk. Every
  write call records a `{ mtimeMs, size }` snapshot with the
  watcher so its own fs events don't trigger refresh loops.
- **`WorkspaceWatcher`** (same dir) tails the root + per-id dirs via
  `fs.watch`, debounces events, and emits an `externalChange` IPC
  event when the post-event file stat differs from the recorded
  snapshot — i.e. when an external writer such as Lens-owned CLI/MCP automation or a hand edit actually changed the bytes.
- **`hydrate()` and `refreshFromDisk()`** in the renderer's
  `workspaceStore` compare `meta.updatedAt` between IDB and disk and
  adopt whichever is newer. Boot-time IDB→disk write is gated on
  "memory wins" so an external writer that landed while the desktop
  was closed isn't silently overwritten.

Lens-owned MCP/CLI automation is expected to resolve workspace registry state at call time so switching workspaces remains coherent.

## Reusable desktop shell (`@apicircle/desktop-shell`)

The Electron **main-process** building blocks — the OS-keychain secrets, mock,
and workspace-file IPC bridges (each guarded by `assertTrustedSender`), the
OAuth2 callback server, and window-state persistence — live in the
workspace-private `@apicircle/desktop-shell` package rather than inline in
`apps/desktop`. `apps/desktop/src/main/main.ts` **composes** the shell:
constructs the managers, calls the `register*Bridge(…)` functions, and keeps only
the Studio-specific concerns (window creation, CSP header injection, branding,
`electron-updater` auto-update, and the mock-drain quit lifecycle). This is the
same additive composition principle used by Lens-owned MCP/CLI automation — an edition's Electron app consumes `@apicircle/desktop-shell`
to get identical, security-hardened IPC without forking the main process.

## Global File Asset provenance

Every file uploaded into the workspace — through the Global Assets
sidebar, a form-data row, a binary request body, or a mock-server
binary response — is a `GlobalFileAsset` entry in the synced doc, with
bytes living on disk under `.apicircle/workspace-<id>/attachments/<slotId>` after the
first push. Three pieces of state describe where the bytes live at any
moment:

- `synced.globalAssets.files[id]` — the asset entry itself, plus two
  optional ref slots:
  - `workingBranchRef` — bytes verified on the consumer's working
    branch. Populated by the push flow once the commit lands. Its
    `blobSha` is optional and stays ABSENT on hosts that report no
    per-file sha (only GitHub does, because only it uploads the blobs
    by hand); the refresh probe fills it in from `getContents` later.
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
  branch. The push emits one deletion per queued slot through
  `GitProvider.commitFiles` (GitHub renders it as a `{path, sha: null}`
  tree entry over `base_tree`, GitLab as a `delete` action, Bitbucket as
  a `files` field, Azure DevOps as a `delete` change), clears the queue
  once the commit lands, and a pre-emit safety filter drops any slotId that
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
so Lens-owned MCP/CLI writers and the UI store apply the same semantics.

## Mock server — four runtimes, one engine

`@apicircle/mock-server-core` is a Hono app builder. The same factory
powers:

- The desktop `MockManager` (in-process Hono on the Electron main).
- Lens-owned CLI/MCP automation, outside Studio.
- The **VS Code extension's `VsCodeMockController`** (Phase 3) — wraps
  `InProcessMockController` and runs in the extension host. Internally
  namespaces server ids by workspace (`${workspaceId}::${serverId}`)
  so multi-root workspaces with shared mock ids don't collide on the
  shared underlying controller. Runtime state is synced into
  `WorkspaceLocal.mockRuntime.active` via the same `surface.write({local})`
  path the desktop's `MockManager` uses, so the disk-mirror view of
  "which mocks are running" stays consistent across surfaces. On
  external workspace changes (Git pull, Lens-owned CLI/MCP automation), a
  `reconcile()` pass stops any controller-tracked server whose
  definition vanished.

OpenAPI / Postman / Insomnia parsers live in this package; Lens-owned MCP/CLI automation reuses them so spec parsing stays identical between headless and Studio GUI flows.

## Distribution

Released as five npm packages (one changeset bumps them together for
now):

- `@apicircle/shared`
- `@apicircle/core`
- `@apicircle/mock-server-core`

Plus three artifact streams driven by the release workflow:

- **Desktop installers** (`electron-builder`): `.dmg`, `.exe` (NSIS), `.AppImage` + `.deb`.
- **GitHub Release** auto-generated, with all of the above attached.

`apps/web` and `apps/desktop` stay private. Only the publishable
`packages/*` go to npm.

## What this enables

Studio remains the free GUI for API workspace authoring, mocks, plans, Git-backed persistence, and VS Code editing. When an MCP client or headless CLI workflow is needed, the same `.apicircle` workspace can be opened in API Circle Lens and driven through `apicircle-lens mcp` or Lens CLI commands.
