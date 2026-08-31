# @apicircle/desktop

Electron shell that hosts the API Circle Studio web build with native
OS-keychain secret storage.

## What this package does

- Wraps the same renderer that `apps/web` ships (no UI duplication).
- Exposes a `NativeSecretBridge` (see
  `packages/ui-components/src/persistence/nativeSecretBridge.ts`) on the
  renderer's `window` via Electron's `contextBridge` + `ipcRenderer`.
- Backs the bridge with Electron's `safeStorage`, which talks to:
  - macOS — Keychain
  - Windows — DPAPI
  - Linux — `libsecret` (when available; falls back to a no-op
    `isEncryptionAvailable() → false` if not, in which case the renderer
    persists the JWK in plaintext, identical to web behavior).

## Build

```sh
pnpm --filter @apicircle/desktop build
```

This runs the web renderer build first (so `apps/web/dist/` exists),
then `tsc` for the main process. Output: `apps/desktop/dist/main/`.

## Run

```sh
pnpm --filter @apicircle/desktop start
```

## Smoke test

`scripts/build-smoke.mjs` validates that `dist/main/main.js` and
`dist/main/preload.js` exist + contain the expected exports / IPC
channel names. CI runs this without launching Electron so we don't
need a display.

## Workspace mirror (multi-workspace on disk)

The renderer keeps every workspace in IndexedDB; the desktop main
process mirrors each one to disk so compatible headless automation can read the same workspace files. Studio no longer publishes the old CLI or MCP server; use API Circle Lens and `apicircle-lens mcp` for supported MCP workflows. Layout
under `app.getPath('userData')`:

```
workspaces/
  registry.json                       <- multi-workspace index
  <workspace-id-1>/
    workspace.json                    <- git-tracked half
    workspace.local.json              <- device-private half
  <workspace-id-2>/
    ...
```

The mirror is owned by `WorkspaceFileManager`
(`src/main/workspaceFile/workspaceFileManager.ts`) and exposed to the
renderer via the `apicircle:workspaceFile:*` IPC channels in
`src/main/ipc/workspaceFileBridge.ts`. On first boot we migrate the
legacy `userData/workspace/` single-workspace layout into
`workspaces/<id>/` automatically — no data loss.

## Why a shell, not a fork

The plan (§1) calls for "web-first; port Electron shell after web is
stable". This shell deliberately re-uses `@apicircle/web`'s built
output rather than maintaining a separate renderer entry point —
features land in the web app and the desktop picks them up on the
next renderer build.
