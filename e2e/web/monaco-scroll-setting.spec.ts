import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module ST.
import { tcMapST } from './fixtures/tcMapST';
void Object.keys(tcMapST);

function id(key: string): TcId {
  const v = tcMapST[key];
  if (!v) throw new Error(`No TC-ST entry for "${key}"`);
  return v;
}
// Phase 2 sanity: the Monaco wheel-consume setting toggles in Settings
// and propagates to the editor instance's runtime options. Doesn't try to
// simulate a real wheel interaction in the editor — that's flaky in
// headless browsers — instead verifies the editor's `getRawOptions` flips.

test.describe('Monaco scroll setting', () => {
  test(tc(id('Browser Zoom'), 'toggles via Settings popover'), async ({ app, monaco, sidebar }) => {
    // Default is `false` (page-scroll friendly). Read the editor option
    // through the test registry the editor exposes on `window`.
    await sidebar.createRequest('Scroll test');
    await app.getByRole('tab', { name: 'Body', exact: true }).click();
    await app.getByRole('radio', { name: 'JSON' }).click();
    // Wait for the body editor to register itself. Use the shared
    // `monaco.ready` helper (15s timeout) — Monaco's lazy-import chain
    // routinely exceeds the default 5s `expect.poll` budget under
    // parallel-worker contention, even with the global-setup warmup.
    await monaco.ready('Request body');

    const optionValue = async () =>
      app.evaluate(() => {
        const reg = (
          window as unknown as {
            __apicircleEditors?: Map<
              string,
              { getRawOptions(): { scrollbar?: { alwaysConsumeMouseWheel?: boolean } } }
            >;
          }
        ).__apicircleEditors;
        if (!reg || reg.size === 0) return null;
        const inst = [...reg.values()][0];
        return inst.getRawOptions().scrollbar?.alwaysConsumeMouseWheel ?? null;
      });

    expect(await optionValue()).toBe(false);

    // Open Settings and flip the toggle.
    await app.getByLabel('Open workspace settings').click();
    await app.getByLabel('Code editor captures mouse wheel').click();
    await app.keyboard.press('Escape');

    // Allow Monaco to apply the new options. Bump past the 5s default —
    // store update → React re-render → @monaco-editor/react
    // `updateOptions` propagation can drift past 5s under load.
    await expect.poll(optionValue, { timeout: 15_000 }).toBe(true);
  });
});
