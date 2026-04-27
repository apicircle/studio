import { expect, test } from './fixtures/app';

// Plan §7.5.4 P7: Help Center search works, theme switch persists across
// reload (golden path #5 from §10.2). Local-only flows.

test.describe('Help Center (P7)', () => {
  test('renders sections by default and filters via search', async ({ app }) => {
    await app.getByRole('button', { name: /^Help Center$/ }).click();
    await expect(app.getByRole('heading', { level: 2, name: 'Welcome' })).toBeVisible();
    await expect(app.getByRole('heading', { level: 2, name: 'Keyboard Shortcuts' })).toBeVisible();

    const search = app.getByLabel('Search help');
    await search.fill('yank');
    await expect(app.getByRole('heading', { level: 2, name: 'Release Management' })).toBeVisible();
    // Welcome shouldn't match "yank" — should be hidden.
    await expect(app.getByRole('heading', { level: 2, name: 'Welcome' })).not.toBeVisible();

    // Empty query restores everything.
    await search.fill('');
    await expect(app.getByRole('heading', { level: 2, name: 'Welcome' })).toBeVisible();
  });

  test('search with no matches shows empty state', async ({ app }) => {
    await app.getByRole('button', { name: /^Help Center$/ }).click();
    await app.getByLabel('Search help').fill('zzz-no-such-thing-zzz');
    await expect(app.getByText('No matching sections.')).toBeVisible();
  });
});

test.describe('Theme persistence (P7)', () => {
  test('selected theme survives a full reload', async ({ app }) => {
    // The default theme is studio-dark. Switch to paper-light, reload,
    // and confirm the html data-theme attribute reflects the choice.
    const initialTheme = await app.locator('html').getAttribute('data-theme');
    expect(initialTheme).toBe('studio-dark');

    await app.getByLabel('Theme').click();
    await app.getByRole('option', { name: /Paper Light/ }).click();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'paper-light');

    await app.reload();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'paper-light');
  });
});
