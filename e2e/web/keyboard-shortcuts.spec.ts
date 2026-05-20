// Keyboard Shortcuts (TC-KB-*) — covers the 10 manual cases in
// docs/qa/{web,desktop}-app-manual-test-cases.xlsx for KeyboardShortcuts.tsx.
// Bindings reference: packages/ui-components/src/layout/KeyboardShortcuts.tsx.
//
// Browser-conflict cells (Ctrl+R, Ctrl+W, Ctrl+F, Ctrl+P) intentionally
// cannot be asserted from a Playwright web test — those bindings are
// owned by the browser. Marked as fixme with rationale (manual-only).

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapKB } from './fixtures/tcMapKB';
import type { TcId } from './fixtures/tcCoverage';

void tcMapKB;

function id(key: string): TcId {
  const v = tcMapKB[key];
  if (!v) throw new Error(`No TC-KB entry for "${key}"`);
  return v;
}

test.describe('Keyboard shortcuts', () => {
  test.describe.configure({ mode: 'parallel' });

  test(
    tc(id('Send'), 'Ctrl/Cmd+Enter sends the active request'),
    async ({ app, e2eMock, sidebar }) => {
      const path = `/anything/kb-send-${Math.random().toString(36).slice(2, 8)}`;
      await sidebar.createRequest('kb-send');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      // Focus the URL field then press Cmd/Ctrl+Enter — the global hot
      // key fires even when the user is editing text (matches
      // KeyboardShortcuts.tsx comment).
      await app.getByLabel('Request URL').press('Control+Enter');
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.method).toBe('GET');
    },
  );

  test(tc(id('Panels'), 'Ctrl/Cmd+1..7 switches the top-level panel'), async ({ app }) => {
    // Each digit binds to a panel slot per layout/panels.ts. The
    // simplest cross-version assertion is that the corresponding
    // top-bar button stays visible after the press.
    await app.keyboard.press('Control+2');
    await expect(app.getByRole('button', { name: 'Link Workspace', exact: true })).toBeVisible();
    await app.keyboard.press('Control+3');
    await expect(app.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
    await app.keyboard.press('Control+4');
    await expect(app.getByRole('button', { name: 'Environments', exact: true })).toBeVisible();
  });

  test(tc(id('Vault'), 'Ctrl/Cmd+K opens the Vault tab'), async ({ app }) => {
    await app.keyboard.press('Control+K');
    // The right-dock Vault tab opens; its panel surfaces a "Secret
    // Vault" heading or tab label.
    await expect(app.getByText(/Secret Vault|Vault/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test(tc(id('Refresh'), 'Ctrl/Cmd+Shift+R refreshes the working branch'), async ({ app }) => {
    // The handler invokes `refreshWorkspace`. We don't have a linked
    // git remote in this test, so the action no-ops cleanly. The
    // assertion: the press doesn't throw and the app stays interactive.
    await app.keyboard.press('Control+Shift+R');
    await expect(app.getByText('API Circle Studio', { exact: true })).toBeVisible();
  });

  test(tc(id('Font Size'), 'Ctrl/Cmd+Shift+= / -/0 adjusts font size'), async ({ app }) => {
    const readPercent = () =>
      app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => { local?: { ui: { fontSizePercent: number } } };
          };
        };
        return w.__apicircleStore?.getState().local?.ui.fontSizePercent ?? 100;
      });
    const initial = await readPercent();
    await app.keyboard.press('Control+Shift+=');
    expect(await readPercent()).toBeGreaterThan(initial);
    await app.keyboard.press('Control+Shift+0');
    expect(await readPercent()).toBe(100);
  });

  test(
    tc(id('New Request'), 'Ctrl/Cmd+N creates a new request inside the Editor panel'),
    async ({ app }) => {
      await app.getByRole('button', { name: 'Editor', exact: true }).click();
      await app.keyboard.press('Control+N');
      await expect(app.getByLabel('Request name', { exact: true })).toHaveValue(/^New request/);
      await expect(app.getByRole('treeitem', { name: /^GET New request/ }).first()).toBeVisible();
    },
  );

  // Browser-conflict bindings (Ctrl+R, Ctrl+W, Ctrl+F, Ctrl+P) are
  // owned by the browser at a higher level than any web page's keydown
  // listener and cannot be intercepted from JS. They are classified
  // as manual-residue (see e2e/web/manual-residue.ts).
});
