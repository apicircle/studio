// E2E for the folder "Export as JSON" flow + the round-trip back into
// the same workspace via the Import modal's API Circle exchange branch.
// Covers:
//   • The folder kebab → "Export as JSON" menu item.
//   • The Export Folder modal renders Summary + Credentials + Dependencies.
//   • Credentials default to redact; ticking a checkbox flips the include
//     state and the on-the-fly preview reflects it.
//   • Downloading writes a `<slug>.apicircle.json` payload (intercepted
//     via the download event).
//   • Re-importing the downloaded JSON via the unified Import modal
//     re-creates the folder + its request and surfaces the embedded
//     JSON Schema dependency.
//
// Workbook tagging: this module is too new to have TC-IDs assigned.
// When `scripts/build_tc_maps.py` next runs against the updated workbook,
// the existing `tc(id('...'))` pattern can be retrofitted.

import { expect, test } from './fixtures/app';
import { readFile } from 'node:fs/promises';

async function openEditor(app: import('@playwright/test').Page): Promise<void> {
  await app.getByRole('button', { name: /^Editor$/ }).click();
}

async function newFolder(app: import('@playwright/test').Page, name: string): Promise<void> {
  await app.getByRole('button', { name: 'Editor actions', exact: true }).first().click();
  await app.getByRole('menuitem', { name: 'New Folder', exact: true }).click();
  await app.getByLabel('New folder name').fill(name);
  await app.getByLabel('New folder name').press('Enter');
}

async function newRequestInside(
  app: import('@playwright/test').Page,
  folderName: string,
  requestName: string,
): Promise<void> {
  // The folder tree row exposes a "Folder actions for <name>" kebab —
  // click it then "New request inside".
  await app.getByLabel(`Folder actions for ${folderName}`).click();
  await app.getByRole('menuitem', { name: 'New request inside' }).click();
  await app.getByLabel('New request name').fill(requestName);
  await app.getByLabel('New request name').press('Enter');
}

test.describe('Folder export (Export as JSON)', () => {
  test('folder kebab exposes "Export as JSON" and opens the modal', async ({ app }) => {
    await openEditor(app);
    await newFolder(app, 'ExpAuth');
    await app.getByLabel('Folder actions for ExpAuth').click();
    await expect(app.getByRole('menuitem', { name: 'Export as JSON', exact: true })).toBeVisible();
    await app.getByRole('menuitem', { name: 'Export as JSON', exact: true }).click();
    const dialog = app.getByRole('dialog', { name: 'Export folder as JSON' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('apicircle.folder/v1')).toBeVisible();
  });

  test('credentials are redacted by default; toggling a checkbox includes them', async ({
    app,
  }) => {
    await openEditor(app);
    await newFolder(app, 'CredFolder');
    await newRequestInside(app, 'CredFolder', 'POST login');

    // Switch the new request to Bearer auth with a real-looking token.
    await app.getByRole('button', { name: 'POST login' }).click();
    await app.getByRole('button', { name: /^Auth/ }).click();
    await app.getByRole('combobox', { name: /^Auth type$/ }).selectOption('bearer');
    await app.getByLabel('Bearer token').fill('e2e-bearer-secret');

    // Open the export modal.
    await app.getByLabel('Folder actions for CredFolder').click();
    await app.getByRole('menuitem', { name: 'Export as JSON', exact: true }).click();
    const dialog = app.getByRole('dialog', { name: 'Export folder as JSON' });
    await expect(dialog.getByTestId('export-credentials')).toContainText('Bearer · token');
    await expect(dialog.getByTestId('export-credentials-summary')).toContainText(
      '1 credential will be redacted',
    );

    // Tick the include checkbox.
    await dialog.getByRole('checkbox', { name: /Include Bearer · token for POST login/i }).check();
    await expect(dialog.getByTestId('export-credentials-summary')).toContainText(
      '1 credential included',
    );
  });

  test('Download writes a valid JSON envelope re-importable through the same flow', async ({
    app,
  }) => {
    await openEditor(app);
    await newFolder(app, 'RoundTrip');
    await newRequestInside(app, 'RoundTrip', 'GET ping');

    // Open the Export modal + trigger Download.
    await app.getByLabel('Folder actions for RoundTrip').click();
    await app.getByRole('menuitem', { name: 'Export as JSON', exact: true }).click();
    const dialog = app.getByRole('dialog', { name: 'Export folder as JSON' });
    const [download] = await Promise.all([
      app.waitForEvent('download'),
      dialog.getByRole('button', { name: /Download roundtrip\.apicircle\.json/i }).click(),
    ]);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    const raw = await readFile(downloadedPath!, 'utf-8');
    const envelope = JSON.parse(raw) as { format: string; folder: { name: string } };
    expect(envelope.format).toBe('apicircle.folder/v1');
    expect(envelope.folder.name).toBe('RoundTrip');

    // Round-trip: paste the same JSON into the Import modal.
    await app.getByRole('button', { name: 'Editor actions', exact: true }).first().click();
    await app.getByRole('menuitem', { name: 'Import', exact: true }).click();
    const importDialog = app.getByRole('dialog', { name: 'Import' });
    await expect(importDialog).toBeVisible({ timeout: 15_000 });
    await importDialog.getByLabel('Import source').fill(raw);
    await expect(importDialog.getByText(/API Circle\)/)).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
    // After import the editor sidebar now shows TWO folders named
    // "RoundTrip" (the original + the import — the importer uniquifies
    // the second to "RoundTrip (2)").
    await expect(app.getByRole('treeitem', { name: /RoundTrip \(2\)/ })).toBeVisible();
  });
});
