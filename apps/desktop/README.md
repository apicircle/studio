# @apicircle/desktop

Electron shell that hosts the free API workspace's web build, with the things a
browser tab cannot do: OS-keychain secret storage, running mock servers, an
OAuth2 callback server, a workspace mirror on disk, and auto-update.

This package builds the **standalone** desktop app of this repository
(`productName: API Circle Studio` in `electron-builder.yml`). End users get the
API Circle desktop app, which contains this workspace, from
[apicircle.dev/download](https://apicircle.dev/download).

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
    persists the JWK in plaintext, identical to web behavior — and, as on web,
    a secret can be stored only after a workspace passphrase is set).
- Runs mock servers in the main process (`MockManager`) and, when you quit
  with mocks running, asks before stopping them.
- Serves the OAuth2 redirect callback, locks down the session (CSP, no
  optional permission but the clipboard), and installs updates with
  `electron-updater`.

It runs on Electron 44 and is packaged with electron-builder 26: a `dmg` for
macOS 13 (Ventura) or later (x64 and arm64), an `nsis` installer for 64-bit
Windows, and `AppImage` / `deb` for Linux.

## Build

```sh
pnpm --filter @apicircle/desktop build
```

This builds the web renderer first (so `apps/web/dist/` exists), then bundles
the main and preload entries with `tsup` into `apps/desktop/dist/main/`
(`main.js`, `preload.js`), inlining the workspace packages. Electron downloads
its binary the first time it starts.

## Run

```sh
pnpm --filter @apicircle/desktop start
```

## Smoke test

`scripts/build-smoke.mjs` (`pnpm --filter @apicircle/desktop smoke`) checks
that `dist/main/main.js` and `dist/main/preload.js` exist and wire the
`apicircle:secret:*` IPC channels, `safeStorage` and `contextBridge`, without
launching Electron. No CI workflow runs it today; run it after a build.

## Workspace mirror (multi-workspace on disk)

The renderer keeps every workspace in IndexedDB; the main process mirrors each
one to disk so other tools — the `apicircle-lens` CLI and MCP server, a text
editor — read the same files, and a file watcher brings their changes back into
the app. The root is `~/.apicircle/`, or `APICIRCLE_WORKSPACES_ROOT` when set:

```
~/.apicircle/
  registry.json                       <- multi-workspace index
  workspace-<id>/
    workspace.json                    <- git-tracked half
    workspace.local.json              <- device-private half
    attachments/
```

The mirror is owned by `WorkspaceFileManager`
(`packages/desktop-shell/src/workspaceFile/workspaceFileManager.ts`) and
exposed to the renderer via the `apicircle:workspaceFile:*` IPC channels in
`packages/desktop-shell/src/ipc/workspaceFileBridge.ts`;
`workspaceWatcher.ts` beside the manager reports external writes.

## Why a shell, not a fork

The desktop app re-uses `@apicircle/web`'s built output rather than keeping a
renderer of its own, so features land in the web app and the desktop picks
them up on the next renderer build. Its main-process pieces — keychain
secrets, mock servers, the OAuth2 callback server, the workspace mirror and
window state — live in `@apicircle/desktop-shell` (`packages/desktop-shell`).
`src/main/main.ts` composes them and keeps only what is specific to this app:
the window, CSP, branding, auto-update and the quit prompt for running mocks.
