import { expect, test } from './fixtures/app';

// P21 — Per-step plan run details. Builds a 2-step plan, runs it, and
// verifies the new "Last run · per-step details" section renders one
// expandable row per step with status + duration + assertion verdicts +
// a Monaco-rendered response body.

test.describe('Plan run details (P21)', () => {
  test('renders one expandable row per step after a run', async ({ app, mockApi, monaco }) => {
    await mockApi.json(/api\.example\.test\/alpha/, { name: 'Alpha' });
    await mockApi.json(/api\.example\.test\/beta/, { name: 'Beta' }, { status: 201 });

    // Two requests.
    for (const [name, path] of [
      ['alpha-req', 'alpha'],
      ['beta-req', 'beta'],
    ]) {
      await app.getByLabel('New request').click();
      await app.getByLabel('Request name').fill(name);
      await app.getByLabel('Request URL').fill(`https://api.example.test/${path}`);
    }

    // Build a plan.
    await app.getByRole('button', { name: /^Execution$/ }).click();
    await app.getByRole('button', { name: 'Create plan' }).first().click();
    await app.getByLabel('Plan name').fill('Smoke');
    for (const name of ['alpha-req', 'beta-req']) {
      await app.getByRole('button', { name: 'Add step' }).click();
      await app
        .getByRole('button', { name: new RegExp(`GET\\s+${name}`) })
        .first()
        .click();
    }

    // Run.
    await app.getByRole('button', { name: 'Run with assertions' }).click();
    await expect(app.getByText('2/2 passed')).toBeVisible();

    // Per-step section is now rendered. Scope queries to the section so
    // the request-tree rows don't satisfy the `alpha-req` text match.
    const detailsSection = app.getByLabel('Per-step run details');
    await expect(app.getByText('Last run · per-step details')).toBeVisible();
    await expect(detailsSection.getByText('alpha-req')).toBeVisible();
    await expect(detailsSection.getByText('beta-req')).toBeVisible();

    // First row open by default — contains the URL.
    await expect(detailsSection.getByText('https://api.example.test/alpha')).toBeVisible();

    // Expand the second row + see beta URL + Monaco response body.
    await detailsSection.getByRole('button', { expanded: false, name: /beta-req/ }).click();
    await expect(detailsSection.getByText('https://api.example.test/beta')).toBeVisible();
    await expect.poll(() => monaco.read('Step 2 response body')).toContain('"name": "Beta"');
  });

  test('failing step row shows the warning verdict + error detail', async ({ app, mockApi }) => {
    await mockApi.json(/api\.example\.test\/x/, { ok: true });

    await app.getByLabel('New request').click();
    await app.getByLabel('Request name').fill('one');
    await app.getByLabel('Request URL').fill('https://api.example.test/x');
    // Add a status==999 assertion which will fail.
    await app
      .getByRole('button', { name: /^Assertions/ })
      .first()
      .click();
    await app.getByRole('button', { name: /^Add assertion$/ }).click();
    await app.getByLabel('Assertion 1 expected').fill('999');

    await app.getByRole('button', { name: /^Execution$/ }).click();
    await app.getByRole('button', { name: 'Create plan' }).first().click();
    await app.getByRole('button', { name: 'Add step' }).click();
    await app
      .getByRole('button', { name: /^GET\s+one/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Run with assertions' }).click();

    await expect(app.getByText('0/1 passed')).toBeVisible();
    // Per-step row shows the assertion verdict mismatch.
    await expect(app.getByText(/Expected.*999/i)).toBeVisible();
  });
});
