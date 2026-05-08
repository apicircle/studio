import { expect, test } from './fixtures/app';

// Phase 3 sanity: the kebab menu primitive opens, navigates by keyboard,
// and closes on Escape. Exercises the editor sidebar request row since
// that's the densest application of the menu.

test.describe('Kebab menu', () => {
  test('opens with click, exposes expected actions, closes on Escape', async ({ app, sidebar }) => {
    await sidebar.createRequest('My request');
    const trigger = app.getByLabel('Request actions for My request');
    await trigger.click();
    const menu = app.getByRole('menu', { name: 'Request actions for My request' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete request' })).toBeVisible();
    await app.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('initial focus lands on the first enabled item', async ({ app, sidebar }) => {
    // Keyboard navigation (ArrowDown / Up) is covered by KebabMenu.test.tsx
    // unit tests — they're more reliable than headless-browser key timing.
    // The e2e check is just that focus moves into the menu when it opens
    // so screen-reader / keyboard users can pick up from there.
    await sidebar.createRequest('Focus check');
    await app.getByLabel('Request actions for Focus check').click();
    const menu = app.getByRole('menu', { name: 'Request actions for Focus check' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  });
});
