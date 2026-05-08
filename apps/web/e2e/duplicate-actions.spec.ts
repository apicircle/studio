import { expect, test } from './fixtures/app';

// Duplicate/clone action coverage across folder, request, environment, and
// mock entities. The kebab menu is the only path that exposes duplicate in
// the editor sidebar after Phase 3, so the spec drives every duplicate
// through the menu.

test.describe('Duplicate actions', () => {
  test('duplicate request — fresh id + "(copy)" name + same folder', async ({ app, sidebar }) => {
    await sidebar.createRequest('Get user');

    // Open the kebab menu for the only request and pick Duplicate.
    await app.getByLabel('Request actions for Get user').click();
    await app.getByRole('menuitem', { name: 'Duplicate' }).click();

    const tree = app.getByRole('tree', { name: 'Requests' });
    await expect(tree.getByText('Get user', { exact: true })).toBeVisible();
    await expect(tree.getByText('Get user (copy)', { exact: true })).toBeVisible();
  });

  test('duplicate folder — clones the subtree with re-id', async ({ app, sidebar }) => {
    await sidebar.createFolder('Auth');

    // Drop into the folder's kebab and duplicate.
    await app.getByLabel('Folder actions for Auth').click();
    await app.getByRole('menuitem', { name: 'Duplicate' }).click();

    const tree = app.getByRole('tree', { name: 'Requests' });
    await expect(tree.getByText('Auth', { exact: true })).toBeVisible();
    await expect(tree.getByText('Auth (copy)', { exact: true })).toBeVisible();
  });

  test('duplicate environment — kebab menu copies vars list', async ({ app }) => {
    // Switch to Environments panel.
    await app.getByRole('button', { name: /^Environments$/ }).click();
    await app.getByLabel('New environment').click();
    await app.getByLabel('Environment name').fill('dev');
    await app.keyboard.press('Enter');

    // Confirm dev exists, open its kebab, click Duplicate.
    await expect(app.getByText('dev', { exact: true })).toBeVisible();
    await app.getByLabel('Environment actions for dev').click();
    await app.getByRole('menuitem', { name: 'Duplicate' }).click();

    await expect(app.getByText('dev (copy)', { exact: true })).toBeVisible();
  });
});
