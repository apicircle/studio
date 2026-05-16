import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module VR.
import { tcMapVR } from './fixtures/tcMapVR';
void Object.keys(tcMapVR);

function id(key: string): TcId {
  const v = tcMapVR[key];
  if (!v) throw new Error(`No TC-VR entry for "${key}"`);
  return v;
}
function id(key: string): TcId {
  const v = tcMapVR[key];
  if (!v) throw new Error(`No TC-VR entry for "${key}"`);
  return v;
}
// Plan §10.2 "Secret Vault" suite — open vault → add secret → reveal →
// reference it in a request → see the where-used expander → try to delete
// → confirmation gate fires → confirm and verify deletion.

test.describe('Secret Vault', () => {
  test(
    tc(
      id('Var :: Add plaintext var'),
      'add → list → reveal cycle persists through master-key crypto @smoke',
    ),
    async ({ app }) => {
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await expect(app.getByRole('dialog', { name: /Secret Vault/ })).toBeVisible();

      await app.getByRole('button', { name: 'New secret' }).click();
      await app.getByLabel('New secret label').fill('API_KEY');
      await app.getByLabel('New secret value').fill('sk_test_abc');
      await app.getByRole('button', { name: 'Save', exact: true }).click();

      const row = app.getByRole('listitem').filter({ hasText: 'API_KEY' });
      await expect(row).toBeVisible();
      // Origin badge — exact-match the lowercase "workspace" string so this
      // doesn't collide with "/ My Workspace", the panel tab, or
      // "Cross-workspace named secrets" prose.
      await expect(row.getByText('workspace', { exact: true })).toBeVisible();

      await app.getByRole('button', { name: 'Reveal API_KEY' }).click();
      await expect(app.getByText('sk_test_abc')).toBeVisible();
    },
  );

  test(
    tc(
      id('Env :: Delete env with confirm'),
      'delete is blocked when usedIn is non-empty until confirmed',
    ),
    async ({ app, sidebar }) => {
      // Seed a secret via the vault.
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: 'New secret' }).click();
      await app.getByLabel('New secret label').fill('TOKEN');
      await app.getByLabel('New secret value').fill('hello');
      await app.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(app.getByRole('listitem').filter({ hasText: 'TOKEN' })).toBeVisible();
      // Close the modal so we can interact with the editor.
      await app.keyboard.press('Escape');

      // Create a request that references the secret label.
      await sidebar.createRequest('secret-ref');
      await app.getByLabel('Request URL').fill('https://api.example.test/{{TOKEN}}');

      // Reopen the vault — usedIn is now populated.
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();

      // First click on Delete shows the "In use (1)" guard.
      const deleteBtn = app.getByRole('button', { name: 'Delete TOKEN' });
      await expect(deleteBtn).toContainText(/In use \(1\)/);
      await deleteBtn.click();
      await expect(app.getByText(/referenced in 1 place/)).toBeVisible();

      // Confirm step — second click deletes.
      await app.getByRole('button', { name: 'Delete TOKEN' }).click();
      await expect(app.getByRole('listitem').filter({ hasText: 'TOKEN' })).toHaveCount(0);
    },
  );
});
