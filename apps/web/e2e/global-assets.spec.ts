import { expect, test } from './fixtures/app';

// P17 — Global Assets library. Workspace-wide store of JSON Schemas +
// GraphQL definitions, opened from the top bar. Covers add / rename /
// switch tabs / delete-with-confirm.

test.describe('Global Assets library (P17)', () => {
  test('opens from the top bar with two tabs and an empty state', async ({ app }) => {
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    const dialog = app.getByRole('dialog', { name: 'Global Assets library' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /JSON Schemas/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^GraphQL/ })).toBeVisible();
    await expect(dialog.getByText('No schemas yet.')).toBeVisible();
  });

  test('add a JSON Schema, rename it, and persist after closing', async ({ app, monaco }) => {
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    await app.getByRole('button', { name: 'Add JSON Schema' }).click();

    // The new entry is auto-selected; the schema editor is a Monaco
    // instance keyed by aria-label "Schema body".
    await monaco.ready('Schema body');
    await app.getByLabel('Schema name').fill('User');
    await app.getByLabel('Schema description').fill('User payload schema');
    await monaco.fill('Schema body', '{"type":"object","required":["id"]}');

    // Close + reopen → the schema persists.
    await app.keyboard.press('Escape');
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    await expect(app.getByRole('button', { name: /User/ })).toBeVisible();
  });

  test('switch to GraphQL tab, add a definition, change kind to Introspection', async ({
    app,
    monaco,
  }) => {
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    await app.getByRole('button', { name: /^GraphQL/ }).click();
    await app.getByRole('button', { name: 'Add GraphQL schema' }).click();
    await monaco.ready('GraphQL schema body');

    const kindSelect = app.getByLabel('GraphQL kind');
    await expect(kindSelect).toHaveValue('sdl');
    await kindSelect.selectOption('introspection');
    await expect(kindSelect).toHaveValue('introspection');
  });

  test('delete a schema is gated through ConfirmDialog', async ({ app, monaco }) => {
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    await app.getByRole('button', { name: 'Add JSON Schema' }).click();
    await monaco.ready('Schema body');
    await app.getByLabel('Schema name').fill('Doomed');

    await app.getByRole('button', { name: /Delete schema Doomed/ }).click();
    // ConfirmDialog with destructive tone.
    const confirm = app.getByRole('dialog', { name: /^Delete "Doomed"/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    // Schema is gone from the sidebar.
    await expect(app.getByRole('button', { name: /Doomed/ })).not.toBeVisible();
    await expect(app.getByText('No schemas yet.')).toBeVisible();
  });
});

test.describe('Body Schema picker integration (P18 surface)', () => {
  test('picker shows in BodyTab when type=json and selecting a schema persists', async ({
    app,
    monaco,
  }) => {
    // Pre-seed a schema via the library.
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    await app.getByRole('button', { name: 'Add JSON Schema' }).click();
    await monaco.ready('Schema body');
    await app.getByLabel('Schema name').fill('UserSchema');
    await monaco.fill('Schema body', '{"type":"object","required":["id"]}');
    await app.keyboard.press('Escape');

    // Open a request and switch the body to JSON.
    await app.getByLabel('New request').click();
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'JSON' }).click();

    const picker = app.getByLabel('JSON schema');
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: 'UserSchema' });
    await expect(picker).not.toHaveValue('');
  });

  test('picker shows in BodyTab when type=graphql', async ({ app, monaco }) => {
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    await app.getByRole('button', { name: /^GraphQL/ }).click();
    await app.getByRole('button', { name: 'Add GraphQL schema' }).click();
    await monaco.ready('GraphQL schema body');
    await app.getByLabel('GraphQL schema name').fill('PetsAPI');
    await app.keyboard.press('Escape');

    await app.getByLabel('New request').click();
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'GraphQL' }).click();

    const picker = app.getByLabel('GraphQL schema');
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: 'PetsAPI' });
  });
});
