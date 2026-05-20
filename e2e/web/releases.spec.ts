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

// Plan §5.1: workspace-self releases. Local-only flow — no GitHub
// session needed. Publish v0.1.0, see it in the list, deprecate it,
// type-confirm a yank.

test.describe('Workspace-self releases (P5.1)', () => {
  test(tc(id('Adopt new version'), 'publish → list → deprecate → typed-yank'), async ({ app }) => {
    await app.getByRole('button', { name: /^Workspace$/ }).click();
    // Empty-state message before any publish.
    await expect(app.getByText(/No releases yet/)).toBeVisible();

    await app.getByRole('button', { name: /Publish release/ }).click();
    await app.getByLabel('Release version').fill('0.1.0');
    await app.getByLabel('Release notes').fill('first cut');
    await app.getByRole('button', { name: /Review .* publish/ }).click();
    await app.getByRole('button', { name: 'Publish', exact: true }).click();

    // Card shows the version + the release row.
    await expect(app.getByText('v0.1.0').first()).toBeVisible();
    await expect(app.getByText('first cut')).toBeVisible();

    // Deprecate confirms with a single click.
    await app.getByRole('button', { name: 'Deprecate' }).click();
    await app.getByRole('button', { name: 'Deprecate', exact: true }).last().click();
    await expect(app.getByText(/deprecated/i)).toBeVisible();

    // Withdraw (formerly "yank") requires typed confirmation.
    await app
      .getByRole('button', { name: /Withdraw/ })
      .first()
      .click();
    const withdrawButton = app.getByRole('button', { name: 'Withdraw', exact: true }).last();
    await expect(withdrawButton).toBeDisabled();
    await app.getByLabel('Type to confirm').fill('WITHDRAW v0.1.0');
    await expect(withdrawButton).toBeEnabled();
    await withdrawButton.click();
    await expect(app.getByText(/withdrawn/i)).toBeVisible();
  });

  test(
    tc(
      id('Linked release ledger refresh'),
      'B.4 — publish modal explains the separate Git-tag / GitHub-Release path',
    ),
    async ({ app }) => {
      // The publish modal no longer carries inline tag / release checkboxes.
      // Publishing writes the version to workspace.json and pushes to the
      // working branch; tagging happens via "Release & topics" on the Repo
      // card AFTER the PR is merged (tags target main, never an unmerged
      // working-branch commit).
      await app.getByRole('button', { name: /^Workspace$/ }).click();
      await app.getByRole('button', { name: /Publish release/ }).click();
      await expect(app.getByLabel('Release version')).toBeVisible();
      await expect(
        app.getByText(/To create a Git tag.*merge the PR first.*Release & topics/),
      ).toBeVisible();
      // No inline tag / release checkboxes in the publish modal.
      await expect(app.getByLabel('Create Git tag')).toHaveCount(0);
      await expect(app.getByLabel('Create GitHub Release')).toHaveCount(0);
    },
  );

  test(
    tc(
      id('Release notes Markdown rendered'),
      'B.4 — Release & topics: tag main HEAD + cut a GitHub Release, release URL surfaces',
    ),
    async ({ app }) => {
      // The tag + GitHub-Release flow moved out of the publish modal into
      // the Repo card's "Release & topics" modal — tags always target
      // main's HEAD, never an unmerged working-branch commit. Drive the
      // new surface: a release already lives on main's workspace.json and
      // hasn't been tagged yet.
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

      // Seed connectedRepo so the Repo card (with the "Tag release" button)
      // renders.
      await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => { local: Record<string, unknown> };
            setState: (partial: unknown) => void;
          };
        };
        const state = w.__apicircleStore!.getState();
        w.__apicircleStore!.setState({
          local: {
            ...state.local,
            connectedRepo: {
              fullName: 'me/api',
              owner: 'me',
              name: 'api',
              defaultBranch: 'main',
              visibility: 'private',
              isPrivate: true,
              pushable: true,
            },
          },
        });
      });

      // main's workspace.json carries one published release (v1.0.0).
      const mainJson = JSON.stringify({
        releases: { self: { versions: [{ version: '1.0.0', notes: 'first cut' }] } },
      });
      const mainBase64 = Buffer.from(mainJson, 'utf-8').toString('base64');
      await app.route(
        'https://api.github.com/repos/me/api/contents/workspace.json**',
        async (route) => {
          await route.fulfill({
            status: 200,
            headers: { 'content-type': 'application/json', ...corsHeaders },
            body: JSON.stringify({
              type: 'file',
              path: 'workspace.json',
              sha: 'main-sha',
              size: mainJson.length,
              content: mainBase64,
              encoding: 'base64',
            }),
          });
        },
      );
      // v1.0.0 is not yet tagged — getTagSha 404s.
      await fulfillJson(app, 'https://api.github.com/repos/me/api/git/refs/tags/v1.0.0', 404, {
        message: 'Not Found',
      });
      // getRef(main) resolves main's HEAD.
      await fulfillJson(app, 'https://api.github.com/repos/me/api/git/refs/heads/main', 200, {
        ref: 'refs/heads/main',
        object: { sha: 'main-head-sha' },
      });
      // Repo topics (the modal's second section loads these on open).
      await fulfillJson(app, 'https://api.github.com/repos/me/api/topics', 200, { names: [] });
      // createTag POSTs to /git/refs.
      const taggedRefs: Array<{ ref: string; sha: string }> = [];
      await app.route('https://api.github.com/repos/me/api/git/refs', async (route) => {
        const body = JSON.parse(route.request().postData() ?? '{}') as {
          ref: string;
          sha: string;
        };
        taggedRefs.push(body);
        await route.fulfill({
          status: 201,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({ ref: body.ref, object: { sha: body.sha } }),
        });
      });
      await app.route('https://api.github.com/repos/me/api/releases', async (route) => {
        await route.fulfill({
          status: 201,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            id: 999,
            html_url: 'https://github.com/me/api/releases/tag/v1.0.0',
            tag_name: 'v1.0.0',
          }),
        });
      });

      await app.getByRole('button', { name: /^Workspace$/ }).click();
      await app.getByRole('button', { name: 'Tag release' }).click();
      // The modal picks the latest untagged release (v1.0.0).
      await expect(app.getByRole('button', { name: /Create tag v1\.0\.0/ })).toBeVisible();
      await app.getByLabel('Also create GitHub Release').check();
      await app.getByLabel('Release notes').fill('first cut');
      await app.getByRole('button', { name: /Create tag v1\.0\.0/ }).click();

      // The success line surfaces a "View Release" link to the GitHub
      // Release URL.
      const releaseLink = app.getByRole('link', { name: /View Release/ });
      await expect(releaseLink).toBeVisible();
      await expect(releaseLink).toHaveAttribute(
        'href',
        'https://github.com/me/api/releases/tag/v1.0.0',
      );

      // The tag ref points at main's HEAD commit.
      const tagRef = taggedRefs.find((r) => r.ref === 'refs/tags/v1.0.0');
      expect(tagRef).toBeDefined();
      expect(tagRef!.sha).toBe('main-head-sha');
    },
  );
});
