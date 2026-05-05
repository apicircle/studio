import { expect, test } from './fixtures/app';

// P14 — History clearing. Sends three requests so the history pane has
// rows, then exercises per-row delete, the typed filter + matching
// clear, and clear-all (with the destructive-confirm dialog).

test.describe('Clear History (P14)', () => {
  test('per-row delete removes one run and leaves the others', async ({
    app,
    mockApi,
    sidebar,
  }) => {
    await mockApi.json(/api\.example\.test\/.+/, { ok: true });
    await sidebar.createRequest('alpha');
    await app.getByLabel('Request URL').fill('https://api.example.test/alpha');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();

    await sidebar.createRequest('beta');
    await app.getByLabel('Request URL').fill('https://api.example.test/beta');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();

    await app.getByRole('button', { name: /^History$/ }).click();
    await expect(app.getByRole('tab', { name: /^Requests/ })).toBeVisible();
    await expect(app.getByText('alpha')).toBeVisible();
    await expect(app.getByText('beta')).toBeVisible();

    // Per-row trash on the alpha row. The listitem contains BOTH the
    // expandable run button AND a delete span-with-role-button — match
    // the delete control by its exact aria-label.
    const alphaRow = app.getByRole('listitem').filter({ hasText: 'alpha' }).first();
    await alphaRow.getByLabel(/^Delete request run from /).click();

    await expect(app.getByText('alpha')).not.toBeVisible();
    await expect(app.getByText('beta')).toBeVisible();
  });

  test('Clear all wipes the request runs after confirmation', async ({ app, mockApi, sidebar }) => {
    await mockApi.json(/api\.example\.test\/.+/, { ok: true });
    await sidebar.createRequest('only-one');
    await app.getByLabel('Request URL').fill('https://api.example.test/x');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();

    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByRole('button', { name: /^Clear all$/ }).click();

    // Confirm dialog opens.
    await app.getByRole('button', { name: 'Clear', exact: true }).click();

    await expect(app.getByText(/No request runs yet/)).toBeVisible();
  });

  test('Clear matching wipes only filtered rows', async ({ app, mockApi, sidebar }) => {
    await mockApi.json(/api\.example\.test\/.+/, { ok: true });
    for (const name of ['keep-1', 'drop-1', 'drop-2']) {
      await sidebar.createRequest(name);
      await app.getByLabel('Request URL').fill(`https://api.example.test/${name}`);
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
    }
    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByLabel('Filter by search').fill('drop');
    await app.getByRole('button', { name: /^Clear matching/ }).click();
    await app.getByRole('button', { name: 'Clear', exact: true }).click();

    // Drop the filter; only the keep row should remain.
    await app.getByLabel('Filter by search').fill('');
    await expect(app.getByText('keep-1')).toBeVisible();
    await expect(app.getByText('drop-1')).not.toBeVisible();
    await expect(app.getByText('drop-2')).not.toBeVisible();
  });

  test('Clear all is disabled when there are no runs', async ({ app }) => {
    await app.getByRole('button', { name: /^History$/ }).click();
    await expect(app.getByRole('button', { name: /^Clear all$/ })).toBeDisabled();
  });
});
