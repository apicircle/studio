import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module WS.
import { tcMapWS } from './fixtures/tcMapWS';
void Object.keys(tcMapWS);

function id(key: string): TcId {
  const v = tcMapWS[key];
  if (!v) throw new Error(`No TC-WS entry for "${key}"`);
  return v;
}
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
  test(
    tc(
      id('Link to Git :: Link unlinked workspace to GitHub repo'),
      'connect with full scopes → active session card @smoke',
    ),
    async ({ app }) => {
      await mockGitHubUser(app, { login: 'devaprakash', id: 7, scopes: 'repo, pull_request' });

      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: /Sessions/ }).click();

      await app.getByLabel('GitHub PAT').fill('ghp_test_full');
      await app.getByRole('button', { name: 'Connect', exact: true }).click();

      await expect(app.getByText(/Connected as devaprakash/)).toBeVisible();
      await expect(app.getByText('repo, pull_request')).toBeVisible();
    },
  );

  test(
    tc(
      id('Link to Git :: OAuth scope denial blocks linking'),
      'connect with classic `repo` scope satisfies PR capability',
    ),
    async ({ app }) => {
      // A classic PAT with only the `repo` scope still covers pull-request
      // creation — `checkPrCapabilityFromScopes(['repo'])` resolves `true`,
      // so the session connects with both the `repo` and `pull_request`
      // chips marked present and no missing-scope warning fires.
      await mockGitHubUser(app, { login: 'me', id: 1, scopes: 'repo' });

      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: /Sessions/ }).click();
      await app.getByLabel('GitHub PAT').fill('ghp_repo_only');
      await app.getByRole('button', { name: 'Connect', exact: true }).click();

      await expect(app.getByText(/Connected as me/)).toBeVisible();
      // Both scope chips report "present": `repo` is granted directly and
      // `pull_request` is satisfied via the classic-PAT capability check.
      await expect(app.getByLabel('repo scope present')).toBeVisible();
      await expect(app.getByLabel('pull_request scope present')).toBeVisible();
    },
  );

  test(
    tc(
      id('Link to Git :: Token revoked surfaces re-auth prompt'),
      'B.2 Test-connection — pass surfaces "Connection healthy" banner',
    ),
    async ({ app }) => {
      await mockGitHubUser(app, { login: 'me', id: 1, scopes: 'repo, pull_request' });

      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: /Sessions/ }).click();
      await app.getByLabel('GitHub PAT').fill('tok');
      await app.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(app.getByText(/Connected as me/)).toBeVisible();

      await app.getByRole('button', { name: 'Test GitHub connection' }).click();
      await expect(app.getByText(/Connection healthy/)).toBeVisible();
    },
  );

  test(
    tc(
      id('Link to Git :: Link to repo without write permission'),
      'B.2 Test-connection — 401 surfaces "Token rejected" with reconnect copy',
    ),
    async ({ app }) => {
      // First /user call: connect succeeds. Second /user call (the test):
      // 401 — token has been revoked between connect and test.
      let calls = 0;
      await app.route('https://api.github.com/user', async (route) => {
        calls += 1;
        if (calls === 1) {
          await route.fulfill({
            status: 200,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': '*',
              'access-control-expose-headers':
                'x-oauth-scopes, x-accepted-oauth-scopes, x-ratelimit-remaining, x-ratelimit-reset',
              'x-oauth-scopes': 'repo, pull_request',
            },
            body: JSON.stringify({ login: 'me', id: 1 }),
          });
        } else {
          await route.fulfill({
            status: 401,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': '*',
            },
            body: JSON.stringify({ message: 'Bad credentials' }),
          });
        }
      });

      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: /Sessions/ }).click();
      await app.getByLabel('GitHub PAT').fill('tok');
      await app.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(app.getByText(/Connected as me/)).toBeVisible();

      await app.getByRole('button', { name: 'Test GitHub connection' }).click();
      await expect(app.getByText(/Token rejected by GitHub \(401\)/)).toBeVisible();
    },
  );

  test(
    tc(
      id('Delete :: Delete requires confirmation'),
      'disconnect requires confirmation then clears the session',
    ),
    async ({ app }) => {
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
    },
  );
});
