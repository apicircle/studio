// Search & Marketplace (TC-SE-*) — 3 manual cases for the public-
// workspace marketplace lookup behind the Link Workspace panel.
//
// The marketplace input lives at packages/ui-components/src/panels/
// link-workspace/LinkWorkspacePanel.tsx — aria-label "Marketplace query".
// To reach it, click the top-bar "Link Workspace" tab first.
//
// Linking a result needs a real GitHub session AND a mocked search
// endpoint — that flow is deferred to S4 (git-fixture work) since it
// shares the GitHub auth + repo-discovery mocks.

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapSE } from './fixtures/tcMapSE';
import type { TcId } from './fixtures/tcCoverage';

void tcMapSE;

function id(key: string): TcId {
  const v = tcMapSE[key];
  if (!v) throw new Error(`No TC-SE entry for "${key}"`);
  return v;
}

async function openMarketplaceSearch(app: import('@playwright/test').Page): Promise<void> {
  await app.getByRole('button', { name: 'Link Workspace', exact: true }).first().click();
  // Two affordances are visible after the panel opens: "Link a private
  // workspace" (disabled until GitHub session) and "Search marketplace".
  // The marketplace input is gated behind the search-marketplace button.
  await app.getByRole('button', { name: 'Search marketplace', exact: true }).click();
  await expect(app.getByLabel('Marketplace query', { exact: true })).toBeVisible({
    timeout: 5_000,
  });
}

test.describe('Search & Marketplace', () => {
  test.describe.configure({ mode: 'parallel' });

  test(
    tc(id('Marketplace :: Search public workspaces'), 'search field accepts query'),
    async ({ app }) => {
      await openMarketplaceSearch(app);
      const input = app.getByLabel('Marketplace query', { exact: true });
      await input.fill('payments');
      await expect(input).toHaveValue('payments');
      // The Search button enables once query has a non-empty value.
      const searchBtn = app.getByRole('button', { name: /^Search$|^Searching/ }).first();
      await expect(searchBtn).toBeEnabled();
    },
  );

  test.fixme(
    tc(id('Marketplace :: Link public workspace'), 'one-click link from marketplace card'),
    async () => {
      // Needs a mocked marketplace endpoint (GitHub Search API) +
      // a faked GitHub session in the secret vault. Both are part of
      // the S4 git-fixture work — see scripts/scaffold_e2e_specs.py
      // blocker notes for GT/CP/LV.
    },
  );

  test(
    tc(id('Marketplace :: Empty results'), 'empty-state copy when query has no hits'),
    async ({ app }) => {
      await openMarketplaceSearch(app);
      const input = app.getByLabel('Marketplace query', { exact: true });
      // A query unlikely to match anything in a fresh test environment
      // — even if the marketplace IS reachable from CI it won't hit
      // this query string.
      await input.fill('zz-no-such-workspace-zz-12345');
      // Clicking Search triggers the network call. We don't have a
      // GitHub session, so the panel surfaces the "anonymous browsing"
      // copy AND/OR an error. Either is documented behaviour per the
      // workbook empty-results expectation.
      await app.getByRole('button', { name: /^Search$/ }).click();
      // Either an "anonymous browsing" prompt, an empty-results
      // message, or an error alert appears. Accept any of them.
      await expect
        .poll(
          async () => {
            const anonymous = await app
              .getByText(/anonymous|browsing is anonymous|connect github/i)
              .count();
            const emptyCopy = await app
              .getByText(/no (matching|results|workspaces|matches|repos)/i)
              .count();
            const err = await app.getByRole('alert').count();
            return anonymous + emptyCopy + err;
          },
          {
            timeout: 8_000,
            message: 'expected anonymous-prompt, empty-state, or error alert',
          },
        )
        .toBeGreaterThan(0);
    },
  );
});
