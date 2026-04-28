import { expect, test } from './fixtures/app';

// cURL paste-import. The MCP-bridge handles OpenAPI/Postman/Insomnia/HAR;
// cURL is the only quick path baked into the app. The dialog opens from
// the editor sidebar (terminal-icon button next to "New request").

test.describe('Import cURL (paste-import)', () => {
  test('opens the dialog and disables Import until a URL is parsed', async ({ app }) => {
    await app.getByLabel('Import cURL').click();
    const dialog = app.getByRole('dialog', { name: 'Import cURL' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  test('Paste sample fills a working cURL into the textarea', async ({ app }) => {
    await app.getByLabel('Import cURL').click();
    await app.getByRole('button', { name: /Paste sample/ }).click();
    await expect(app.getByLabel('cURL command')).not.toHaveValue('');
    // Preview surfaces body=json. Match against the preview's code label
    // (textarea contents would also match "POST" otherwise).
    const dialog = app.getByRole('dialog', { name: 'Import cURL' });
    await expect(dialog.getByText('json', { exact: true })).toBeVisible();
  });

  test('Importing creates a new request seeded with method/URL/headers/body', async ({
    app,
    mockApi,
  }) => {
    await app.getByLabel('Import cURL').click();
    const dialog = app.getByRole('dialog', { name: 'Import cURL' });
    const textarea = app.getByLabel('cURL command');
    await textarea.fill(
      `curl -X POST 'https://api.example.test/users' -H 'X-Foo: Bar' --json '{"name":"alice"}'`,
    );
    // Scope to the dialog — there's also an aria-labelled "Import cURL"
    // button in the sidebar that matches an unscoped /Import/ search.
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();

    // Editor populated with the parsed values.
    await expect(app.getByLabel('Request URL')).toHaveValue('https://api.example.test/users');
    await expect(app.getByLabel('HTTP method')).toHaveValue('POST');

    // Header is on the request.
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await expect(app.getByLabel('Headers key 1')).toHaveValue('X-Foo');
    await expect(app.getByLabel('Headers value 1')).toHaveValue('Bar');

    // Send hits the mock and reports 200.
    await mockApi.json(/api\.example\.test\/users/, { ok: true });
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200/)).toBeVisible();
  });

  test('preview shows warnings for unrecognised flags', async ({ app }) => {
    await app.getByLabel('Import cURL').click();
    const textarea = app.getByLabel('cURL command');
    await textarea.fill(`curl --magic-flag https://api.example.test/x`);
    await expect(app.getByText(/⚠.*--magic-flag/)).toBeVisible();
  });

  test('Cancel closes the modal without creating a request', async ({ app }) => {
    await app.getByLabel('Import cURL').click();
    await app.getByLabel('cURL command').fill('curl https://api.example.test/x');
    await app.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.getByRole('dialog', { name: 'Import cURL' })).not.toBeVisible();
    // No request was created (sidebar still empty).
    await expect(app.getByText(/No requests yet/i)).toBeVisible();
  });
});
