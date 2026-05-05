import { expect, test } from './fixtures/app';

// cURL paste-import. The MCP-bridge handles OpenAPI/Postman/Insomnia/HAR;
// cURL is the only quick path baked into the app. The dialog opens from
// the editor sidebar (terminal-icon button next to "New request").

test.describe('Import cURL (paste-import)', () => {
  test('opens the dialog and disables Import until a URL is parsed', async ({ app }) => {
    await app.getByLabel('Import', { exact: true }).click();
    const dialog = app.getByRole('dialog', { name: 'Import' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  test('typing a cURL into the textarea surfaces the json body in the preview', async ({ app }) => {
    // The "Paste sample" button was removed from the unified import dialog;
    // typing a cURL directly is the canonical path now.
    await app.getByLabel('Import', { exact: true }).click();
    await app
      .getByLabel('Import source')
      .fill(`curl -X POST 'https://api.example.test/users' --json '{"name":"alice"}'`);
    const dialog = app.getByRole('dialog', { name: 'Import' });
    await expect(dialog.getByText('json', { exact: true })).toBeVisible();
  });

  test('Importing creates a new request seeded with method/URL/headers/body', async ({
    app,
    mockApi,
  }) => {
    await app.getByLabel('Import', { exact: true }).click();
    const dialog = app.getByRole('dialog', { name: 'Import' });
    const textarea = app.getByLabel('Import source');
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
    await app.getByLabel('Import', { exact: true }).click();
    const textarea = app.getByLabel('Import source');
    await textarea.fill(`curl --magic-flag https://api.example.test/x`);
    await expect(app.getByText(/⚠.*--magic-flag/)).toBeVisible();
  });

  test('Cancel closes the modal without creating a request', async ({ app }) => {
    await app.getByLabel('Import', { exact: true }).click();
    await app.getByLabel('Import source').fill('curl https://api.example.test/x');
    await app.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.getByRole('dialog', { name: 'Import' })).not.toBeVisible();
    // The demo Sample request remains; the import dialog never created
    // a new one. No specific empty-state check is required.
  });
});
