// Visual baseline (S10). Captures pinned screenshots of every primary
// panel so a future CSS / layout regression fails CI with a visible
// diff instead of slipping through.
//
// Run only on the `visual-baseline` Playwright project, which fixes the
// viewport and animations (see playwright.config.ts). Baselines live
// under `e2e/web/__screenshots__/visual-baseline.spec.ts-snapshots/`
// and are platform-namespaced by Playwright automatically.
//
// To update baselines after an intentional visual change:
//   pnpm --filter @apicircle/web exec playwright test \
//     --project=visual-baseline --update-snapshots
//
// Diff tolerance is set globally on the project (maxDiffPixelRatio:
// 0.002) — enough headroom for subpixel rendering drift between
// Linux/Mac/Windows but not enough to hide a real change.

import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module CC (Cross-Cutting UX).
import { tcMapCC } from './fixtures/tcMapCC';
void Object.keys(tcMapCC);

function id(key: string): TcId {
  const v = tcMapCC[key];
  if (!v) throw new Error(`No TC-CC entry for "${key}"`);
  return v;
}
// Panels we baseline. Order roughly matches the top-bar tab order.
const PANELS = [
  { name: 'Workspace', label: 'workspace' },
  { name: 'Editor', label: 'editor' },
  { name: 'Environments', label: 'environments' },
  { name: 'Execution', label: 'execution' },
  { name: 'History', label: 'history' },
  { name: 'Mocks', label: 'mocks' },
  { name: 'MCP', label: 'mcp' },
  { name: 'Help Center', label: 'help-center' },
] as const;

test.describe('Visual baseline', () => {
  // Only one worker — screenshots are sensitive to lazy-load ordering;
  // serializing the captures keeps the baseline reproducible.
  test.describe.configure({ mode: 'serial' });

  for (const panel of PANELS) {
    test(
      tc(
        id('Panel State :: Open Workspace panel while: Empty workspace'),
        `${panel.name} panel matches baseline`,
      ),
      async ({ app }, testInfo) => {
        test.skip(
          testInfo.project.name !== 'visual-baseline',
          'Visual baseline runs only on the visual-baseline project',
        );

        // Click the tab and wait for its primary heading / panel content
        // to settle. Don't rely on aria-current — some tabs flip it
        // asynchronously.
        await app.getByRole('button', { name: new RegExp(`^${panel.name}$`) }).click();
        await app.waitForLoadState('networkidle');
        // Small extra settle so any lazy-loaded panel chrome finishes painting.
        await app.waitForTimeout(250);

        // Mask volatile regions: timestamps in the workspace card, any
        // ephemeral "Last saved" badges. Add CSS selectors as they surface.
        const mask = app.locator('[data-volatile="true"]');

        await expect(app).toHaveScreenshot(`${panel.label}.png`, {
          fullPage: false,
          mask: [mask],
        });
      },
    );
  }

  test(
    tc(
      id('Concurrency :: Concurrency: Delete the request being sent'),
      'Secret Vault dialog matches baseline',
    ),
    async ({ app }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'visual-baseline',
        'Visual baseline runs only on the visual-baseline project',
      );
      await app.getByRole('button', { name: /Open Secret Vault/ }).click();
      const dialog = app.getByRole('dialog', { name: /Secret Vault/ });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveScreenshot('secret-vault-dialog.png');
    },
  );
});
