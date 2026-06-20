// Availability gate for the one-click "Sign in with GitHub" device flow.
//
// The device flow POSTs to a *same-origin* `/_gh-oauth` relay (see
// `resolveGitHubLoginBaseUrl` in `store/workspaceStore.ts`). GitHub does not
// send CORS headers on its `github.com/login/*` endpoints, so a browser can't
// call them directly — the request has to hop through a server that rewrites
// `/_gh-oauth` → `https://github.com`.
//
// That relay ONLY exists in the Vite dev server (`apps/web/vite.config.ts`).
// Production builds have no relay, so the one-click button could only ever
// fail there:
//   - the hosted web app (GitHub Pages, studio.apicircle.dev) is static — a
//     POST to `/_gh-oauth/...` hits a static host and comes back HTTP 405;
//   - the packaged desktop app serves the renderer over `file://`, so the
//     relative `/_gh-oauth` path resolves to nothing → "Failed to fetch".
//
// In both, connecting with a personal access token is the supported path: it
// calls `api.github.com` directly, which *does* send CORS headers and so works
// from any browser. We therefore only show the one-click button where the
// relay is present (the dev server), and route everyone else to the token
// field. Forks that stand up their own same-origin relay can force the button
// on with `VITE_GH_DEVICE_FLOW=1` (or off with `=0`).
//
// Lives in its own file (not the component module) so the test-only export
// doesn't break React Fast Refresh — mirrors `webBuild.ts`.

let deviceFlowOverrideForTests: boolean | null = null;

/** Test helper: force `isGitHubDeviceFlowAvailable()` to a fixed value.
 *  `null` restores the default runtime detection. */
export function __setGitHubDeviceFlowAvailableForTests(value: boolean | null): void {
  deviceFlowOverrideForTests = value;
}

/**
 * Read the optional `VITE_GH_DEVICE_FLOW` build-time override. Returns
 * `true`/`false` for a recognised value, or `null` when unset so the caller
 * falls through to the dev-server check. Binds `import.meta.env` to a local
 * first so the lookup reads the runtime env object (mutable under Vitest)
 * rather than a statically-inlined literal.
 */
function readDeviceFlowEnvOverride(): boolean | null {
  let raw: string | undefined;
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    raw = env?.VITE_GH_DEVICE_FLOW;
  } catch {
    raw = undefined;
  }
  if (raw === undefined && typeof process !== 'undefined') {
    raw = process.env?.VITE_GH_DEVICE_FLOW;
  }
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

/** Whether the Vite dev server (and therefore the `/_gh-oauth` relay) is
 *  serving this build. `import.meta.env.DEV` is `true` only under `vite dev`;
 *  every production build — the web deploy and the packaged desktop app —
 *  reports `false`. */
function isViteDevServer(): boolean {
  try {
    const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    return env?.DEV === true;
  } catch {
    return false;
  }
}

/**
 * Whether the one-click "Sign in with GitHub" device flow can actually succeed
 * in the current build. See the file header for the full rationale.
 */
export function isGitHubDeviceFlowAvailable(): boolean {
  if (deviceFlowOverrideForTests !== null) return deviceFlowOverrideForTests;
  if (typeof window === 'undefined') return false;
  const envOverride = readDeviceFlowEnvOverride();
  if (envOverride !== null) return envOverride;
  return isViteDevServer();
}
