/**
 * End-to-end OAuth2 client-credentials flow through the Auth tab UI.
 *
 * Spins up a real localhost mock IdP, navigates to the auth tab,
 * configures `oauth2-client-credentials` pointing at the mock, clicks
 * "Get token", waits for the token-cached pill, and then sends a
 * request to a /protected endpoint that 401s without `Bearer tk-cc-…`.
 *
 * We don't cover auth-code / PKCE / implicit / device here because
 * those need popup-window choreography. The protocol layer for every
 * grant is exercised via the in-process E2E test in
 * `packages/core/src/auth/oauth2/e2e.test.ts`.
 */

import { expect, test } from './fixtures/app';
import { startMockIdp, type MockIdp } from './fixtures/mockIdp';

let idp: MockIdp;

test.beforeAll(async () => {
  idp = await startMockIdp();
});
test.afterAll(async () => {
  await idp?.close();
});

test('client_credentials: get token via UI, send request with bearer header', async ({ app }) => {
  // Create + open a request, set its URL to /protected.
  await app.getByRole('button', { name: 'New request' }).click();
  const urlField = app.getByLabel('Request URL');
  await urlField.click();
  await app.keyboard.press('Control+A');
  await app.keyboard.type(idp.url('/protected'));

  // Switch to the Auth tab and pick client-credentials.
  await app.getByRole('button', { name: 'Auth', exact: true }).click();
  await app.getByLabel('Auth type').selectOption('oauth2-client-credentials');

  // Fill in IdP fields. Token URL points at the mock IdP we just spun up.
  await app.getByLabel('Token URL').fill(idp.url('/token'));
  await app.getByLabel('Client ID').fill('cc-client');
  await app.getByLabel('Client Secret', { exact: true }).fill('cc-secret');

  // Run the flow.
  await app.getByRole('button', { name: /^Get token$/i }).click();
  await expect(app.getByText(/Token cached/i)).toBeVisible({ timeout: 10_000 });

  // Send the request — must arrive at /protected with the right Bearer.
  await app.getByRole('button', { name: 'Send', exact: true }).click();

  // Status badge shows 200 OK.
  await expect(app.getByText(/^200 OK$/)).toBeVisible({ timeout: 10_000 });

  // Response body confirms the IdP saw the right Authorization header.
  // Mock IdP echoes back `sawAuth` so we can assert the exact value.
  const responseBody = app.getByLabel('Response body');
  await expect(responseBody).toContainText('Bearer tk-cc-cc-client');
});

test('client_credentials: refresh button rotates the access token', async ({ app }) => {
  await app.getByRole('button', { name: 'New request' }).click();
  await app.getByRole('button', { name: 'Auth', exact: true }).click();
  await app.getByLabel('Auth type').selectOption('oauth2-client-credentials');
  await app.getByLabel('Token URL').fill(idp.url('/token'));
  await app.getByLabel('Client ID').fill('cc-rotate');
  await app.getByLabel('Client Secret', { exact: true }).fill('s');

  // First flow → token cached.
  await app.getByRole('button', { name: /^Get token$/i }).click();
  await expect(app.getByText(/Token cached/i)).toBeVisible({ timeout: 10_000 });

  // Re-run flow (button label changes once a token is cached).
  await app.getByRole('button', { name: /^Re-run flow$/i }).click();
  await expect(app.getByText(/Token acquired\./i)).toBeVisible({ timeout: 10_000 });
});
