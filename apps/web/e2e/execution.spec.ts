import { expect, test } from './fixtures/app';

// Plan §6 P6: build a 3-step plan, run with assertions, see results in
// History. Local-only flow — no GitHub session needed.

test.describe('Execution plans (P6)', () => {
  test('build → run → step results land in plan history', async ({ app }) => {
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
      // The toolbar "New request" button is aria-labelled — there are also
      // tree rows with the same text content, so use the label.
      await app.getByLabel('New request', { exact: true }).first().click();
      await app.getByLabel('Request URL').fill(`https://api.example/${path}`);
    }

    // Switch to Execution and create a plan via the empty-state CTA. Both
    // the CTA and the sidebar "+" button match name="Create plan"; the CTA
    // appears first in DOM order (panel renders before sidebar in our
    // chrome layout).
    await app.getByRole('button', { name: /^Execution$/ }).click();
    await app.getByRole('button', { name: 'Create plan' }).first().click();
    await app.getByLabel('Plan name').fill('Smoke checks');

    // Add all three requests as steps.
    for (let i = 0; i < 3; i++) {
      await app.getByRole('button', { name: 'Add step' }).click();
      // Picker shows the requests by name (auto-named "New request" by the
      // editor). The most-recent one ends up first; we click whichever is at
      // the top each time, which produces the order we created them in.
      await app
        .getByRole('button', { name: /^GET\s+New request/ })
        .first()
        .click();
    }

    // Run with assertions (none defined → all pass since result.ok=true).
    await app.getByRole('button', { name: 'Run with assertions' }).click();
    await expect(app.getByText('3/3 passed')).toBeVisible({ timeout: 10_000 });

    // Switch to History and confirm the plan run is listed under Plans tab.
    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByRole('button', { name: /^Plans/ }).click();
    await expect(app.getByText('Smoke checks')).toBeVisible();
    await expect(app.getByText('3/3').first()).toBeVisible();
    // Each step also lands in the request-runs buffer.
    await app.getByRole('button', { name: /^Requests/ }).click();
    const requestRows = app.getByRole('list').getByRole('listitem');
    await expect(requestRows.first()).toBeVisible();
  });
});
