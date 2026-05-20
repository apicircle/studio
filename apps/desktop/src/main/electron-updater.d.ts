// Ambient module declaration for `electron-updater`. Lets the TS build
// pass even before `pnpm install` lands the dep — the runtime contract is
// loose-typed inside autoUpdater.ts (we cast through unknown), so this
// declaration only needs to satisfy the static module resolver. Once the
// real types from `node_modules/electron-updater/out/index.d.ts` are
// available they take precedence automatically (TS prefers concrete types
// over ambient declarations).

declare module 'electron-updater' {
  export const autoUpdater: unknown;
}
