/**
 * End-to-end coverage for the popup-based OAuth2 grants:
 *
 *   - oauth2-auth-code  (popup → IdP → callback HTML → BroadcastChannel)
 *   - oauth2-pkce       (same popup choreography + verifier-bound exchange)
 *   - oauth2-implicit   (popup → IdP redirect with #fragment)
 *   - oauth2-device     (no popup — UI shows user_code, IdP approves)
 *
 * Browser automation pattern for popup flows:
 *
 *   1. Spin up the local mock IdP. It serves /authorize (which 302s to
 *      our redirect_uri) and /token (which mints deterministic tokens).
 *   2. Configure the auth tab in the parent page.
 *   3. Wrap the "Get token" click with `context.waitForEvent('page')` so
 *      Playwright catches the popup window before the click resolves.
 *   4. The popup auto-navigates: IdP → /oauth-callback.html?code=…&state=….
 *      The callback HTML's inline JS posts to BroadcastChannel and calls
 *      window.close() — Playwright's `popup.waitForEvent('close')` settles
 *      when that happens.
 *   5. Back in the parent, wait for the "Token cached" pill to appear,
 *      then send the request and assert the bearer header.
 *
 * Caveats:
 *   - The web build serves `/oauth-callback.html` from the dev server's
 *     origin (http://localhost:5174). Playwright's `webServer` block in
 *     `playwright.config.ts` already starts the dev server, so the static
 *     page is reachable.
 *   - BroadcastChannel works in Chromium (Playwright's default project).
 *     If we add Firefox / WebKit projects later, both also support it.
 *   - The mock IdP runs on 127.0.0.1:<random> — CORS in the IdP fixture
 *     is set to `*` so the popup's redirect can hit the parent app's origin.
 */

import { expect, test } from './fixtures/app';
import { startMockIdp, type MockIdp } from './fixtures/mockIdp';

// Run popup specs serially: they share a single mock IdP and would race
// over BroadcastChannel names + the dev server's localStorage if Playwright
// fired them in parallel under `fullyParallel: true`.
test.describe.configure({ mode: 'serial' });

let idp: MockIdp;

test.beforeAll(async () => {
  idp = await startMockIdp();
});
test.afterAll(async () => {
  await idp?.close();
});

test('auth-code: popup choreography → callback HTML → token cached', async ({ app, context }) => {
  // 1. New request + auth tab.
  await app.getByRole('button', { name: 'New request' }).click();
  await app.getByRole('button', { name: 'Auth', exact: true }).click();
  await app.getByLabel('Auth type').selectOption('oauth2-auth-code');
  await app.getByLabel('Authorization URL').fill(idp.url('/authorize'));
  await app.getByLabel('Token URL').fill(idp.url('/token'));
  await app.getByLabel('Client ID').fill('auth-client');
  await app.getByLabel('Client secret', { exact: true }).fill('auth-secret');

  // 2. Catch the popup BEFORE the click resolves.
  const popupPromise = context.waitForEvent('page');
  await app.getByRole('button', { name: /^Authorize$/i }).click();
  const popup = await popupPromise;

  // 3. Popup auto-navigates: IdP redirects to /oauth-callback.html which
  //    posts via BroadcastChannel + closes itself.
  // 30s window: the first test in the batch pays for the dev server's
  // cold-start compile (lazy modules, Vite dependency optimization).
  // After that, the cache hits keep popup-close on the order of ~2-3s,
  // so the higher ceiling only matters for run #1.
  await popup.waitForEvent('close', { timeout: 30_000 });

  // 4. Parent UI shows "Token cached" — proves the BroadcastChannel
  //    message reached the parent and the code was exchanged for a token.
  //    (The Send → bearer-header assertion is covered by the in-process
  //    e2e test in `packages/core/src/auth/oauth2/e2e.test.ts`; replaying
  //    the response panel through Playwright is a separate scope.)
  await expect(app.getByText(/Token cached/i)).toBeVisible({ timeout: 15_000 });
});

