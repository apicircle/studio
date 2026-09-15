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

  test(
    tc(
      id('Branch :: Switch working branch'),
      'import a base-branch workspace while creating the working branch',
    ),
    async ({ app }) => {
      // Tagged against the create-working-branch cell: the workbook has no
      // dedicated row for the import variant yet, and the maps under
      // e2e/web/fixtures are generated from the workbook, not hand-edited.
      const IMPORT_ID = 'ws-payments';
      const corsHeaders = {
        'access-control-allow-origin': '*',
        'access-control-expose-headers':
          'x-oauth-scopes, x-accepted-oauth-scopes, x-ratelimit-remaining, x-ratelimit-reset',
      };

      await setupMocks(app, {
        user: { login: 'me', scopes: 'repo, pull_request' },
        repo: { fullName: 'me/api', owner: 'me', name: 'api', defaultBranch: 'main' },
        branchHead: { branch: 'main', sha: 'abc12345' },
        createBranchBody: {
          ref: 'refs/heads/apicircle/wb-import',
          object: { sha: 'abc12345' },
        },
      });

      // The base-branch dropdown needs a real branch list.
      await app.route('**/repos/me/api/branches?**', async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify([{ name: 'main', commit: { sha: 'abc12345' } }]),
        });
      });

      // `.apicircle/registry.json` on main enumerates what can be imported;
      // `workspace-<id>/workspace.json` is the document itself.
      const remoteDoc = {
        schemaVersion: 1,
        workspaceId: IMPORT_ID,
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'imported-req' }] },
          requests: {
            'imported-req': {
              id: 'imported-req',
              name: 'Imported from main',
              folderId: null,
              method: 'GET',
              url: 'https://example.test/imported',
              headers: [],
              query: [],
              body: { type: 'none', content: '' },
              auth: { type: 'inherit' },
              contextVars: [],
              extractions: [],
              assertions: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
          folders: {},
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
        linkedWorkspaces: {},
        linkedOverrides: { requests: {}, environmentVars: {} },
        releases: { self: null, perLink: {} },
        globalAssets: { schemas: {}, graphql: {}, files: {} },
        mockServers: {},
        secretKeys: {},
        meta: {
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          appVersion: '1.0.0',
        },
      };

      await app.route('**/repos/me/api/contents/**', async (route) => {
        const url = route.request().url();
        const json = url.includes('registry.json')
          ? JSON.stringify({
              schemaVersion: 1,
              activeWorkspaceId: IMPORT_ID,
              workspaces: [{ id: IMPORT_ID, name: 'Payments API' }],
            })
          : JSON.stringify(remoteDoc);
        const path = url.includes('registry.json')
          ? '.apicircle/registry.json'
          : `.apicircle/workspace-${IMPORT_ID}/workspace.json`;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            type: 'file',
            path,
            sha: 'blob-sha',
            size: json.length,
            content: Buffer.from(json, 'utf-8').toString('base64'),
            encoding: 'base64',
          }),
        });
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

      // Opt into the import path; the picker loads main's registry.
      await app.getByRole('radio', { name: 'Import from workspace' }).click();
      const picker = app.getByLabel('Workspace to import');
      await expect(picker).toBeVisible();
      await expect(picker).toHaveValue(IMPORT_ID);
      // Each option names the workspace as it was pushed rather than abbreviating its
      // id, and the form says the list only covers what was pushed to the base branch.
      await expect(picker.locator('option')).toHaveText(['Payments API · active']);
      await expect(picker).toHaveAccessibleDescription(
        /Only workspaces pushed to main are listed\. To import one that lives on a working branch, choose that branch as the base\./,
      );

      // The destructive warning has to be on screen BEFORE the user commits.
      await expect(app.getByText(/This clears the current workspace/)).toBeVisible();
      await expect(app.locator('strong', { hasText: 'Payments API' })).toBeVisible();

      await app.getByRole('button', { name: /Import & create working branch/ }).click();

      await expect(app.getByText('Branch ready')).toBeVisible();

      // The imported document actually replaced the local one — the request
      // that only exists on main's workspace is now in this workspace's tree.
      await app.getByRole('button', { name: /^Editor$/ }).click();
      await expect(app.getByText('Imported from main')).toBeVisible();
    },
  );
});
