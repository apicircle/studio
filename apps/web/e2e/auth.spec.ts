import { expect, test } from './fixtures/app';
import type { Page } from '@playwright/test';

// P13 — Auth tab. Covers all 17 schemes the dropdown surfaces:
// none / inherit / bearer / basic / api-key / custom-header
// + 6 OAuth2 grants + AWS SigV4 / Digest / NTLM / Hawk / JWT Bearer.
// We don't run real OAuth2 dances — these tests verify the form fields
// render + persist into the synced doc, and the simpler schemes are
// exercised end-to-end via the Send button.
//
// SecretInput-backed fields collide with `getByLabel(name)` because the
// show/hide toggle is `aria-label="Show <name>"`. Use the textbox role
// + exact:true to disambiguate.

async function openAuthTab(app: Page): Promise<void> {
  await app.getByLabel('New request').click();
  await app.getByRole('button', { name: /^Auth/ }).first().click();
}

const tx = (app: Page, name: string) => app.getByRole('textbox', { name, exact: true });

test.describe('Auth tab (P13)', () => {
  test('renders the No Auth note by default', async ({ app }) => {
    await openAuthTab(app);
    await expect(app.getByText(/No authentication will be added/)).toBeVisible();
  });

  test('Bearer token form persists into the request', async ({ app, mockApi }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('bearer');
    await tx(app, 'Bearer token').fill('tok-abc');

    await app.getByLabel('Request URL').fill('https://api.example.test/me');
    await mockApi.json(/api\.example\.test\/me/, { ok: true });
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200/)).toBeVisible();
  });

  test('Basic auth shows username + password fields', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('basic');
    await expect(tx(app, 'Username')).toBeVisible();
    await expect(tx(app, 'Password')).toBeVisible();

    await tx(app, 'Username').fill('aladdin');
    await tx(app, 'Password').fill('open sesame');
    await expect(tx(app, 'Username')).toHaveValue('aladdin');
  });

  test('API Key form shows Add-to selector with all three options', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('api-key');
    await expect(tx(app, 'API key name')).toBeVisible();
    await expect(tx(app, 'API key value')).toBeVisible();
    const select = app.getByLabel('API key add-to');
    await select.selectOption('query');
    await expect(select).toHaveValue('query');
    await select.selectOption('cookie');
    await expect(select).toHaveValue('cookie');
  });

  test('Custom header form renders', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('custom-header');
    await expect(tx(app, 'Header name')).toBeVisible();
    await expect(tx(app, 'Header value')).toBeVisible();
  });

  test('OAuth2 client credentials form renders all canonical fields', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('oauth2-client-credentials');
    await expect(tx(app, 'Token URL')).toBeVisible();
    await expect(tx(app, 'Client ID')).toBeVisible();
    await expect(tx(app, 'Client secret')).toBeVisible();
    await expect(tx(app, 'Scope')).toBeVisible();
    await expect(app.getByLabel('Client auth method')).toBeVisible();
    await expect(tx(app, 'Access token')).toBeVisible();
  });

  test('OAuth2 authorization code form has authUrl + redirectUri + state', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('oauth2-auth-code');
    await expect(tx(app, 'Authorization URL')).toBeVisible();
    await expect(tx(app, 'Redirect URI')).toBeVisible();
    await expect(tx(app, 'State')).toBeVisible();
  });

  test('OAuth2 PKCE shows code verifier + challenge method', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('oauth2-pkce');
    await expect(tx(app, 'Code verifier (PKCE)')).toBeVisible();
    const challengeMethod = app.getByLabel('PKCE code challenge method');
    await expect(challengeMethod).toHaveValue('S256');
    await challengeMethod.selectOption('plain');
    await expect(challengeMethod).toHaveValue('plain');
  });

  test('OAuth2 ROPC shows username + password fields', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('oauth2-password');
    await expect(tx(app, 'Username')).toBeVisible();
    await expect(tx(app, 'Password')).toBeVisible();
  });

  test('OAuth2 implicit form has just authUrl + clientId + redirectUri', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('oauth2-implicit');
    await expect(tx(app, 'Authorization URL')).toBeVisible();
    await expect(tx(app, 'Client ID')).toBeVisible();
    await expect(tx(app, 'Redirect URI')).toBeVisible();
  });

  test('OAuth2 device shows device authorization URL', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('oauth2-device');
    await expect(tx(app, 'Device authorization URL')).toBeVisible();
  });

  test('AWS SigV4 form shows region, service, and add-to selector', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('aws-sigv4');
    await expect(tx(app, 'AWS access key ID')).toBeVisible();
    await expect(tx(app, 'AWS region')).toHaveValue('us-east-1');
    await expect(tx(app, 'AWS service')).toBeVisible();
    await expect(app.getByLabel('SigV4 add-to')).toBeVisible();
  });

  test('Hawk form shows id, key, algorithm, ext', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('hawk');
    await expect(tx(app, 'Hawk ID')).toBeVisible();
    await expect(tx(app, 'Hawk key')).toBeVisible();
    const algo = app.getByLabel('Hawk algorithm');
    await expect(algo).toHaveValue('sha256');
    await algo.selectOption('sha1');
    await expect(algo).toHaveValue('sha1');
  });

  test('JWT Bearer with HS256 shows algorithm + signing key + payload + token override', async ({
    app,
  }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('jwt-bearer');
    await expect(app.getByLabel('JWT algorithm')).toHaveValue('HS256');
    await expect(tx(app, 'JWT signing key')).toBeVisible();
    await expect(app.getByRole('textbox', { name: 'JWT payload' })).toBeVisible();
    await expect(tx(app, 'JWT token')).toBeVisible();
  });

  test('Digest shows the deferred-handling note', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('digest');
    await expect(app.getByText(/Digest is challenge-based/i)).toBeVisible();
  });

  test('NTLM shows domain + workstation fields and a deferred-handling note', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('ntlm');
    await expect(tx(app, 'NTLM domain')).toBeVisible();
    await expect(tx(app, 'NTLM workstation')).toBeVisible();
    await expect(app.getByText(/NTLM is a multi-round handshake/i)).toBeVisible();
  });

  test('Inherit shows the parent-folder explanatory note', async ({ app }) => {
    await openAuthTab(app);
    await app.getByLabel('Auth type').selectOption('inherit');
    await expect(app.getByText(/Auth will be inherited from the parent folder/i)).toBeVisible();
  });
});
