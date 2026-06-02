// Web-build detection helper for the Secret Vault dock (and any future
// surface that needs to know whether the OS-keychain bridge is around).
//
// The desktop bridge wraps the secret-vault master key via Electron's
// `safeStorage`, so a desktop user can save secrets without ever
// setting a workspace passphrase. On the web build there's no such
// bridge, so the Vault dock must surface a "Set passphrase" CTA before
// any write can succeed (see `persistence/platformSecretGate.ts`).
//
// Under vitest we treat the runtime as desktop by default — the existing
// CRUD tests don't go through the passphrase flow, and the underlying
// `platformSecretGate` already bypasses there too. Tests that need to
// exercise the gate flip `__setWebBuildForTests(true)` for their case.
//
// Lives in its own file (not inside the component module) so the
// test-only export doesn't break React Fast Refresh.

let webBuildOverrideForTests: boolean | null = null;

/** Test helper: force `isWebBuild()` to return true (or false) regardless
 *  of the runtime. `null` restores the default detection. */
export function __setWebBuildForTests(value: boolean | null): void {
  webBuildOverrideForTests = value;
}

export function isWebBuild(): boolean {
  if (webBuildOverrideForTests !== null) return webBuildOverrideForTests;
  if (typeof process !== 'undefined' && process?.env?.VITEST === 'true') return false;
  const w = globalThis as unknown as { apicircleDesktop?: unknown };
  return typeof w.apicircleDesktop === 'undefined';
}
