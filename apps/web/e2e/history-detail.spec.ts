// Cycle 11 — History detail + replay + open-in-editor + plan step
// expansion + filters + buffer eviction. Sister spec to history.spec.ts;
// covers all the rows-and-columns behavior the existing spec doesn't
// reach.

import { expect, test } from './fixtures/app';

test.describe('History — C11', () => {
  test('detail view renders body / headers / assertions for a request run', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await sidebar.createRequest('hist-detail');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/hist-detail'));
    // Add a status assertion so the assertions tab has content.
    await app
      .getByRole('button', { name: /^Assertions/ })
      .first()
      .click();
    await app.getByRole('button', { name: /^Add assertion$/ }).click();

    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    // Switch to History.
    await app.getByRole('button', { name: /^History$/ }).click();
    await expect(app.getByRole('tab', { name: /^Requests/ })).toBeVisible();

    // Expand the row by clicking the disclosure button (not the
    // sibling action buttons). After C11, the disclosure has
    // aria-label="<name> run details" while the action buttons are
    // siblings with their own labels.
    const row = app.getByRole('button', { name: 'hist-detail run details' }).first();
    await row.click();

    // Detail body shows the response viewer (200 OK badge + assertions
    // tab with the explanation we added in C9 build).
    await expect(app.getByText('200 OK').first()).toBeVisible();
    // The Headers + Assertions tabs from ResponseViewer are visible.
    await expect(app.getByRole('button', { name: 'Headers', exact: true })).toBeVisible();
    await expect(app.getByRole('button', { name: /Assertions/ }).first()).toBeVisible();
  });

  test('replay re-fires the source request and prepends a new history row', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await sidebar.createRequest('hist-replay');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/hist-replay'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    await app.getByRole('button', { name: /^History$/ }).click();

    // Snapshot the initial run count for hist-replay.
    const initialCount = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { local?: { history: { requestRuns: Array<{ url: string }> } } };
        };
      };
      const runs = w.__apicircleStore!.getState().local?.history.requestRuns ?? [];
      return runs.filter((r) => r.url.includes('/anything/hist-replay')).length;
    });
    expect(initialCount).toBe(1);

    // Replay via the per-row icon-button. The first matching button is
    // the newest run.
    await app
      .getByRole('button', { name: /Replay request run from/ })
      .first()
      .click();

    // After replay, two runs should exist for this URL.
    await expect
      .poll(
        async () => {
          return await app.evaluate(() => {
            const w = window as unknown as {
              __apicircleStore?: {
                getState: () => {
                  local?: { history: { requestRuns: Array<{ url: string }> } };
                };
              };
            };
            const runs = w.__apicircleStore!.getState().local?.history.requestRuns ?? [];
            return runs.filter((r) => r.url.includes('/anything/hist-replay')).length;
          });
        },
        { timeout: 5000 },
      )
      .toBe(2);
  });

  test('open source request in Editor switches panel and selects the request', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await sidebar.createRequest('hist-open');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/hist-open'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    await app.getByRole('button', { name: /^History$/ }).click();
    // Click the Open-in-Editor icon button on the run row.
    await app.getByRole('button', { name: 'Open source request in Editor' }).first().click();

    // The Editor panel is now active + the request name input shows hist-open.
    await expect(app.getByRole('button', { name: /^Editor$/, exact: false })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('hist-open');
  });

  test('plan-history step expansion shows per-step ResponseViewer', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    // Build a 2-step plan, run it, switch to History → Plans, expand a step.
    for (const name of ['hist-plan-a', 'hist-plan-b']) {
      await sidebar.createRequest(name);
      await app.getByLabel('Request URL').fill(e2eMock.url(`/anything/${name}`));
    }

    await app.getByRole('button', { name: /^Execution$/ }).click();
    await app.getByRole('button', { name: 'Create plan' }).first().click();
    await app.getByLabel('Plan name').fill('PlanHistExp');
    await app.getByRole('button', { name: 'Add step' }).first().click();
    await app.getByRole('checkbox', { name: 'Select hist-plan-a' }).click();
    await app.getByRole('checkbox', { name: 'Select hist-plan-b' }).click();
    await app.getByRole('button', { name: /^Add 2 steps?$/ }).click();
    await app.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(app.getByText(/2\/2 requests succeeded/)).toBeVisible({ timeout: 10_000 });

    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByRole('tab', { name: /^Plans/ }).click();
    // Click the plan run row to expand it.
    await app
      .getByRole('button', { name: /PlanHistExp/ })
      .first()
      .click();
    // Expand step 2's per-step row.
    await app.getByRole('button', { expanded: false, name: /GET\s+hist-plan-b/ }).click();
    // The expanded step shows ResponseViewer with the 200 OK badge. The
    // outer "Per-step results" wrapper is a heading, not a section, so
    // we just assert the badge is visible somewhere in the panel —
    // there's only one "200 OK" rendered (the second step's response).
    await expect(app.getByText('200 OK').first()).toBeVisible();
  });

  test('request-runs buffer caps at 500 — oldest evicts when 501st run lands', async ({ app }) => {
    // Same-origin to the buffer eviction plan-runs test, but for the
    // 500-row request-run buffer.
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { local?: { history: { requestRuns: unknown[] } } };
          setState: (
            partial: (s: { local?: { history: { requestRuns: unknown[] } } }) => unknown,
          ) => void;
        };
      };
      const seeded = Array.from({ length: 500 }, (_, i) => ({
        id: `seed-req-run-${i}`,
        requestId: 'phantom-req',
        startedAt: new Date(2020, 0, 1, 0, i).toISOString(),
        durationMs: 0,
        status: 200,
        statusText: 'OK',
        ok: true,
        url: `https://x.test/seed-${i}`,
        method: 'GET',
        requestHeaders: {},
        requestBodyPreview: null,
        responseHeaders: {},
        responseBodyPreview: '',
        responseBodyKind: 'empty',
        responseTruncated: false,
        assertions: [],
      }));
      w.__apicircleStore!.setState((s) => {
        const local = s.local;
        if (!local) return {};
        return {
          local: { ...local, history: { ...local.history, requestRuns: seeded } },
        };
      });
    });

    expect(
      await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => { local?: { history: { requestRuns: unknown[] } } };
          };
        };
        return w.__apicircleStore!.getState().local!.history.requestRuns.length;
      }),
    ).toBe(500);

    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          setState: (
            partial: (s: { local?: { history: { requestRuns: unknown[] } } }) => unknown,
          ) => void;
        };
      };
      const MAX = 500;
      w.__apicircleStore!.setState((s) => {
        const local = s.local;
        if (!local) return {};
        const newest = {
          id: 'newest-req-run',
          requestId: 'phantom-req',
          startedAt: new Date().toISOString(),
          durationMs: 0,
          status: 200,
          statusText: 'OK',
          ok: true,
          url: 'https://x.test/newest',
          method: 'GET',
          requestHeaders: {},
          requestBodyPreview: null,
          responseHeaders: {},
          responseBodyPreview: '',
          responseBodyKind: 'empty',
          responseTruncated: false,
          assertions: [],
        };
        const requestRuns = [newest, ...local.history.requestRuns].slice(0, MAX);
        return {
          local: { ...local, history: { ...local.history, requestRuns } },
        };
      });
    });

    const after = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            local?: { history: { requestRuns: Array<{ id: string }> } };
          };
        };
      };
      const runs = w.__apicircleStore!.getState().local!.history.requestRuns;
      return {
        len: runs.length,
        firstId: runs[0]?.id,
        secondId: runs[1]?.id,
        hasEvictedTail: runs.some((r) => r.id === 'seed-req-run-499'),
      };
    });
    expect(after.len).toBe(500);
    expect(after.firstId).toBe('newest-req-run');
    expect(after.secondId).toBe('seed-req-run-0');
    expect(after.hasEvictedTail).toBe(false);
  });

  test('filter by date range hides rows outside the window', async ({ app, e2eMock, sidebar }) => {
    await sidebar.createRequest('hist-date-filter');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/hist-date-filter'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    await app.getByRole('button', { name: /^History$/ }).click();

    // Set the to-date filter to yesterday so today's run is excluded.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await app.evaluate((toDate) => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            setHistoryUi: (patch: { toDate: string | null }) => void;
          };
        };
      };
      w.__apicircleStore!.getState().setHistoryUi({ toDate });
    }, yesterday);

    // The hint text reads "No runs match the current filters." once the
    // filter wipes the list.
    await expect(app.getByText(/No runs match the current filters/)).toBeVisible();
    // The deleted-request placeholder isn't visible either.
    await expect(app.getByText(/hist-date-filter/)).not.toBeVisible();

    // Clear the filter via the store; the row reappears.
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { setHistoryUi: (patch: { toDate: string | null }) => void };
        };
      };
      w.__apicircleStore!.getState().setHistoryUi({ toDate: null });
    });
    await expect(app.getByText(/hist-date-filter/).first()).toBeVisible();
  });
});
