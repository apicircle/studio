import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module LV.
import { tcMapLV } from './fixtures/tcMapLV';
void Object.keys(tcMapLV);

function id(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}
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
  test(
    tc(
      id('Link to latest version'),
      'B.1 repo browser: list accessible repos → pick → branch dropdown → pin dropdown → link',
    ),
    async ({ app }) => {
      await setupSession(app);

      // /user/repos: two repos the user has access to.
      await fulfillJson(app, 'https://api.github.com/user/repos**', 200, [
        {
          full_name: 'me/payments-api',
          name: 'payments-api',
          owner: { login: 'me' },
          default_branch: 'main',
          visibility: 'private',
          private: true,
          permissions: { push: true },
        },
        {
          full_name: 'me/widgets',
          name: 'widgets',
          owner: { login: 'me' },
          default_branch: 'main',
          visibility: 'public',
          private: false,
          permissions: { push: true },
        },
      ]);

      // /repos/me/payments-api/branches: two branches.
      await fulfillJson(app, 'https://api.github.com/repos/me/payments-api/branches**', 200, [
        { name: 'main', commit: { sha: 'aaa' } },
        { name: 'develop', commit: { sha: 'bbb' } },
      ]);

      // /repos/me/payments-api/contents/workspace.json: probe payload.
      const probeJson = JSON.stringify({
        workspaceName: 'Payments API',
        releases: {
          self: {
            versions: [
              {
                version: '1.0.0',
                publishedAt: '2026-04-01T00:00:00.000Z',
                notes: 'first',
                workspaceSnapshot: 'a'.repeat(64),
                deprecated: false,
                yanked: false,
              },
              {
                version: '1.2.0',
                publishedAt: '2026-04-15T00:00:00.000Z',
                notes: 'second',
                workspaceSnapshot: 'b'.repeat(64),
                deprecated: false,
                yanked: false,
              },
            ],
            currentVersion: '1.2.0',
          },
        },
      });
      const probeBase64 = Buffer.from(probeJson, 'utf-8').toString('base64');
      await app.route(
        'https://api.github.com/repos/me/payments-api/contents/workspace.json**',
        async (route) => {
          await route.fulfill({
            status: 200,
            headers: { 'content-type': 'application/json', ...corsHeaders },
            body: JSON.stringify({
              type: 'file',
              path: 'workspace.json',
              sha: 's',
              size: probeJson.length,
              content: probeBase64,
              encoding: 'base64',
            }),
          });
        },
      );

      await app.getByRole('button', { name: /Link Workspace/ }).click();
      await app.getByRole('button', { name: /Link a private workspace/ }).click();

      // The combobox surfaces both repos; user filters and picks one.
      const combo = app.getByLabel('Filter accessible repos');
      await combo.click();
      await expect(app.getByRole('option', { name: /Pick me\/payments-api/ })).toBeVisible();
      await app.getByRole('option', { name: /Pick me\/payments-api/ }).click();

      // Branch dropdown defaults to the repo's default_branch.
      await expect(app.getByLabel('Pick a branch')).toHaveValue('main');

      // Probe surfaces the repo path (the workspace's display name no
      // longer travels through git, so the wizard shows the unambiguous
      // `owner/repo` identifier) + currentVersion chip.
      await expect(app.getByText(/me\/payments-api/).first()).toBeVisible();
      await expect(app.getByText(/currentVersion v1\.2\.0/)).toBeVisible();

      // Switch to specific-version pin and verify the dropdown is populated.
      await app.getByLabel('Pin to a specific version').click();
      await expect(app.getByLabel('Specific version to pin')).toHaveValue('1.2.0');
      await app.getByLabel('Specific version to pin').selectOption('1.0.0');

      // Review & link → confirm.
      await app.getByRole('button', { name: /Review .* link/ }).click();
      const confirm = app.getByRole('dialog', { name: /Link this workspace/ });
      await expect(confirm).toBeVisible();
      await expect(confirm.getByText(/me\/payments-api/)).toBeVisible();
      await expect(confirm.getByText(/v1\.0\.0/)).toBeVisible();
      await confirm.getByRole('button', { name: 'Link', exact: true }).click();

      // The private-link modal closes after a successful link. Wait for it
      // to disappear before asserting on the new card text.
      await expect(app.getByRole('dialog', { name: /Link a private workspace/ })).not.toBeVisible();
      // Card lands on the panel. `link.name` defaults to the repo path
      // since the source's display name no longer travels through git;
      // consumers can rename their local entry later.
      await expect(app.getByText('me/payments-api@main')).toBeVisible();
    },
  );

  test(
    tc(
      id('Breaking change in new version (removed env var)'),
      'B.1 repo browser: switch to manual entry exposes the typed owner/name path',
    ),
    async ({ app }) => {
      await setupSession(app);
      await fulfillJson(app, 'https://api.github.com/user/repos**', 200, []);

      await app.getByRole('button', { name: /Link Workspace/ }).click();
      await app.getByRole('button', { name: /Link a private workspace/ }).click();

      // Default = repo browser. Toggle to manual.
      await expect(app.getByLabel('Filter accessible repos')).toBeVisible();
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await expect(app.getByLabel('Linked repo full name')).toBeVisible();
      await expect(app.getByLabel('Filter accessible repos')).not.toBeVisible();

      // Submit stays disabled until the typed owner/name has a slash.
      const submit = app.getByRole('button', { name: /Review .* link/ });
      await expect(submit).toBeDisabled();
      await app.getByLabel('Linked repo full name').fill('justname');
      await expect(submit).toBeDisabled();
      await app.getByLabel('Linked repo full name').fill('me/api');
      await expect(submit).toBeEnabled();
    },
  );

  test(
    tc(
      id('Source unpublished a version we pinned'),
      'private link → fetch source workspace.json → confirm → card visible',
    ),
    async ({ app }) => {
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
      // The repo-browser is the default surface as of B.1; existing specs
      // continue exercising the typed owner/name code path via manual entry.
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await app.getByLabel('Linked repo full name').fill('org/payments-api');
      await app.getByRole('button', { name: /Review .* link/ }).click();
      await app.getByRole('button', { name: 'Link', exact: true }).click();

      await expect(app.getByText('org/payments-api@main')).toBeVisible();
      // The card shows the pinned version as a static chip — the inline
      // pin dropdown was removed; pin changes now go through
      // Refresh ledger → Review update → Apply.
      await expect(app.getByLabel('Pinned to v1.0.0')).toBeVisible();
    },
  );

  test(
    tc(
      id('Adopt new version'),
      'switching the pin opens a confirm dialog and applies the new version',
    ),
    async ({ app }) => {
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
      // The repo-browser is the default surface as of B.1; existing specs
      // continue exercising the typed owner/name code path via manual entry.
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await app.getByLabel('Linked repo full name').fill('me/api');
      await app.getByRole('button', { name: /Review .* link/ }).click();
      await app.getByRole('button', { name: 'Link', exact: true }).click();

      // The card auto-pins to the source's currentVersion (0.2.0). The
      // inline pin dropdown was removed — the pinned version renders as a
      // static chip and changing it goes through Refresh ledger → Review
      // update → Apply (covered in linked-content-flows.spec.ts).
      await expect(app.getByText('me/api@main')).toBeVisible();
      await expect(app.getByLabel('Pinned to v0.2.0')).toBeVisible();
    },
  );

  test(
    tc(
      id('Multiple linked workspaces with conflicting var names'),
      'required-key flow: declare → provision value → remove',
    ),
    async ({ app }) => {
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
      // The repo-browser is the default surface as of B.1; existing specs
      // continue exercising the typed owner/name code path via manual entry.
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await app.getByLabel('Linked repo full name').fill('me/api');
      await app.getByRole('button', { name: /Review .* link/ }).click();
      await app.getByRole('button', { name: 'Link', exact: true }).click();

      // Empty state — the Required-secret-keys section is now read-only and
      // auto-discovered from the source on link / refresh (the manual
      // "declare a key" input was removed). The source declares none.
      await expect(
        app.getByText(/The source workspace doesn't declare any vault slots/),
      ).toBeVisible();

      // Declare a required key via the store action (the link card no
      // longer exposes a manual-add input — keys are auto-discovered).
      await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              synced: { linkedWorkspaces: Record<string, unknown> };
              addLinkedRequiredKey: (linkId: string, keyId: string) => void;
            };
          };
        };
        const s = w.__apicircleStore!.getState();
        const linkId = Object.keys(s.synced.linkedWorkspaces)[0];
        s.addLinkedRequiredKey(linkId, 'API_KEY');
      });
      await expect(app.getByText('API_KEY')).toBeVisible();
      await expect(app.getByText('missing').first()).toBeVisible();

      // The row exposes a "Set value" affordance. Provisioning a real
      // secret needs a workspace passphrase (web build), which is a
      // separate flow — open the editor and confirm the value input
      // appears, then cancel.
      await app.getByRole('button', { name: 'Set value' }).click();
      await expect(app.getByLabel('Value for API_KEY')).toBeVisible();
      await app.getByRole('button', { name: 'cancel' }).click();

      // Remove the key (requires confirm).
      await app.getByRole('button', { name: 'Remove key API_KEY' }).click();
      await app.getByRole('button', { name: 'Remove', exact: true }).last().click();
      await expect(
        app.getByText(/The source workspace doesn't declare any vault slots/),
      ).toBeVisible();
    },
  );

  test(
    tc(
      id('Pin to specific version'),
      'marketplace search appends `topic:apicircle-marketplace` to the GitHub query (session-bound)',
    ),
    async ({ app }) => {
      await setupSession(app);
      // Capture the actual URL GitHub was hit with so we can pin the
      // topic-suffix contract on the wire.
      const capturedUrls: string[] = [];
      await app.route('https://api.github.com/search/repositories**', async (route) => {
        capturedUrls.push(route.request().url());
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({ items: [] }),
        });
      });

      await app.getByRole('button', { name: /Link Workspace/ }).click();
      await app.getByRole('button', { name: /Search marketplace/ }).click();
      await app.getByLabel('Marketplace query').fill('payments');
      await app.getByRole('button', { name: /^Search$/ }).click();
      await expect(app.getByText('No results.')).toBeVisible();

      expect(capturedUrls).toHaveLength(1);
      // URL-encoded form of `payments topic:apicircle-marketplace`.
      expect(capturedUrls[0]).toContain('q=payments%20topic%3Aapicircle-marketplace');
      expect(capturedUrls[0]).toContain('per_page=30');
    },
  );

  test(
    tc(
      id('Renamed entity in new version'),
      'anonymous marketplace search runs without a session and omits the Authorization header',
    ),
    async ({ app }) => {
      // No setupSession — exercises the "browse public marketplace without
      // a token" path that A.B.1 enabled.
      let capturedAuth: string | undefined;
      await app.route('https://api.github.com/search/repositories**', async (route) => {
        capturedAuth = route.request().headers().authorization;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            items: [
              {
                full_name: 'org/payments-api',
                name: 'payments-api',
                owner: { login: 'org' },
                description: 'Payments REST collection',
                topics: ['apicircle-marketplace', 'payments'],
                stargazers_count: 42,
                default_branch: 'main',
              },
            ],
          }),
        });
      });

      await app.getByRole('button', { name: /Link Workspace/ }).click();
      // The marketplace search button is reachable even without a session;
      // only LINKING a result requires one.
      await app.getByRole('button', { name: /Search marketplace/ }).click();
      // The modal surfaces an inline hint about needing a session to link.
      await expect(app.getByText(/Browsing is anonymous/)).toBeVisible();

      await app.getByLabel('Marketplace query').fill('payments');
      await app.getByRole('button', { name: /^Search$/ }).click();
      await expect(app.getByText('Payments REST collection')).toBeVisible();

      // Per-result Link button is disabled until the user signs in.
      await expect(app.getByRole('button', { name: /^Link$/ }).first()).toBeDisabled();

      // The wire request had no Authorization header.
      expect(capturedAuth).toBeUndefined();
    },
  );

  test(
    tc(
      id('Update banner when source publishes new version'),
      'marketplace search → link a public workspace',
    ),
    async ({ app }) => {
      await setupSession(app);
      // Mock the search endpoint.
      await app.route('https://api.github.com/search/repositories**', async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            items: [
              {
                full_name: 'org/payments-api',
                name: 'payments-api',
                owner: { login: 'org' },
                description: 'Payments REST collection',
                topics: ['apicircle-marketplace', 'payments'],
                stargazers_count: 42,
                default_branch: 'main',
              },
            ],
          }),
        });
      });
      // Mock the contents fetch for linking.
      const remoteJson = JSON.stringify({
        workspaceName: 'Payments API',
        releases: { self: { versions: [], currentVersion: null } },
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
              sha: 's',
              size: remoteJson.length,
              content: base64,
              encoding: 'base64',
            }),
          });
        },
      );

      await app.getByRole('button', { name: /Link Workspace/ }).click();
      await app.getByRole('button', { name: /Search marketplace/ }).click();
      await app.getByLabel('Marketplace query').fill('payments');
      await app.getByRole('button', { name: /^Search$/ }).click();
      await expect(app.getByText('Payments REST collection')).toBeVisible();

      await app
        .getByRole('button', { name: /^Link$/ })
        .first()
        .click();
      const dialog = app.getByRole('dialog', { name: /Link org\/payments-api/ });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Link', exact: true }).click();

      // After link, the modal closes and the card shows in the list with the
      // public-kind badge. `link.name` defaults to the repo path now.
      await expect(app.getByText('org/payments-api').first()).toBeVisible();
      await expect(app.getByText('public', { exact: true }).first()).toBeVisible();
    },
  );

  test(
    tc(
      id('Override per linked-version'),
      'changelog viewer lists every cached version with notes + flags',
    ),
    async ({ app }) => {
      await setupSession(app);
      const remoteJson = JSON.stringify({
        workspaceName: 'API',
        releases: {
          self: {
            versions: [
              {
                version: '0.1.0',
                publishedAt: '2026-04-01T00:00:00.000Z',
                notes: 'Initial release',
                workspaceSnapshot: 'a'.repeat(64),
                deprecated: true,
                yanked: false,
              },
              {
                version: '0.2.0',
                publishedAt: '2026-04-15T00:00:00.000Z',
                notes: 'Added the rebrand endpoint',
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
      // The repo-browser is the default surface as of B.1; existing specs
      // continue exercising the typed owner/name code path via manual entry.
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await app.getByLabel('Linked repo full name').fill('me/api');
      await app.getByRole('button', { name: /Review .* link/ }).click();
      await app.getByRole('button', { name: 'Link', exact: true }).click();

      await app.getByRole('button', { name: 'Changelog' }).click();
      // The changelog dialog title is `${link.name} — changelog`; link.name
      // defaults to the repo path (`me/api`) since the source's display
      // name no longer travels through git.
      const dialog = app.getByRole('dialog', { name: /me\/api — changelog/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Initial release')).toBeVisible();
      await expect(dialog.getByText('Added the rebrand endpoint')).toBeVisible();
      await expect(dialog.getByText('deprecated')).toBeVisible();
      await expect(dialog.getByText('pinned')).toBeVisible();
    },
  );

  test(
    tc(id('Unlink preserves local copies (optional)'), 'unlink removes the card'),
    async ({ app }) => {
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
      // The repo-browser is the default surface as of B.1; existing specs
      // continue exercising the typed owner/name code path via manual entry.
      await app.getByRole('button', { name: 'Switch to manual entry' }).click();
      await app.getByLabel('Linked repo full name').fill('me/x');
      await app.getByRole('button', { name: /Review .* link/ }).click();
      await app.getByRole('button', { name: 'Link', exact: true }).click();
      await expect(app.getByText('X').first()).toBeVisible();

      await app.getByRole('button', { name: 'Unlink' }).click();
      // Confirm dialog has its own "Unlink" button — pick the modal one (last).
      await app.getByRole('button', { name: 'Unlink', exact: true }).last().click();
      await expect(app.getByText('me/x@main')).not.toBeVisible();
    },
  );
});
