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
    await expect(app.getByText(/v1\.0\.0/).first()).toBeVisible();
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
