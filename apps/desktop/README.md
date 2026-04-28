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

## Why a shell, not a fork

The plan (§1) calls for "web-first; port Electron shell after web is
stable". This shell deliberately re-uses `@apicircle/web`'s built
output rather than maintaining a separate renderer entry point —
features land in the web app and the desktop picks them up on the
next renderer build.
