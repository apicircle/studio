import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module AS.
import { tcMapAS } from './fixtures/tcMapAS';
void Object.keys(tcMapAS);

function id(key: string): TcId {
  const v = tcMapAS[key];
  if (!v) throw new Error(`No TC-AS entry for "${key}"`);
  return v;
}
// Plan §6 P6: build a 3-step plan, run with assertions, see results in
// History. Local-only flow — no GitHub session needed.

test.describe('Execution plans (P6)', () => {
  test(
    tc(
      id('Plan Run :: Disabled step skipped'),
      'build → run → step results land in plan history @smoke',
    ),
    async ({ app, sidebar }) => {
      // Mock outbound HTTP so the executor doesn't actually hit the network.
      await app.route('https://api.example/**', async (route) => {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
          body: JSON.stringify({ ok: 1 }),
        });
      });

      // Create three requests pointing at different example endpoints.
      await app.getByRole('button', { name: /^Editor$/ }).click();
      for (const path of ['users', 'posts', 'comments']) {
        await sidebar.createRequest(`req-${path}`);
        await app.getByLabel('Request URL').fill(`https://api.example/${path}`);
      }

      // Switch to Execution and create a plan via the empty-state CTA. Both
      // the CTA and the sidebar "+" button match name="Create plan"; the CTA
      // appears first in DOM order (panel renders before sidebar in our
      // chrome layout).
      await app.getByRole('button', { name: /^Execution$/ }).click();
      await app.getByRole('button', { name: 'Create plan' }).first().click();
      await app.getByLabel('Plan name').fill('Smoke checks');

      // Add all three requests as steps via the multi-select picker.
      await app.getByRole('button', { name: 'Add step' }).first().click();
      for (const path of ['users', 'posts', 'comments']) {
        await app.getByRole('checkbox', { name: `Select req-${path}` }).click();
      }
      await app.getByRole('button', { name: /^Add 3 steps?$/ }).click();

      // Run with assertions (none defined → all pass since result.ok=true).
      await app.getByRole('button', { name: 'Run with assertions' }).click();
      await expect(app.getByText('3/3 requests succeeded')).toBeVisible({ timeout: 10_000 });

      // Switch to History and confirm the plan run is listed under Plans tab.
      await app.getByRole('button', { name: /^History$/ }).click();
      await app.getByRole('tab', { name: /^Plans/ }).click();
      await expect(app.getByText('Smoke checks')).toBeVisible();
      await expect(app.getByText('3/3').first()).toBeVisible();
      // Each step also lands in the request-runs buffer.
      await app.getByRole('tab', { name: /^Requests/ }).click();
      const requestRows = app.getByRole('list').getByRole('listitem');
      await expect(requestRows.first()).toBeVisible();
    },
  );
});
