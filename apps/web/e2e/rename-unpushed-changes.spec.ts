import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

// Regression: renaming a Mock server or an Execution plan must surface in
// the unpushed-changes strip on the workspace panel. Before the diff engine
// learned about the `mockServer` and `executionPlan` buckets, both renames
// were data-correct (the new name lived in `synced` and would round-trip
// through workspace.json) but invisible to `summarizeUnpushedChanges` — the
// strip stayed on "No unpushed changes" and the diff modal claimed nothing
// to push.
//
// This spec walks the full path the user did: connect a session + repo +
// branch, push so we have a `lastPulledSnapshot` baseline, rename a mock
// and a plan via the live UI, then assert the strip and the modal both
// report the changes.

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
  await app.route('https://api.github.com/repos/me/api/git/refs', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        headers: { 'content-type': 'application/json', ...corsHeaders },
        body: JSON.stringify({
          ref: 'refs/heads/apicircle/wb-rename',
          object: { sha: 'sha-main' },
        }),
      });
      return;
    }
    await route.fallback();
  });

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
  await branchInput.fill('apicircle/wb-rename');
  await app.getByRole('button', { name: /Create working branch/ }).click();
  await expect(app.getByText('Branch ready')).toBeVisible();
}

async function wirePushFlow(app: Page): Promise<void> {
  await fulfillJson(
    app,
    'https://api.github.com/repos/me/api/git/refs/heads/apicircle%2Fwb-rename',
    200,
    { ref: 'refs/heads/apicircle/wb-rename', object: { sha: 'sha-main' } },
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
  await app.route(
    'https://api.github.com/repos/me/api/git/refs/heads/apicircle%2Fwb-rename',
    async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders },
          body: JSON.stringify({
            ref: 'refs/heads/apicircle/wb-rename',
            object: { sha: 'commit-new' },
          }),
        });
        return;
      }
      await route.fallback();
    },
  );
}

// Seed one mock server and one execution plan via the store bridge, then
// push so the freshly-seeded names become the `lastPulledSnapshot` baseline.
// Subsequent renames in the test will diff against this baseline and produce
// the "modified" entries the regression is about.
async function seedAndPushBaseline(app: Page): Promise<{ mockId: string; planId: string }> {
  const ids = await app.evaluate(() => {
    const w = window as unknown as {
      __apicircleStore: {
        getState: () => {
          synced: {
            mockServers: Record<string, unknown>;
          };
          addPlan: (name: string) => string;
          setState?: (next: unknown) => void;
        };
        setState: (partial: unknown) => void;
      };
    };
    const store = w.__apicircleStore;
    const synced = store.getState().synced;
    const mockId = 'm-rename-e2e';
    store.setState({
      synced: {
        ...synced,
        mockServers: {
          ...synced.mockServers,
          [mockId]: {
            id: mockId,
            name: 'Original Mock',
            source: { kind: 'manual', endpoints: [] },
            endpoints: [],
            defaultPort: null,
            cors: { enabled: false, origins: [] },
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-13T00:00:00.000Z',
          },
        },
      },
    });
    const planId = store.getState().addPlan('Original Plan');
    return { mockId, planId };
  });

  await app.getByRole('button', { name: /Push to save/ }).click();
  await expect(app.getByText(/up to date/)).toBeVisible();
  // Strip should now read "No unpushed changes" — baseline established.
  await expect(
    app.getByText(/No unpushed changes — workspace matches the last pull\./),
  ).toBeVisible();

  return ids;
}

test.describe('Rename surfaces in unpushed-changes UI (regression)', () => {
  test('renaming a mock server appears as a modified entry in the strip and modal', async ({
    app,
  }) => {
    await setupConnectedBranch(app);
    await wirePushFlow(app);
    const { mockId } = await seedAndPushBaseline(app);

    // Rename the mock server via the public store action — the same path
    // the Mocks-panel UI uses internally.
    await app.evaluate((id) => {
      const w = window as unknown as {
        __apicircleStore: {
          getState: () => { setMockServerName: (id: string, name: string) => void };
        };
      };
      w.__apicircleStore.getState().setMockServerName(id, 'Renamed Mock');
    }, mockId);

    // Strip flips from "No unpushed changes" to the "+0 ~1 -0 unpushed change" button.
    await expect(
      app.getByText(/No unpushed changes — workspace matches the last pull\./),
    ).toBeHidden();
    const strip = app.getByRole('button', { name: /Show unpushed changes preview/ });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(/~1/);

    // Open the modal — the renamed mock surfaces as a `mockServer` row.
    await strip.click();
    const modal = app.getByRole('dialog', { name: /Unpushed changes preview/ });
    await expect(modal).toBeVisible();
    const list = modal.getByRole('list', { name: 'Unpushed changes' });
    await expect(list).toContainText('mockServer');
    await expect(list).toContainText('Renamed Mock');
  });

  test('renaming an execution plan appears as a modified entry', async ({ app }) => {
    await setupConnectedBranch(app);
    await wirePushFlow(app);
    const { planId } = await seedAndPushBaseline(app);

    await app.evaluate((id) => {
      const w = window as unknown as {
        __apicircleStore: {
          getState: () => { renamePlan: (id: string, name: string) => void };
        };
      };
      w.__apicircleStore.getState().renamePlan(id, 'Renamed Plan');
    }, planId);

    const strip = app.getByRole('button', { name: /Show unpushed changes preview/ });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(/~1/);

    await strip.click();
    const modal = app.getByRole('dialog', { name: /Unpushed changes preview/ });
    await expect(modal).toBeVisible();
    const list = modal.getByRole('list', { name: 'Unpushed changes' });
    await expect(list).toContainText('executionPlan');
    await expect(list).toContainText('Renamed Plan');
  });

  test('renaming both at once reports two modified entries with stable bucket order', async ({
    app,
  }) => {
    await setupConnectedBranch(app);
    await wirePushFlow(app);
    const { mockId, planId } = await seedAndPushBaseline(app);

    await app.evaluate(
      ({ mockId, planId }) => {
        const w = window as unknown as {
          __apicircleStore: {
            getState: () => {
              setMockServerName: (id: string, name: string) => void;
              renamePlan: (id: string, name: string) => void;
            };
          };
        };
        w.__apicircleStore.getState().setMockServerName(mockId, 'Mock v2');
        w.__apicircleStore.getState().renamePlan(planId, 'Plan v2');
      },
      { mockId, planId },
    );

    const strip = app.getByRole('button', { name: /Show unpushed changes preview/ });
    // Strip shows ~2 modified.
    await expect(strip).toContainText(/~2/);

    await strip.click();
    const modal = app.getByRole('dialog', { name: /Unpushed changes preview/ });
    const list = modal.getByRole('list', { name: 'Unpushed changes' });

    // BUCKET_ORDER puts mockServer before executionPlan; assert both rows
    // are present and in that order.
    const rowText = await list.innerText();
    const mockIdx = rowText.indexOf('mockServer');
    const planIdx = rowText.indexOf('executionPlan');
    expect(mockIdx, 'mockServer row must appear').toBeGreaterThanOrEqual(0);
    expect(planIdx, 'executionPlan row must appear').toBeGreaterThanOrEqual(0);
    expect(mockIdx).toBeLessThan(planIdx);
  });
});
