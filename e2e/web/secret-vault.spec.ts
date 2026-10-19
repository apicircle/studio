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
 * The Vault dock now surfaces a "Set passphrase" CTA + modal for users
 * (see the `set-passphrase CTA` test below for the UI path). Existing
 * specs that just need to GET PAST the gate use this helper to skip
 * the modal interaction — the passphrase model itself isn't under test
 * here.
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
    tc(id('Passphrase'), 'web-build "Set passphrase" CTA opens the modal and unblocks New secret'),
    async ({ app }) => {
      // Open the vault dock. On the web build with no `secretCrypto` set
      // yet, the gate replaces the New-secret button with a primary
      // "Set passphrase" CTA. This is the path that used to dead-end at
      // a toast pointing the user at a button that didn't exist.
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await expect(app.getByRole('complementary', { name: 'Workspace inspector' })).toBeVisible();

      // CTA visible; New secret hidden until passphrase is set.
      await expect(app.getByRole('group', { name: /Set workspace passphrase/ })).toBeVisible();
      await expect(app.getByRole('button', { name: 'New secret' })).toHaveCount(0);

      // Click "Set passphrase" → setup modal opens. Scope subsequent lookups
      // to the dialog: `getByLabel('Workspace passphrase')` substring-matches
      // the gate's group label ("Set workspace passphrase to enable Secret
      // Vault") and the dialog's own aria-label ("Set workspace passphrase"),
      // so the bare locator hits 3 elements.
      await app.getByRole('button', { name: /^Set passphrase$/ }).click();
      const dialog = app.getByRole('dialog', { name: 'Set workspace passphrase' });
      await expect(dialog).toBeVisible();
      const passInput = dialog.getByLabel('Workspace passphrase', { exact: true });
      await expect(passInput).toBeVisible();
      await passInput.fill('e2e-test-passphrase');
      await dialog.getByLabel('Confirm passphrase', { exact: true }).fill('e2e-test-passphrase');
      // The submit button's label is also "Set passphrase" — dialog scope
      // disambiguates it from the gate CTA.
      await dialog.getByRole('button', { name: /^Set passphrase$/ }).click();

      // Modal closes, CTA collapses, New secret returns. Add a secret to
      // prove the gate is fully released and crypto is wired.
      await expect(dialog).toHaveCount(0);
      await expect(app.getByRole('group', { name: /Set workspace passphrase/ })).toHaveCount(0);
      await app.getByRole('button', { name: 'New secret' }).click();
      await app.getByLabel('New secret label').fill('CTA_KEY');
      await app.getByLabel('New secret value').fill('cta-value');
      await app.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(app.getByRole('listitem').filter({ hasText: 'CTA_KEY' })).toBeVisible();
    },
  );

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

// The 2026-10-18 incident: ADMIN_TOKEN was encrypted with the vault slot
// ADMIN_TOKEN_ENCRYPTION_KEY, a request named the slot instead of the variable,
// and the slot's own value went to the server. History then kept the token in
// plain text. A slot that encrypts variables is now an encryption key: the
// editor blocks a request naming it, and History never stores a secret.
test.describe('Secret Vault — encryption keys and History', () => {
  const TOKEN = 'admin-token-e2e-7731';

  /** ADMIN_TOKEN encrypted under the ADMIN_TOKEN_ENCRYPTION_KEY slot. */
  async function seedEncryptedToken(app: Page): Promise<void> {
    await setWorkspacePassphrase(app, 'e2e-test-passphrase');
    const bound = await app.evaluate(async (token: string) => {
      const w = window as unknown as {
        __apicircleStore: {
          getState: () => {
            addEnvironment: (name: string) => void;
            setPriorityOrder: (refs: Array<{ kind: 'local'; name: string }>) => void;
            setVariables: (
              env: string,
              vars: Array<{ key: string; value: string; encrypted: boolean }>,
            ) => void;
            addSecret: (args: { label: string; value: string }) => Promise<string>;
            bindVariableToSecretKey: (env: string, index: number, id: string) => Promise<boolean>;
          };
        };
      };
      const s = w.__apicircleStore.getState();
      s.addEnvironment('staging');
      s.setPriorityOrder([{ kind: 'local', name: 'staging' }]);
      s.setVariables('staging', [{ key: 'ADMIN_TOKEN', value: token, encrypted: false }]);
      const slotId = await s.addSecret({
        label: 'ADMIN_TOKEN_ENCRYPTION_KEY',
        value: 'slot-passphrase-never-sent',
      });
      return s.bindVariableToSecretKey('staging', 0, slotId);
    }, TOKEN);
    expect(bound).toBe(true);
  }

  test(
    tc(
      id('Resolution'),
      'a request naming an encryption-key slot is blocked; the variable it encrypts is sent',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await seedEncryptedToken(app);

      // The vault row says what the slot is.
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      await expect(
        app
          .getByRole('listitem')
          .filter({ hasText: 'ADMIN_TOKEN_ENCRYPTION_KEY' })
          .getByText('Encryption key of ADMIN_TOKEN · not a variable'),
      ).toBeVisible();
      await app.getByRole('button', { name: 'Close workspace inspector' }).click();

      const path = '/anything/encryption-key-ref';
      await sidebar.createRequest('key-ref');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app
        .getByRole('tab', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('Authorization');
      await app.getByLabel('Headers value 1').fill('Bearer {{ADMIN_TOKEN_ENCRYPTION_KEY}}');
      await app.keyboard.press('Escape');

      const preSend = app.getByRole('region', { name: 'Pre-send validation' });
      await expect(preSend).toContainText(
        '{{ADMIN_TOKEN_ENCRYPTION_KEY}} is the encryption key of ADMIN_TOKEN, not a variable, ' +
          'so its value is never sent. Write {{ADMIN_TOKEN}} to send the variable.',
      );
      await expect(app.getByRole('button', { name: /^Send$/ })).toBeDisabled();

      // Writing the variable instead clears the blocker and sends its value.
      await app.getByLabel('Headers value 1').fill('Bearer {{ADMIN_TOKEN}}');
      await app.keyboard.press('Escape');
      await expect(preSend).toHaveCount(0);
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.headers.authorization).toBe(`Bearer ${TOKEN}`);
    },
  );

  test(
    tc(
      id('Var :: Add secret var masked'),
      'History keeps header names but hides secret values, and says so',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await seedEncryptedToken(app);

      const path = '/anything/history-hides-secrets';
      await sidebar.createRequest('hist-secret');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app
        .getByRole('tab', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('Authorization');
      await app.getByLabel('Headers value 1').fill('Bearer {{ADMIN_TOKEN}}');
      await app.keyboard.press('Escape');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      await app.getByRole('button', { name: /^History$/ }).click();
      await app.getByRole('button', { name: 'hist-secret run details' }).first().click();
      await expect(app.getByRole('note').filter({ hasText: 'Secrets were hidden' })).toHaveText(
        'Secrets were hidden before this run was saved: each value shown as hidden held one. Header names are kept.',
      );
      await expect(app.getByText('Authorization', { exact: true }).first()).toBeVisible();
      await expect(app.getByText('hidden', { exact: true }).first()).toBeVisible();

      // What is stored — the copy IndexedDB and the disk mirror get — holds
      // neither the token nor the echo of it in the response body.
      const stored = await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore: { getState: () => { local: { history: unknown } | null } };
        };
        return JSON.stringify(w.__apicircleStore.getState().local?.history ?? null);
      });
      expect(stored).toContain('history-hides-secrets');
      expect(stored).not.toContain(TOKEN);
    },
  );
});
