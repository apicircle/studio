// The workspace cap, seen from the workspace that is open.
//
// The open workspace always keeps working; the cap locks the others. A
// workspace can be open while the plain oldest-first order would put it past
// the cap — a Studio from before the cap left a newer workspace open, an
// edition's plan came down, an edition's account is still loading, or deleting
// the open workspace handed "active" to a newer one — and the shell must not
// lock the user out of what is on screen or move them somewhere else. These
// cells pin that. The rule itself is unit-tested in
// packages/ui-components/src/layout/workspaceAccess.test.ts; the switcher's
// lock rows are covered in "Workspace management — workspace cap"
// (workspace-management.spec.ts).

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';
import { seedWorkspacesAndOpen } from './fixtures/idbSeed';

async function openSwitcher(app: Page): Promise<void> {
  const listbox = app.getByRole('listbox', { name: 'Workspaces' });
  if (await listbox.isVisible()) return;
  await app.getByRole('button', { name: /^Switch workspace/ }).click();
  await expect(listbox).toBeVisible();
}

async function closeSwitcher(app: Page): Promise<void> {
  await app.getByRole('button', { name: /^Switch workspace/ }).click();
  await expect(app.getByRole('listbox', { name: 'Workspaces' })).toBeHidden();
}

/** The switcher row for the open workspace: unlocked, selected, badged active. */
async function expectOpenRow(app: Page, name: string): Promise<void> {
  const row = app.getByRole('option', { name: `Switch to ${name}`, exact: true });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(row).toContainText('active');
}

test.describe('Workspace cap — the open workspace', () => {
  test.describe.configure({ mode: 'parallel' });

  test('free tier: the open workspace keeps working and the cap locks the others', async ({
    app,
    sidebar,
  }) => {
    // Beta, the newer workspace, was open when a build with a higher cap last
    // ran. The plain oldest-first order would give the one free slot to Alpha.
    await seedWorkspacesAndOpen(app, ['Alpha', 'Beta'], { active: 'Beta' });
    await expect(
      app.getByRole('button', { name: 'Switch workspace (current: Beta)' }),
    ).toBeVisible();
    await openSwitcher(app);
    await expectOpenRow(app, 'Beta');
    await expect(app.getByRole('option', { name: 'Alpha (locked)' })).toBeVisible();
    // Nothing destructive on the locked row, and no room for another.
    await expect(app.getByRole('button', { name: /^Delete Alpha\b/ })).toHaveCount(0);
    await expect(
      app.getByRole('button', { name: 'New workspace (locked)', exact: true }),
    ).toBeVisible();

    // Picking the locked one explains the lock and stays on Beta.
    await app.getByRole('option', { name: 'Alpha (locked)' }).click();
    await expect(app.getByRole('dialog', { name: 'Workspace locked' })).toContainText(
      'Nothing has been deleted',
    );
    await app.keyboard.press('Escape');
    await expect(app.getByRole('dialog', { name: 'Workspace locked' })).toBeHidden();
    await expect(
      app.getByRole('button', { name: 'Switch workspace (current: Beta)' }),
    ).toBeVisible();

    // And Beta is fully usable.
    await sidebar.createRequest('beta-request');
  });

  test('free tier: deleting the open workspace leaves the one that opens next unlocked', async ({
    app,
  }) => {
    // Alpha, the oldest, is open. Gamma was opened more recently than Beta,
    // so deleting Alpha opens Gamma.
    await seedWorkspacesAndOpen(app, ['Alpha', 'Beta', 'Gamma']);
    await openSwitcher(app);
    await app.getByRole('button', { name: 'Delete Alpha', exact: true }).click();
    await app.getByRole('button', { name: 'Delete workspace', exact: true }).click();

    await expect(
      app.getByRole('button', { name: 'Switch workspace (current: Gamma)' }),
    ).toBeVisible();
    await openSwitcher(app);
    await expectOpenRow(app, 'Gamma');
    await expect(app.getByRole('option', { name: 'Beta (locked)' })).toBeVisible();
    await closeSwitcher(app);
    await expect(app.getByRole('button', { name: 'Editor actions', exact: true })).toBeVisible();
  });

  test.describe('an edition cap of two', () => {
    test.use({ maxWorkspaces: 2 });

    test('the open workspace takes one slot, the oldest of the rest the other; leaving it locks it', async ({
      app,
    }) => {
      // Gamma, the newest, is open: it keeps its slot, and the second goes to
      // the oldest of the others, Alpha.
      await seedWorkspacesAndOpen(app, ['Alpha', 'Beta', 'Gamma'], { active: 'Gamma' });
      await openSwitcher(app);
      await expectOpenRow(app, 'Gamma');
      await expect(app.getByRole('option', { name: 'Switch to Alpha', exact: true })).toBeVisible();
      await expect(app.getByRole('option', { name: 'Beta (locked)' })).toBeVisible();

      // Leaving Gamma for Alpha puts the open workspace inside the oldest two,
      // so Gamma, now past the cap, locks — and Beta unlocks.
      await app.getByRole('option', { name: 'Switch to Alpha', exact: true }).click();
      await expect(
        app.getByRole('button', { name: 'Switch workspace (current: Alpha)' }),
      ).toBeVisible();
      await openSwitcher(app);
      await expectOpenRow(app, 'Alpha');
      await expect(app.getByRole('option', { name: 'Switch to Beta', exact: true })).toBeVisible();
      await expect(app.getByRole('option', { name: 'Gamma (locked)' })).toBeVisible();
    });
  });
});
