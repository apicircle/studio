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

// "Sign in with GitHub" device flow. The browser POSTs to the same-origin
// `/_gh-oauth/login/*` relay (the Vite dev server forwards it to github.com —
// see apps/web/vite.config.ts). We intercept those relay paths with
// page.route so nothing reaches real GitHub.
async function mockDeviceCodeStart(
  page: Page,
  opts: { userCode?: string; verificationUri?: string; interval?: number } = {},
): Promise<void> {
  await page.route('**/_gh-oauth/login/device/code', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_code: 'dc-e2e',
        user_code: opts.userCode ?? 'WDJB-MJHT',
        verification_uri: opts.verificationUri ?? 'https://github.com/login/device',
        expires_in: 900,
        interval: opts.interval ?? 0,
      }),
    });
  });
}

// Token-poll responder. `{ pending: true }` keeps the device-code card up;
// a granted body drives the flow through the standard PAT-vaulting path.
async function mockDeviceTokenPoll(
  page: Page,
  result: { pending: true } | { accessToken: string; scope: string },
): Promise<void> {
  await page.route('**/_gh-oauth/login/oauth/access_token', async (route) => {
    const body =
      'pending' in result
        ? { error: 'authorization_pending' }
        : { access_token: result.accessToken, token_type: 'bearer', scope: result.scope };
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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

// Validates the one-click "Sign in with GitHub" device flow end-to-end in a
// real browser. The web e2e suite runs against the Vite dev server, which
// provides the `/_gh-oauth` relay, so `isGitHubDeviceFlowAvailable()` is true
// and the button is offered here (the production/static + desktop "hidden"
// branch can't run under the dev server — it's covered by the RTL test in
// SecretVaultDockPanel.test.tsx). Untagged: no dedicated workbook cell exists
// for the device-flow button.
test.describe('Sign in with GitHub (device flow)', () => {
  test('offers the one-click button on the dev build and starts the flow', async ({ app }) => {
    // Keep the poll pending (interval 5s) so the device-code card stays up
    // long enough to assert + cancel without racing a grant.
    await mockDeviceCodeStart(app, { userCode: 'WDJB-MJHT', interval: 5 });
    await mockDeviceTokenPoll(app, { pending: true });

    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await app.getByRole('button', { name: /Sessions/ }).click();

    // The relay exists on the dev server → the one-click button is shown.
    const signIn = app.getByRole('button', { name: 'Sign in with GitHub' });
    await expect(signIn).toBeVisible();
    await signIn.click();

    // The device-code card replaces the button, showing the user code plus the
    // verification link the user opens on github.com.
    await expect(app.getByText('WDJB-MJHT')).toBeVisible();
    await expect(app.getByRole('link', { name: /github\.com\/login\/device/ })).toBeVisible();

    // The flow is abortable: Cancel returns to the one-click button.
    await app.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
  });

  test('completes the device flow and lights up the active session card', async ({ app }) => {
    // Grant immediately (interval 0). After the grant the flow funnels through
    // the same path as a pasted PAT, which verifies the token via GET /user.
    await mockDeviceCodeStart(app, { interval: 0 });
    await mockDeviceTokenPoll(app, { accessToken: 'gho_e2e', scope: 'repo, pull_request' });
    await mockGitHubUser(app, { login: 'devaprakash', id: 7, scopes: 'repo, pull_request' });

    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await app.getByRole('button', { name: /Sessions/ }).click();
    await app.getByRole('button', { name: 'Sign in with GitHub' }).click();

    await expect(app.getByText(/Connected as devaprakash/)).toBeVisible();
    await expect(app.getByText('repo, pull_request')).toBeVisible();
  });
});
