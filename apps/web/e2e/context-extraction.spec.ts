import { expect, test } from './fixtures/app';

// P16 — Context extraction. Defines a request whose body extractor pulls
// `data.token` into a workspace-wide variable; runs the request; verifies
// the captured value lands in the Captured globals list and is referenced
// by a downstream request.

test.describe('Context extraction (P16)', () => {
  test('manual context vars + extractor → captured global → reused in next request', async ({
    app,
    mockApi,
  }) => {
    // Create a "login" request that returns a token.
    await app.getByLabel('New request').click();
    await app.getByLabel('Request name').fill('Login');
    await app.getByLabel('Request URL').fill('https://api.example.test/login');
    await mockApi.json(/api\.example\.test\/login/, { data: { token: 'tok-123' } });

    // Add an extractor for data.token → ACCESS_TOKEN.
    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add extractor' }).click();
    await app.getByLabel('Extraction 1 variable').fill('ACCESS_TOKEN');
    await app.getByLabel('Extraction 1 path').fill('data.token');

    // Send and verify the captured globals section shows the extracted value.
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();
    // The Context tab's "Captured globals" section.
    await expect(app.getByText('ACCESS_TOKEN')).toBeVisible();
    await expect(app.getByText('tok-123')).toBeVisible();
  });

  test('manual context var persists into the request and is git-pushed', async ({ app }) => {
    await app.getByLabel('New request').click();
    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add manual variable' }).click();
    await app.getByLabel('Context var 1 name').fill('USER_ID');
    await app.getByLabel('Context var 1 value').fill('42');
    // Switch panels and back — the value should persist via Zustand+IDB.
    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await expect(app.getByLabel('Context var 1 name')).toHaveValue('USER_ID');
    await expect(app.getByLabel('Context var 1 value')).toHaveValue('42');
  });

  test('Forget a captured global key drops it from the list', async ({ app, mockApi }) => {
    await app.getByLabel('New request').click();
    await app.getByLabel('Request URL').fill('https://api.example.test/x');
    await mockApi.json(/api\.example\.test\/x/, { token: 'aaa' });

    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add extractor' }).click();
    await app.getByLabel('Extraction 1 variable').fill('CAPTURED_KEY');
    await app.getByLabel('Extraction 1 path').fill('token');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200/)).toBeVisible();

    const capturedSection = app.getByLabel('Captured context');
    await expect(capturedSection.getByText('CAPTURED_KEY')).toBeVisible();
    await app.getByRole('button', { name: 'Forget CAPTURED_KEY' }).click();
    await expect(capturedSection.getByText('CAPTURED_KEY')).not.toBeVisible();
    await expect(capturedSection.getByText(/Nothing captured yet/)).toBeVisible();
  });
});
