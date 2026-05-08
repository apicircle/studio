import { expect, test } from './fixtures/app';

// Phase 2 sanity: the Monaco wheel-consume setting toggles in Settings
// and propagates to the editor instance's runtime options. Doesn't try to
// simulate a real wheel interaction in the editor — that's flaky in
// headless browsers — instead verifies the editor's `getRawOptions` flips.

test.describe('Monaco scroll setting', () => {
  test('toggles via Settings popover', async ({ app, sidebar }) => {
    // Default is `false` (page-scroll friendly). Read the editor option
    // through the test registry the editor exposes on `window`.
    await sidebar.createRequest('Scroll test');
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'JSON' }).click();
    // Wait for the body editor to register itself.
    await expect
      .poll(async () => {
        return await app.evaluate(() => {
          const reg = (window as unknown as { __apicircleEditors?: Map<string, unknown> })
            .__apicircleEditors;
          return reg ? reg.size > 0 : false;
        });
      })
      .toBeTruthy();

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
    await app.getByLabel('Monaco consumes mouse wheel').click();
    await app.keyboard.press('Escape');

    // Allow Monaco to apply the new options.
    await expect.poll(optionValue).toBe(true);
  });
});
