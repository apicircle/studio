import { expect, test } from './fixtures/app';

// Plan §5.1: workspace-self releases. Local-only flow — no GitHub
// session needed. Publish v0.1.0, see it in the list, deprecate it,
// type-confirm a yank.

test.describe('Workspace-self releases (P5.1)', () => {
  test('publish → list → deprecate → typed-yank', async ({ app }) => {
    await app.getByRole('button', { name: /^Workspace$/ }).click();
    // Empty-state message before any publish.
    await expect(app.getByText(/No releases yet/)).toBeVisible();

    await app.getByRole('button', { name: /Publish release/ }).click();
    await app.getByLabel('Release version').fill('0.1.0');
    await app.getByLabel('Release notes').fill('first cut');
    await app.getByRole('button', { name: /Review .* publish/ }).click();
    await app.getByRole('button', { name: 'Publish', exact: true }).click();

    // Card shows the version + the release row.
    await expect(app.getByText('v0.1.0').first()).toBeVisible();
    await expect(app.getByText('first cut')).toBeVisible();

    // Deprecate confirms with a single click.
    await app.getByRole('button', { name: 'Deprecate' }).click();
    await app.getByRole('button', { name: 'Deprecate', exact: true }).last().click();
    await expect(app.getByText(/deprecated/i)).toBeVisible();

    // Yank requires typed confirmation.
    await app.getByRole('button', { name: /Yank/ }).first().click();
    const yankButton = app.getByRole('button', { name: 'Yank', exact: true }).last();
    await expect(yankButton).toBeDisabled();
    await app.getByLabel('Type to confirm').fill('YANK v0.1.0');
    await expect(yankButton).toBeEnabled();
    await yankButton.click();
    await expect(app.getByText(/yanked/i)).toBeVisible();
  });
});
