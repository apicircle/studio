import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

// Plan §10.2 "Workspace + Git" suite (Sessions slice).
// Connect a PAT → live session card shows account + scopes; missing
// `pull_request` scope renders the inline warning. Disconnect with the
// two-click confirmation gate.
//
// We mock the GitHub API by intercepting `https://api.github.com/user`
// at the Playwright route level. Real GitHub responses include CORS
// `Access-Control-Expose-Headers` listing `x-oauth-scopes` so JS can
// read it; without that the browser strips custom headers from
// cross-origin responses and our mock would look like a token with
// zero scopes.

interface UserMockOptions {
  login: string;
  id: number;
  scopes: string;
}

async function mockGitHubUser(page: Page, opts: UserMockOptions): Promise<void> {
  await page.route('https://api.github.com/user', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-expose-headers':
          'x-oauth-scopes, x-accepted-oauth-scopes, x-ratelimit-remaining, x-ratelimit-reset',
        'x-oauth-scopes': opts.scopes,
      },
      body: JSON.stringify({ login: opts.login, id: opts.id }),
    });
  });
}

test.describe('Sessions (Secret Vault)', () => {
  test('connect with full scopes → active session card', async ({ app }) => {
    await mockGitHubUser(app, { login: 'devaprakash', id: 7, scopes: 'repo, pull_request' });

    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await app.getByRole('button', { name: /Sessions/ }).click();

    await app.getByLabel('GitHub PAT').fill('ghp_test_full');
    await app.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(app.getByText(/Connected as devaprakash/)).toBeVisible();
    await expect(app.getByText('repo, pull_request')).toBeVisible();
  });

  test('connect with only `repo` shows the missing-pull_request warning', async ({ app }) => {
    await mockGitHubUser(app, { login: 'me', id: 1, scopes: 'repo' });

    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await app.getByRole('button', { name: /Sessions/ }).click();
    await app.getByLabel('GitHub PAT').fill('ghp_repo_only');
    await app.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(app.getByText(/does not include the/)).toBeVisible();
  });

  test('disconnect requires confirmation then clears the session', async ({ app }) => {
    await mockGitHubUser(app, { login: 'me', id: 1, scopes: 'repo, pull_request' });

    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await app.getByRole('button', { name: /Sessions/ }).click();
    await app.getByLabel('GitHub PAT').fill('tok');
    await app.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(app.getByText(/Connected as me/)).toBeVisible();

    await app.getByRole('button', { name: 'Disconnect' }).click();
    await app.getByRole('button', { name: 'Confirm disconnect' }).click();
    // The connect form returns once the session is gone.
    await expect(app.getByLabel('GitHub PAT')).toBeVisible();
  });
});
