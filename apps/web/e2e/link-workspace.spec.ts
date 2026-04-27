import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers':
    'x-oauth-scopes, x-accepted-oauth-scopes, x-ratelimit-remaining, x-ratelimit-reset',
};

async function fulfillJson(
  page: Page,
  url: string | RegExp,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  await page.route(url, async (route) => {
    await route.fulfill({
      status,
      headers: { 'content-type': 'application/json', ...corsHeaders, ...extraHeaders },
      body: JSON.stringify(body),
    });
  });
}

async function setupSession(app: Page): Promise<void> {
  await fulfillJson(
    app,
    'https://api.github.com/user',
    200,
    { login: 'me', id: 1 },
    { 'x-oauth-scopes': 'repo, pull_request' },
  );
  await app.getByRole('button', { name: /Open Secret Vault/ }).click();
  await app.getByRole('button', { name: /Sessions/ }).click();
  await app.getByLabel('GitHub PAT').fill('tok');
  await app.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.getByText(/Connected as me/)).toBeVisible();
  await app.keyboard.press('Escape');
}

test.describe('Link Workspace (P5.2)', () => {
  test('private link → fetch source workspace.json → confirm → card visible', async ({ app }) => {
    await setupSession(app);

    const remoteJson = JSON.stringify({
      workspaceName: 'Payments API',
      releases: {
        self: {
          versions: [
            {
              version: '1.0.0',
              publishedAt: 't',
              notes: 'first',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '1.0.0',
        },
      },
    });
    const base64 = Buffer.from(remoteJson, 'utf-8').toString('base64');
    await app.route(
      'https://api.github.com/repos/org/payments-api/contents/workspace.json**',
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            type: 'file',
            path: 'workspace.json',
            sha: 'remote-sha-1',
            size: remoteJson.length,
            content: base64,
            encoding: 'base64',
          }),
        });
      },
    );

    await app.getByRole('button', { name: /Link Workspace/ }).click();
    await app.getByRole('button', { name: /Link a private workspace/ }).click();
    await app.getByLabel('Linked repo full name').fill('org/payments-api');
    await app.getByRole('button', { name: /Review .* link/ }).click();
    await app.getByRole('button', { name: 'Link', exact: true }).click();

    await expect(app.getByText('Payments API')).toBeVisible();
    await expect(app.getByText('org/payments-api@main')).toBeVisible();
    await expect(app.getByLabel('Pin Payments API version')).toHaveValue('1.0.0');
  });

  test('switching the pin opens a confirm dialog and applies the new version', async ({ app }) => {
    await setupSession(app);
    const remoteJson = JSON.stringify({
      workspaceName: 'API',
      releases: {
        self: {
          versions: [
            {
              version: '0.1.0',
              publishedAt: 't',
              notes: 'first',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
            {
              version: '0.2.0',
              publishedAt: 't',
              notes: 'second',
              workspaceSnapshot: 'b'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '0.2.0',
        },
      },
    });
    const base64 = Buffer.from(remoteJson, 'utf-8').toString('base64');
    await app.route(
      'https://api.github.com/repos/me/api/contents/workspace.json**',
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            type: 'file',
            path: 'workspace.json',
            sha: 's',
            size: remoteJson.length,
            content: base64,
            encoding: 'base64',
          }),
        });
      },
    );

    await app.getByRole('button', { name: /Link Workspace/ }).click();
    await app.getByRole('button', { name: /Link a private workspace/ }).click();
    await app.getByLabel('Linked repo full name').fill('me/api');
    await app.getByRole('button', { name: /Review .* link/ }).click();
    await app.getByRole('button', { name: 'Link', exact: true }).click();

    // The select reflects the auto-pinned currentVersion.
    const pinSelect = app.getByLabel('Pin API version');
    await expect(pinSelect).toHaveValue('0.2.0');

    // Switching opens the confirm dialog.
    await pinSelect.selectOption('0.1.0');
    await expect(app.getByRole('dialog', { name: /Pin API to v0\.1\.0/ })).toBeVisible();
    await app.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(pinSelect).toHaveValue('0.1.0');
  });

  test('required-key flow: declare → provision value → remove', async ({ app }) => {
    await setupSession(app);
    const remoteJson = JSON.stringify({ workspaceName: 'API', releases: { self: null } });
    const base64 = Buffer.from(remoteJson, 'utf-8').toString('base64');
    await app.route(
      'https://api.github.com/repos/me/api/contents/workspace.json**',
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            type: 'file',
            path: 'workspace.json',
            sha: 's',
            size: remoteJson.length,
            content: base64,
            encoding: 'base64',
          }),
        });
      },
    );

    await app.getByRole('button', { name: /Link Workspace/ }).click();
    await app.getByRole('button', { name: /Link a private workspace/ }).click();
    await app.getByLabel('Linked repo full name').fill('me/api');
    await app.getByRole('button', { name: /Review .* link/ }).click();
    await app.getByRole('button', { name: 'Link', exact: true }).click();

    // Empty state.
    await expect(app.getByText(/No required keys declared/)).toBeVisible();

    // Declare a required key.
    await app.getByLabel('Add required key').fill('API_KEY');
    await app.getByRole('button', { name: /Add key/ }).click();
    await expect(app.getByText('API_KEY')).toBeVisible();
    await expect(app.getByText('missing').first()).toBeVisible();

    // Provision a value.
    await app.getByRole('button', { name: 'Set value' }).click();
    await app.getByLabel('Value for API_KEY').fill('top-secret');
    await app.getByRole('button', { name: 'Save' }).click();
    await expect(app.getByText('set').first()).toBeVisible();

    // Remove the key (requires confirm).
    await app.getByRole('button', { name: 'Remove key API_KEY' }).click();
    await app.getByRole('button', { name: 'Remove', exact: true }).last().click();
    await expect(app.getByText(/No required keys declared/)).toBeVisible();
  });

  test('unlink removes the card', async ({ app }) => {
    await setupSession(app);
    const remoteJson = JSON.stringify({ workspaceName: 'X', releases: { self: null } });
    const base64 = Buffer.from(remoteJson, 'utf-8').toString('base64');
    await app.route(
      'https://api.github.com/repos/me/x/contents/workspace.json**',
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            type: 'file',
            path: 'workspace.json',
            sha: 's',
            size: remoteJson.length,
            content: base64,
            encoding: 'base64',
          }),
        });
      },
    );

    await app.getByRole('button', { name: /Link Workspace/ }).click();
    await app.getByRole('button', { name: /Link a private workspace/ }).click();
    await app.getByLabel('Linked repo full name').fill('me/x');
    await app.getByRole('button', { name: /Review .* link/ }).click();
    await app.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(app.getByText('X').first()).toBeVisible();

    await app.getByRole('button', { name: 'Unlink' }).click();
    // Confirm dialog has its own "Unlink" button — pick the modal one (last).
    await app.getByRole('button', { name: 'Unlink', exact: true }).last().click();
    await expect(app.getByText('me/x@main')).not.toBeVisible();
  });
});
