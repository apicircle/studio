import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

// Plan §3.3 push-to-save (P4.3a). Connect a session, connect a repo,
// create a branch, then push the synced doc as workspace.json via the
// Git Tree API. Each of the 5 GitHub endpoints is mocked at the page
// route level.

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

async function setupConnectedBranch(app: Page): Promise<void> {
  await fulfillJson(
    app,
    'https://api.github.com/user',
    200,
    { login: 'me', id: 1 },
    { 'x-oauth-scopes': 'repo, pull_request' },
  );
  await fulfillJson(app, 'https://api.github.com/repos/me/api', 200, {
    full_name: 'me/api',
    name: 'api',
    owner: { login: 'me' },
    default_branch: 'main',
    visibility: 'public',
    private: false,
    permissions: { push: true, admin: false },
  });
  await fulfillJson(app, 'https://api.github.com/repos/me/api/branches/main', 200, {
    name: 'main',
    commit: { sha: 'sha-main' },
  });
  // The branch creation endpoint also serves getRef (different paths share a
  // base URL — set up the more specific routes below before connecting).
  await app.route('https://api.github.com/repos/me/api/git/refs', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        headers: { 'content-type': 'application/json', ...corsHeaders },
        body: JSON.stringify({
          ref: 'refs/heads/apicircle/wb-test',
          object: { sha: 'sha-main' },
        }),
      });
      return;
    }
    await route.fallback();
  });

  // Drive the connect flow through the live UI.
  await app.getByRole('button', { name: /Open Secret Vault/ }).click();
  await app.getByRole('button', { name: /Sessions/ }).click();
  await app.getByLabel('GitHub PAT').fill('tok');
  await app.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.getByText(/Connected as me/)).toBeVisible();
  await app.keyboard.press('Escape');

  await app.getByRole('button', { name: /^Workspace$/ }).click();
  await app.getByLabel('Repo full name').fill('me/api');
  await app.getByRole('button', { name: 'Connect repo' }).click();
  await expect(app.getByText('me/api')).toBeVisible();

  const branchInput = app.getByRole('textbox', { name: 'Branch name' });
  await branchInput.fill('apicircle/wb-test');
  await app.getByRole('button', { name: /Create working branch/ }).click();
  await expect(app.getByText('Branch ready')).toBeVisible();
}

async function wirePushFlow(app: Page): Promise<void> {
  await fulfillJson(
    app,
    'https://api.github.com/repos/me/api/git/refs/heads/apicircle%2Fwb-test',
    200,
    { ref: 'refs/heads/apicircle/wb-test', object: { sha: 'sha-main' } },
  );
  await fulfillJson(app, /git\/commits\/sha-main/, 200, {
    sha: 'sha-main',
    message: 'initial',
    tree: { sha: 'tree-old' },
  });
  await fulfillJson(app, 'https://api.github.com/repos/me/api/git/trees', 200, {
    sha: 'tree-new',
  });
  await fulfillJson(app, 'https://api.github.com/repos/me/api/git/commits', 201, {
    sha: 'commit-new',
    message: 'sync',
    tree: { sha: 'tree-new' },
  });
  // PATCH updateRef shares the URL with the GET getRef route; method-aware.
  await app.route(
    'https://api.github.com/repos/me/api/git/refs/heads/apicircle%2Fwb-test',
    async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            ref: 'refs/heads/apicircle/wb-test',
            object: { sha: 'commit-new' },
          }),
        });
        return;
      }
      await route.fallback();
    },
  );
}

test.describe('Push to save (P4.3a)', () => {
  test('happy-path: push commits workspace.json and renders the new SHA', async ({ app }) => {
    await setupConnectedBranch(app);
    await wirePushFlow(app);

    await app.getByRole('button', { name: /Push to save/ }).click();
    await expect(app.getByText(/Pushed/)).toBeVisible();
    // The "up to date" marker appears once the lastPushedSha + headSha agree.
    await expect(app.getByText(/up to date/)).toBeVisible();
  });
});

test.describe('Sync attachments (P4.6b)', () => {
  test('Sync attachments button reports counts when no slots are referenced', async ({ app }) => {
    await setupConnectedBranch(app);
    await app.getByRole('button', { name: /Sync attachments/ }).click();
    await expect(app.getByText(/No attachments referenced/)).toBeVisible();
  });
});

