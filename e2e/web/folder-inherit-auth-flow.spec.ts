// End-to-end spec for the full folder-wise-auth flow:
//
//   1. Create a folder in the sidebar.
//   2. Open the folder kebab → Set auth → pick bearer → fill token → save.
//   3. Create a request inside that folder.
//   4. Confirm the request's Auth tab still reads `inherit` (the default for
//      requests created inside a folder) — i.e. the request was NOT cloned
//      with a per-request bearer.
//   5. Send the request against a mocked endpoint and assert the
//      Authorization: Bearer <token> header reached the wire — proving the
//      inherit walk resolves at send time end-to-end.
//
// This is the layer 6 audit's "Playwright insurance" spec — every layer
// (data model, reducer, store, executor, applyAuth, signing) is exercised
// in one run. If any layer drops the inherited auth, this spec fails.

import { expect, test } from './fixtures/app';
import type { Page } from '@playwright/test';
import type { Route } from '@playwright/test';

const FOLDER = 'Authenticated';
const FOLDER_TOKEN = 'folder-bearer-' + Math.random().toString(36).slice(2, 10);

async function setFolderAuthBearer(page: Page, folderName: string, token: string): Promise<void> {
  // Open the folder kebab menu — labelled `Folder actions for <name>`.
  await page.getByRole('button', { name: `Folder actions for ${folderName}`, exact: true }).click();
  // "Set auth" is the label when no folder auth is yet set.
  await page.getByRole('menuitem', { name: 'Set auth', exact: true }).click();

  // The FolderAuthModal is rendered. Changes apply on every onChange via
  // setFolderAuth(folderId, next) — there is no Save button; closing with
  // Done is enough to persist.
  await page.getByLabel('Auth type').selectOption('bearer');
  await page.getByRole('textbox', { name: 'Bearer token', exact: true }).fill(token);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

test.describe('Folder-wise auth — full inherit flow', () => {
  test('folder bearer auth flows to an inherit request and reaches the wire', async ({
    app,
    sidebar,
    mockApi,
  }) => {
    // ----- Setup: capture the Authorization header on every wire hit. -----
    const authHeaders: string[] = [];
    await app.route(/api\.example\.test\/inherit-flow/, (route: Route) => {
      const req = route.request();
      const auth = req.headers()['authorization'] ?? '';
      authHeaders.push(auth);
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, sawAuth: auth }),
      });
    });
    void mockApi; // captured via app.route — fixture stays unused here

    // ----- 1. Create the folder. -----
    await sidebar.createFolder(FOLDER);
    await expect(app.getByText(FOLDER, { exact: true })).toBeVisible();

    // ----- 2. Set folder-level bearer auth. -----
    await setFolderAuthBearer(app, FOLDER, FOLDER_TOKEN);

    // Shield icon should now be visible next to the folder name — confirms
    // the folder.update patch landed and the description re-rendered.
    await expect(
      app.getByRole('button', { name: /Folder auth set \(bearer\) — edit/ }),
    ).toBeVisible();

    // ----- 3. Create a request inside the folder. -----
    // Open the folder's kebab → New request to scaffold the request as a
    // child of this folder (not at the root).
    await app.getByRole('button', { name: `Folder actions for ${FOLDER}`, exact: true }).click();
    await app.getByRole('menuitem', { name: 'New request', exact: true }).click();

    const nameInput = app.getByLabel('New request name', { exact: true });
    await nameInput.fill('list-invoices');
    await nameInput.press('Enter');
    // Wait for the editor to switch to the freshly-created request.
    await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('list-invoices');

    // ----- 4. The Auth tab should default to `inherit`. -----
    await app.getByRole('button', { name: /^Auth/ }).first().click();
    await expect(app.getByLabel('Auth type')).toHaveValue('inherit');
    await expect(
      app.getByText(/walks up the folder chain and uses the first folder/i),
    ).toBeVisible();

    // ----- 5. Send the request and verify the bearer reached the wire. -----
    await app.getByLabel('Request URL').fill('https://api.example.test/inherit-flow');
    await app.getByRole('button', { name: /^Send$/ }).click();

    // Response panel should show 200.
    await expect(app.getByText(/^200/)).toBeVisible();

    // The captured Authorization header should carry the FOLDER's token.
    expect(authHeaders.length).toBeGreaterThan(0);
    const seen = authHeaders[authHeaders.length - 1];
    expect(seen).toBe(`Bearer ${FOLDER_TOKEN}`);
  });
});