test('PKCE: popup choreography emits S256 challenge in authorize URL', async ({ app, context }) => {
  await app.getByRole('button', { name: 'New request' }).click();
  await app.getByRole('button', { name: 'Auth', exact: true }).click();
  await app.getByLabel('Auth type').selectOption('oauth2-pkce');
  await app.getByLabel('Authorization URL').fill(idp.url('/authorize'));
  await app.getByLabel('Token URL').fill(idp.url('/token'));
  await app.getByLabel('Client ID').fill('pkce-client');

  // Hook navigations on the new page BEFORE the popup opens — Playwright
  // emits `request` for every navigation, so we can record the authorize
  // URL even if the IdP 302s away from it before any waitFor* resolves.
  // Listen on the context so we capture the popup's first navigation
  // even though the popup object isn't built yet.
  const navUrls: string[] = [];
  context.on('request', (req) => {
    if (req.isNavigationRequest()) navUrls.push(req.url());
  });

  const popupPromise = context.waitForEvent('page');
  await app.getByRole('button', { name: /^Authorize$/i }).click();
  const popup = await popupPromise;

  // 30s window: the first test in the batch pays for the dev server's
  // cold-start compile (lazy modules, Vite dependency optimization).
  // After that, the cache hits keep popup-close on the order of ~2-3s,
  // so the higher ceiling only matters for run #1.
  await popup.waitForEvent('close', { timeout: 30_000 });
  await expect(app.getByText(/Token cached/i)).toBeVisible({ timeout: 15_000 });

  // The /authorize URL must have carried the PKCE challenge.
  const authorizeNav = navUrls.find((u) => u.includes('/authorize'));
  expect(authorizeNav).toBeDefined();
  expect(authorizeNav!).toContain('code_challenge=');
  expect(authorizeNav!).toContain('code_challenge_method=S256');
});

test('implicit: popup posts fragment-supplied access_token to the parent', async ({
  app,
  context,
}) => {
  await app.getByRole('button', { name: 'New request' }).click();
  await app.getByRole('button', { name: 'Auth', exact: true }).click();
  await app.getByLabel('Auth type').selectOption('oauth2-implicit');
  await app.getByLabel('Authorization URL').fill(idp.url('/authorize'));
  await app.getByLabel('Client ID').fill('implicit-client');

  const popupPromise = context.waitForEvent('page');
  await app.getByRole('button', { name: /^Authorize \(implicit\)$/i }).click();
  const popup = await popupPromise;

  // For implicit, the IdP redirects to redirect_uri#access_token=…&state=…
  // The callback HTML reads the fragment and posts via BroadcastChannel.
  // 30s window: the first test in the batch pays for the dev server's
  // cold-start compile (lazy modules, Vite dependency optimization).
  // After that, the cache hits keep popup-close on the order of ~2-3s,
  // so the higher ceiling only matters for run #1.
  await popup.waitForEvent('close', { timeout: 30_000 });
  await expect(app.getByText(/Token cached/i)).toBeVisible({ timeout: 15_000 });
});

test('device flow: shows user_code, polls until IdP approves, then caches the token', async ({
  app,
}) => {
  // Device flow needs no popup — the parent UI shows the user_code +
  // verification_uri, and the user enters the code on a separate device.
  // Our mock IdP's poll endpoint flips to "approved" after we call
  // `idp.approveDevice()` — simulates the user finishing the entry.

  await app.getByRole('button', { name: 'New request' }).click();
  await app.getByRole('button', { name: 'Auth', exact: true }).click();
  await app.getByLabel('Auth type').selectOption('oauth2-device');
  await app.getByLabel('Device authorization URL').fill(idp.url('/device_authorize'));
  await app.getByLabel('Token URL').fill(idp.url('/token'));
  await app.getByLabel('Client ID').fill('device-client');

  await app.getByRole('button', { name: /^Start device flow$/i }).click();

  // The user_code from the mock IdP — surfaced via DeviceCodeHint.
  await expect(app.getByText(/ABCD-EFGH/)).toBeVisible({ timeout: 10_000 });

  // Approve on the IdP side (simulates the user finishing the code entry).
  idp.approveDevice();

  // The next poll cycle picks up the approval; UI lands on "Token cached".
  await expect(app.getByText(/Token cached/i)).toBeVisible({ timeout: 30_000 });
});
