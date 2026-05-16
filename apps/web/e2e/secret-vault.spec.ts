import { expect, test } from './fixtures/app';
import type { Page } from '@playwright/test';

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

/**
 * Set a workspace passphrase via the store. On the web build, secrets
 * can't be added until `synced.secretCrypto` is configured — the
 * platform secret gate (`persistence/platformSecretGate.ts`) refuses
 * otherwise because the master key would sit in plaintext IndexedDB.
 *
 * The product's lazy "Set passphrase" prompt (PassphrasePromptModalGate)
 * isn't wired to a UI trigger yet, so the E2E suite drives the
 * `setupPassphrase` store action directly — the passphrase model itself
 * is fully functional, only the trigger UI is pending.
 */
async function setWorkspacePassphrase(app: Page, passphrase: string): Promise<void> {
  const result = await app.evaluate(async (pass: string) => {
    const w = window as unknown as {
      __apicircleStore?: {
        getState: () => {
          setupPassphrase: (p: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
        };
      };
    };
    const store = w.__apicircleStore;
    if (!store) return { ok: false, reason: '__apicircleStore not exposed' };
    return store.getState().setupPassphrase(pass);
  }, passphrase);
  expect(result.ok, result.ok ? '' : `setupPassphrase failed: ${result.reason}`).toBe(true);
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
      // Web build gates secret creation behind a workspace passphrase.
      await setWorkspacePassphrase(app, 'e2e-test-passphrase');
      // The Secret Vault opens in the right-side dock (an `aside` with
      // role="complementary"), not a modal — see layout/RightDock.tsx.
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await expect(app.getByRole('complementary', { name: 'Workspace inspector' })).toBeVisible();
      await expect(app.getByRole('tab', { name: 'Vault' })).toHaveAttribute(
        'aria-selected',
        'true',
      );

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
      // Web build gates secret creation behind a workspace passphrase.
      await setWorkspacePassphrase(app, 'e2e-test-passphrase');
      // Seed a secret via the vault.
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await app.getByRole('button', { name: 'New secret' }).click();
      await app.getByLabel('New secret label').fill('TOKEN');
      await app.getByLabel('New secret value').fill('hello');
      await app.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(app.getByRole('listitem').filter({ hasText: 'TOKEN' })).toBeVisible();
      // Close the dock so we can interact with the editor. The dock has a
      // dedicated "Close workspace inspector" button (RightDock.tsx) — it's
      // not Escape-dismissable like a modal.
      await app.getByRole('button', { name: 'Close workspace inspector' }).click();

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
