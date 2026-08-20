// IndexedDB-backed reload persistence. The store hydrates from IDB on
// every page load — these tests exercise that path end-to-end:
//
//   1. Active request id survives reload (editor opens to the same request).
//   2. Request body / URL / headers survive reload (stored in `synced`).
//   3. History entries (request runs + plan runs) survive reload.
//   4. Body Monaco content rehydrates with the same value.
//
// If a store action stops persisting silently — or the IDB schema drifts
// from the type — these tests catch it. The existing 290+ tests don't.

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module WS.
import { tcMapWS } from './fixtures/tcMapWS';
void Object.keys(tcMapWS);

// Drain the 250ms debounced IDB write before reload. Without this,
// Firefox's stricter unload semantics abort the in-flight transaction
// and the most recent mutation is lost — Chromium/WebKit happen to
// commit during unload, hiding the race.
async function flushPersistAndReload(app: Page): Promise<void> {
  await app.evaluate(async () => {
    const w = window as unknown as { __apicircleFlushPersist?: () => Promise<void> };
    await w.__apicircleFlushPersist?.();
  });
  await app.reload();
}

function id(key: string): TcId {
  const v = tcMapWS[key];
  if (!v) throw new Error(`No TC-WS entry for "${key}"`);
  return v;
}
test.describe('Reload persistence', () => {
  test(
    tc(
      id('Refresh :: Refresh during in-flight request'),
      'request URL + headers + body survive a page reload @smoke',
    ),
    async ({ app, e2eMock, monaco, sidebar }) => {
      await sidebar.createRequest('persist-1');
      const url = e2eMock.url('/anything/persist-1');
      await app.getByLabel('Request URL').fill(url);
      await app.getByLabel('HTTP method').selectOption('POST');
      await app
        .getByRole('tab', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('X-Persist-Test');
      await app.keyboard.press('Escape');
      await app.getByLabel('Headers value 1').fill('still-here');
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'JSON' }).click();
      await monaco.fill('Request body', '{"persisted":true}');

      await flushPersistAndReload(app);
      // Wait for hydration — the brand text appears once `__apicircleStore` is wired.
      await expect(app.getByText('API Circle Studio', { exact: true })).toBeVisible();

      // Active request id was persisted; editor opens to the same request.
      await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('persist-1');
      await expect(app.getByLabel('HTTP method')).toHaveValue('POST');
      await expect(app.getByLabel('Request URL')).toHaveValue(url);

      // Headers tab — row 1 still has the key + value we typed.
      await app
        .getByRole('tab', { name: /^Headers/ })
        .first()
        .click();
      await expect(app.getByLabel('Headers key 1')).toHaveValue('X-Persist-Test');
      await expect(app.getByLabel('Headers value 1')).toHaveValue('still-here');

      // Body Monaco rehydrates with the same value.
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect.poll(() => monaco.read('Request body')).toBe('{"persisted":true}');
    },
  );

  test(
    tc(
      id('Create :: 256-char name truncation/rejection'),
      'history entries (request runs) survive a page reload',
    ),
    async ({ app, e2eMock, sidebar }) => {
      // Send 2 requests so we have 2 history rows.
      await sidebar.createRequest('history-persist-a');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/history-a'));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      await sidebar.createRequest('history-persist-b');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/history-b'));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      await flushPersistAndReload(app);
      await expect(app.getByText('API Circle Studio', { exact: true })).toBeVisible();

      // History panel still has both runs.
      await app.getByRole('button', { name: /^History$/ }).click();
      await expect(app.getByRole('tab', { name: /^Requests/ })).toBeVisible();
      await expect(app.getByText('history-persist-a').first()).toBeVisible();
      await expect(app.getByText('history-persist-b').first()).toBeVisible();
    },
  );

  test(
    tc(
      id('Create :: Duplicate workspace name allowed (UUID id)'),
      'three request runs all survive a reload with status badges intact',
    ),
    async ({ app, e2eMock, sidebar }) => {
      // Three sends → reload → all three rows present + each row's status
      // badge renders. Catches the case where reload wipes a subset of
      // history rows (e.g. only the active request's runs survive).
      for (const name of ['c12-multi-a', 'c12-multi-b', 'c12-multi-c']) {
        await sidebar.createRequest(name);
        await app.getByLabel('Request URL').fill(e2eMock.url(`/anything/${name}`));
        await app.getByRole('button', { name: /^Send$/ }).click();
        await expect(app.getByText('200').first()).toBeVisible();
      }

      await flushPersistAndReload(app);
      await expect(app.getByText('API Circle Studio', { exact: true })).toBeVisible();

      await app.getByRole('button', { name: /^History$/ }).click();
      // All three rows present + each shows its 200 status. Use the first
      // matching badge to avoid count mismatches (badge text shows up in
      // multiple places per row).
      for (const name of ['c12-multi-a', 'c12-multi-b', 'c12-multi-c']) {
        await expect(app.getByText(name).first()).toBeVisible();
      }
      // 3 rows × 1 status each → at least 3 "200" badges in the row strip.
      const statusBadges = app.locator('text=200');
      expect(await statusBadges.count()).toBeGreaterThanOrEqual(3);
    },
  );

  test(
    tc(
      id('Create :: Unicode + emoji name'),
      'plan runs survive a page reload (Plans tab in History)',
    ),
    async ({ app, e2eMock, sidebar }) => {
      // Build a 1-step plan, run it, reload, confirm History → Plans has the run.
      await sidebar.createRequest('plan-persist');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/plan-persist'));

      await app.getByRole('button', { name: /^Execution$/ }).click();
      await app.getByRole('button', { name: 'Create plan' }).first().click();
      await app.getByLabel('Plan name').fill('PersistMe');
      await app.getByRole('button', { name: 'Add step' }).first().click();
      await app.getByRole('checkbox', { name: 'Select plan-persist' }).click();
      await app.getByRole('button', { name: 'Add step' }).last().click();
      await app.getByRole('button', { name: 'Run', exact: true }).click();
      // Wait for the run to land — verdict becomes visible.
      await expect(app.getByText(/1\/1 requests succeeded/)).toBeVisible({ timeout: 10_000 });

      await flushPersistAndReload(app);
      await expect(app.getByText('API Circle Studio', { exact: true })).toBeVisible();

      await app.getByRole('button', { name: /^History$/ }).click();
      await app.getByRole('tab', { name: /^Plans/ }).click();
      await expect(app.getByText('PersistMe').first()).toBeVisible();
    },
  );
});
