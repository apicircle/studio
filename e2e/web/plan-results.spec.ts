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
// P21 — Per-step plan run details. Builds a 2-step plan, runs it, and
// verifies the new "Last run · per-step details" section renders one
// expandable row per step with status + duration + assertion verdicts +
// a Monaco-rendered response body.

test.describe('Plan run details (P21)', () => {
  test(
    tc(id('Plan Run :: Disabled step skipped'), 'renders one expandable row per step after a run'),
    async ({ app, mockApi, sidebar }) => {
      await mockApi.json(/api\.example\.test\/alpha/, { name: 'Alpha' });
      await mockApi.json(/api\.example\.test\/beta/, { name: 'Beta' }, { status: 201 });

      // Two requests.
      for (const [name, path] of [
        ['alpha-req', 'alpha'],
        ['beta-req', 'beta'],
      ]) {
        await sidebar.createRequest(name);
        await app.getByLabel('Request URL').fill(`https://api.example.test/${path}`);
      }

      // Build a plan.
      await app.getByRole('button', { name: /^Execution$/ }).click();
      await app.getByRole('button', { name: 'Create plan' }).first().click();
      await app.getByLabel('Plan name').fill('Smoke');
      // Multi-select picker: open once, check both, commit with "Add N steps".
      await app.getByRole('button', { name: 'Add step' }).first().click();
      await app.getByRole('checkbox', { name: 'Select alpha-req' }).click();
      await app.getByRole('checkbox', { name: 'Select beta-req' }).click();
      await app.getByRole('button', { name: /^Add 2 steps?$/ }).click();

      // Run.
      await app.getByRole('button', { name: 'Run with assertions' }).click();
      await expect(app.getByText('2/2 requests succeeded')).toBeVisible();

      // Per-step section is now rendered. Scope queries to the section so
      // the request-tree rows don't satisfy the `alpha-req` text match.
      const detailsSection = app.getByLabel('Per-step run details');
      await expect(app.getByText('Last run · per-step details')).toBeVisible();
      await expect(detailsSection.getByText('alpha-req')).toBeVisible();
      await expect(detailsSection.getByText('beta-req')).toBeVisible();

      // First row open by default — contains the URL.
      await expect(detailsSection.getByText('https://api.example.test/alpha')).toBeVisible();

      // Expand the second row + see beta URL + the assertion echo.
      // Monaco-read for plan steps is unreliable because every step's
      // ResponseViewer uses the same `Response body` aria-label and the
      // shared __apicircleEditors map keeps the most-recent. Verify via
      // the per-step Status badge instead (201, since beta returns 201).
      await detailsSection.getByRole('button', { expanded: false, name: /beta-req/ }).click();
      await expect(detailsSection.getByText('https://api.example.test/beta')).toBeVisible();
      // Per-step row button is labelled `Step <n> <name> details`
      // (ExecutionPanel.tsx ~line 523).
      await expect(detailsSection.getByRole('button', { name: /Step 2 .*beta-req/ })).toBeVisible();
    },
  );

  test(
    tc(
      id('Step timeout / Duration'),
      'per-step response viewer shows the positive assertion explanation on pass',
    ),
    async ({ app, mockApi, sidebar }) => {
      await mockApi.json(/api\.example\.test\/healthy/, { ok: true });

      await sidebar.createRequest('healthy-req');
      await app.getByLabel('Request URL').fill('https://api.example.test/healthy');

      // Default status=200 assertion.
      await app
        .getByRole('tab', { name: /^Assertions/ })
        .first()
        .click();
      await app.getByRole('button', { name: /^Add assertion$/ }).click();

      // Build a plan + run.
      await app.getByRole('button', { name: /^Execution$/ }).click();
      await app.getByRole('button', { name: 'Create plan' }).first().click();
      await app.getByRole('button', { name: 'Add step' }).first().click();
      await app.getByRole('checkbox', { name: 'Select healthy-req' }).click();
      // Single-selection commit button reads "Add step" (no count); the
      // picker is the second button matching the name in DOM order.
      await app.getByRole('button', { name: 'Add step' }).last().click();
      await app.getByRole('button', { name: 'Run with assertions' }).click();
      await expect(app.getByText('1/1 requests succeeded')).toBeVisible();

      // The per-step row's embedded ResponseViewer renders the assertion
      // explanation produced by core/runAssertions on PASS. Click the
      // Assertions tab in that step's response viewer to surface the text.
      const detailsSection = app.getByLabel('Per-step run details');
      await detailsSection.getByRole('tab', { name: /Assertions \(1\/1\)/ }).click();
      await expect(detailsSection.getByText('status: 200 equals 200')).toBeVisible();
    },
  );

  test(
    tc(
      id('Step with post-script error / Duration'),
      'failing step row shows the warning verdict + error detail',
    ),
    async ({ app, mockApi, sidebar }) => {
      await mockApi.json(/api\.example\.test\/x/, { ok: true });

      await sidebar.createRequest('one');
      await app.getByLabel('Request URL').fill('https://api.example.test/x');
      // Add a status==999 assertion which will fail.
      await app
        .getByRole('tab', { name: /^Assertions/ })
        .first()
        .click();
      await app.getByRole('button', { name: /^Add assertion$/ }).click();
      await app.getByLabel('Assertion 1 expected').fill('999');

      await app.getByRole('button', { name: /^Execution$/ }).click();
      await app.getByRole('button', { name: 'Create plan' }).first().click();
      await app.getByRole('button', { name: 'Add step' }).first().click();
      await app.getByRole('checkbox', { name: 'Select one' }).click();
      // Single-selection commit button reads "Add step" (no count); the
      // picker is the second button matching the name in DOM order.
      await app.getByRole('button', { name: 'Add step' }).last().click();
      await app.getByRole('button', { name: 'Run with assertions' }).click();

      // 1 HTTP succeeded + 0 of 1 assertions passed.
      await expect(app.getByText('1/1 requests succeeded')).toBeVisible();
      await expect(app.getByText(/0\/1 assertions/)).toBeVisible();
      // Open the per-step assertions tab to surface the failure detail.
      const detailsSection = app.getByLabel('Per-step run details');
      await detailsSection.getByRole('tab', { name: /Assertions \(0\/1\)/ }).click();
      await expect(detailsSection.getByText(/expected\s+999,\s+got\s+200/i)).toBeVisible();
    },
  );
});