test.describe('Refresh + 3-way conflict resolver (P4.5)', () => {
  test('up-to-date refresh updates the last-pulled timestamp', async ({ app }) => {
    await setupConnectedBranch(app);
    // Snapshot the local synced doc so the remote we mock matches it byte-
    // for-byte (force the up-to-date branch). B.6 keyed records by
    // workspaceId — read via the store bridge to stay schema-agnostic.
    const localJson = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: { getState: () => { synced: unknown } };
      };
      return JSON.stringify(w.__apicircleStore!.getState().synced);
    });
    const base64 = Buffer.from(localJson, 'utf-8').toString('base64');

    await app.route(
      'https://api.github.com/repos/me/api/contents/workspace.json**',
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            type: 'file',
            path: 'workspace.json',
            sha: 'remote-sha-1',
            size: localJson.length,
            content: base64,
            encoding: 'base64',
          }),
        });
      },
    );

    await app.getByRole('button', { name: /^Refresh$/ }).click();
    await expect(app.getByText(/Up to date with the remote/)).toBeVisible();
    await expect(app.getByText(/Last pulled:/)).toBeVisible();
  });

  test('divergent edits open the resolver, picking remote applies the merge', async ({ app }) => {
    await setupConnectedBranch(app);
    // Local renames the workspace; remote.json has a different name → conflict.
    await app.getByLabel('Workspace name').fill('Mine');

    const remoteSynced = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { synced: Record<string, unknown> };
        };
      };
      const synced = w.__apicircleStore!.getState().synced;
      return JSON.stringify({ ...synced, workspaceName: 'Theirs' });
    });
    const base64 = Buffer.from(remoteSynced, 'utf-8').toString('base64');

    await app.route(
      'https://api.github.com/repos/me/api/contents/workspace.json**',
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            type: 'file',
            path: 'workspace.json',
            sha: 'remote-sha-2',
            size: remoteSynced.length,
            content: base64,
            encoding: 'base64',
          }),
        });
      },
    );

    await app.getByRole('button', { name: /^Refresh$/ }).click();
    // Conflict resolver opens.
    await expect(app.getByRole('dialog', { name: /Resolve conflicts/ })).toBeVisible();
    // Pick the remote side for the workspaceName conflict.
    await app
      .getByRole('button', { name: /Theirs.*Theirs/s })
      .first()
      .click();
    await app.getByRole('button', { name: /Apply merge/ }).click();

    // After merge the workspace name input shows 'Theirs'.
    await expect(app.getByLabel('Workspace name')).toHaveValue('Theirs');
  });
});

test.describe('Create PR (P4.4)', () => {
  test('happy-path: open PR after push, link surfaces on the branch card', async ({ app }) => {
    await setupConnectedBranch(app);
    await wirePushFlow(app);
    // Mock the pulls endpoint.
    await fulfillJson(app, 'https://api.github.com/repos/me/api/pulls', 201, {
      number: 7,
      html_url: 'https://github.com/me/api/pull/7',
      state: 'open',
      title: 'APICircle workspace updates',
    });

    // Push so lastPushedSha is set and Create PR becomes enabled.
    await app.getByRole('button', { name: /Push to save/ }).click();
    await expect(app.getByText(/up to date/)).toBeVisible();

    await app.getByRole('button', { name: 'Create PR' }).click();
    // Modal renders with default title; user can override and edit body.
    await app.getByLabel('PR title').fill('Sync from studio');
    await app.getByLabel('PR body').fill('First push from API Circle Studio.');
    await app.getByRole('button', { name: 'Open PR' }).click();

    // The branch card surfaces the open PR link.
    await expect(app.getByText('PR open:')).toBeVisible();
    await expect(app.getByRole('link', { name: /me\/api\/pull\/7/ })).toBeVisible();
  });

  test('push that 403s with missing scope routes through the global gate', async ({ app }) => {
    await setupConnectedBranch(app);
    // First call (getRef) fails with 403 + missing `repo` to simulate the
    // user's token being downgraded between connect and push.
    await app.route(
      'https://api.github.com/repos/me/api/git/refs/heads/apicircle%2Fwb-test',
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 403,
            headers: {
              'content-type': 'application/json',
              ...corsHeaders,
              'x-oauth-scopes': 'public_repo',
              'x-accepted-oauth-scopes': 'repo',
            },
            body: JSON.stringify({ message: 'Resource not accessible by personal access token' }),
          });
          return;
        }
        await route.fallback();
      },
    );

    await app.getByRole('button', { name: /Push to save/ }).click();
    // Global gate fires — same modal that PR creation uses, lifted from
    // BranchCard local state into store-driven rendering at the App root.
    await expect(app.getByText('Token is missing required scope')).toBeVisible();
    await expect(app.getByRole('button', { name: /Open Sessions/ })).toBeVisible();
  });

  test('missing pull_request scope opens the update-token modal', async ({ app }) => {
    await setupConnectedBranch(app);
    await wirePushFlow(app);
    // 403 with `repo` granted but pull_request missing.
    await app.route('https://api.github.com/repos/me/api/pulls', async (route) => {
      await route.fulfill({
        status: 403,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
          'x-oauth-scopes': 'repo',
        },
        body: JSON.stringify({ message: 'Resource not accessible by personal access token' }),
      });
    });

    await app.getByRole('button', { name: /Push to save/ }).click();
    await expect(app.getByText(/up to date/)).toBeVisible();

    await app.getByRole('button', { name: 'Create PR' }).click();
    await app.getByRole('button', { name: 'Open PR' }).click();

    await expect(app.getByText('Token is missing required scope')).toBeVisible();
    await expect(app.getByRole('button', { name: /Open Sessions/ })).toBeVisible();
  });
});
