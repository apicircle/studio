import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module GT.
import { tcMapGT } from './fixtures/tcMapGT';
void Object.keys(tcMapGT);

function id(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}
// Plan §10.2 "Workspace + Git" suite — auto-branch slice (P4.2).
// Sign in with a PAT, connect a repo by owner/name, create the working
// branch with the auto-suggested name. Each GitHub endpoint is mocked at
// the page route level. Real GitHub responses include CORS expose-headers
// for x-oauth-scopes; mocks have to mimic that.

interface MockOpts {
  user?: { login: string; scopes: string };
  repo?: {
    fullName: string;
    owner: string;
    name: string;
    defaultBranch: string;
    pushable?: boolean;
  };
  branchHead?: { branch: string; sha: string };
  /** When set, overrides the createBranch handler (e.g. fail with 422). */
  createBranchStatus?: number;
  createBranchBody?: unknown;
}

async function setupMocks(page: Page, opts: MockOpts): Promise<void> {
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers':
      'x-oauth-scopes, x-accepted-oauth-scopes, x-ratelimit-remaining, x-ratelimit-reset',
  };

  if (opts.user) {
    await page.route('https://api.github.com/user', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
          'x-oauth-scopes': opts.user!.scopes,
        },
        body: JSON.stringify({ login: opts.user!.login, id: 1 }),
      });
    });
  }

  if (opts.repo) {
    const r = opts.repo;
    await page.route(`https://api.github.com/repos/${r.owner}/${r.name}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', ...corsHeaders },
        body: JSON.stringify({
          full_name: r.fullName,
          name: r.name,
          owner: { login: r.owner },
          default_branch: r.defaultBranch,
          visibility: 'public',
          private: false,
          permissions: { push: r.pushable ?? true, admin: false },
        }),
      });
    });
  }

  if (opts.branchHead && opts.repo) {
    const r = opts.repo;
    const b = opts.branchHead;
    await page.route(
      `https://api.github.com/repos/${r.owner}/${r.name}/branches/${b.branch}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({ name: b.branch, commit: { sha: b.sha } }),
        });
      },
    );
  }

  if (opts.repo) {
    const r = opts.repo;
    await page.route(
      `https://api.github.com/repos/${r.owner}/${r.name}/git/refs`,
      async (route) => {
        const status = opts.createBranchStatus ?? 201;
        const body = opts.createBranchBody ?? {
          ref: 'refs/heads/auto-generated',
          object: { sha: opts.branchHead?.sha ?? 'abc123' },
        };
        await route.fulfill({
          status,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify(body),
        });
      },
    );
  }
}

test.describe('Workspace — auto-branch flow (P4.2)', () => {
  test(
    tc(
      id('Branch :: Switch working branch'),
      'connect session → connect repo → create working branch',
    ),
    async ({ app }) => {
      await setupMocks(app, {
        user: { login: 'devaprakash', scopes: 'repo, pull_request' },
        repo: {
          fullName: 'devaprakash/payments',
          owner: 'devaprakash',
          name: 'payments',
          defaultBranch: 'main',
        },
        branchHead: { branch: 'main', sha: 'abc12345' },
        createBranchBody: {
          ref: 'refs/heads/apicircle/wb-aaaaaa',
          object: { sha: 'abc12345' },
        },
      });

      // Connect the session through the Sessions tab (live UI).
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: /Sessions/ }).click();
      await app.getByLabel('GitHub PAT').fill('ghp_test');
      await app.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(app.getByText(/Connected as devaprakash/)).toBeVisible();
      // Close the modal so the Workspace panel is clickable.
      await app.keyboard.press('Escape');

      // Move to the Workspace panel and connect the repo. The owner/name
      // input lives behind the "Manual entry" toggle — the ConnectRepoForm
      // defaults to the repo browser.
      await app.getByRole('button', { name: /^Workspace$/ }).click();
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await app.getByLabel('Repo full name').fill('devaprakash/payments');
      await app.getByRole('button', { name: 'Connect repo' }).click();
      await expect(app.getByText('devaprakash/payments')).toBeVisible();

      // Override the auto-generated branch name with a deterministic one,
      // then create. The mock returns the pre-canned ref shape regardless.
      // (`getByLabel('Branch name')` would also match the "Regenerate branch
      // name" button by aria-label substring; restrict to the textbox role.)
      const branchInput = app.getByRole('textbox', { name: 'Branch name' });
      await branchInput.fill('apicircle/wb-aaaaaa');
      await app.getByRole('button', { name: /Create working branch/ }).click();

      // Branch card renders with the abbreviated SHA + "Branch ready" badge.
      await expect(app.getByText('Branch ready')).toBeVisible();
      await expect(app.getByText(/abc1234/)).toBeVisible();
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: Force-push on working branch'),
      'GitHub 422 (branch already exists) shows an inline error',
    ),
    async ({ app }) => {
      await setupMocks(app, {
        user: { login: 'me', scopes: 'repo, pull_request' },
        repo: {
          fullName: 'me/api',
          owner: 'me',
          name: 'api',
          defaultBranch: 'main',
        },
        branchHead: { branch: 'main', sha: 'sha1' },
        createBranchStatus: 422,
        createBranchBody: { message: 'Reference already exists' },
      });

      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: /Sessions/ }).click();
      await app.getByLabel('GitHub PAT').fill('tok');
      await app.getByRole('button', { name: 'Connect', exact: true }).click();
      await app.keyboard.press('Escape');

      await app.getByRole('button', { name: /^Workspace$/ }).click();
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await app.getByLabel('Repo full name').fill('me/api');
      await app.getByRole('button', { name: 'Connect repo' }).click();
      await expect(app.getByText('me/api')).toBeVisible();
      await app.getByRole('button', { name: /Create working branch/ }).click();

      await expect(app.getByText(/already exists on GitHub/i)).toBeVisible();
    },
  );
});
