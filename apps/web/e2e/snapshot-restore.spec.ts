import { expect, test } from './fixtures/app';

// Phase 6 sanity: a manual snapshot captures the workspace, mutating
// afterward dirties it, and Restore swaps it back. Doesn't exercise
// pre-destructive auto-captures (those need a connected repo + GitHub
// fixtures); the manual path proves the underlying patches are wired.

test.describe('Workspace snapshots', () => {
  test('capture → mutate → restore round-trip', async ({ app, sidebar }) => {
    // Seed a request so we have something on synced to verify after restore.
    await sidebar.createRequest('Original');

    // Switch to History, click the Snapshots tab, take a snapshot.
    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByRole('tab', { name: /Snapshots/ }).click();
    await app.getByRole('button', { name: 'Take snapshot now' }).click();

    // Snapshot row should appear with a Manual badge. Use a partial match
    // on the trigger label since the row's full text is "Manual · ...".
    await expect(app.getByText('Manual', { exact: true })).toBeVisible();

    // Now mutate: rename Original → Renamed via the kebab.
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app.getByLabel('Request actions for Original').click();
    await app.getByRole('menuitem', { name: 'Rename' }).click();
    await app.getByLabel('Rename request Original').fill('Renamed');
    await app.keyboard.press('Enter');
    await expect(app.getByText('Renamed', { exact: true })).toBeVisible();

    // Restore — open History, switch to Snapshots tab, click Restore,
    // type-confirm RESTORE.
    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByRole('tab', { name: /Snapshots/ }).click();
    await app.getByLabel(/^Restore snapshot from /).click();
    const dialog = app.getByRole('dialog', { name: 'Restore workspace snapshot' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Type to confirm').fill('RESTORE');
    await dialog.getByRole('button', { name: 'Restore' }).click();

    // Editor should show Original again, not Renamed.
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await expect(app.getByText('Original', { exact: true })).toBeVisible();
    await expect(app.getByText('Renamed', { exact: true })).toBeHidden();
  });
});
