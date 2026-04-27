import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/app';

// Plan §7.5.2 — axe-core a11y check on every panel; zero WCAG 2.1 AA
// violations is a release gate. Disabled rules: `region` (the test page
// is the whole app shell, not a single landmark per WCAG region rules)
// and `color-contrast` (driven by Tailwind theme tokens — exercised
// across all 6 themes in a separate visual review, not per-panel here).

const TABS = [
  'Workspace',
  'Link Workspace',
  'Editor',
  'Environments',
  'Execution',
  'History',
  'Help Center',
];

test.describe('a11y sweep', () => {
  for (const tab of TABS) {
    test(`${tab} panel has zero WCAG 2.1 AA violations`, async ({ app }) => {
      await app.getByRole('button', { name: new RegExp(`^${tab}$`) }).click();
      const results = await new AxeBuilder({ page: app })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .disableRules(['region', 'color-contrast'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('Secret Vault modal has zero WCAG 2.1 AA violations', async ({ app }) => {
    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await expect(app.getByRole('dialog', { name: /Secret Vault/ })).toBeVisible();
    const results = await new AxeBuilder({ page: app })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['region', 'color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('Publish release modal has zero WCAG 2.1 AA violations', async ({ app }) => {
    await app.getByRole('button', { name: /^Workspace$/ }).click();
    await app.getByRole('button', { name: /Publish release/ }).click();
    await expect(app.getByRole('dialog', { name: /Publish release/ })).toBeVisible();
    const results = await new AxeBuilder({ page: app })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['region', 'color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('Link a private workspace modal has zero WCAG 2.1 AA violations', async ({ app }) => {
    // Need a session to expose the link form — stub the verify call.
    await app.route('https://api.github.com/user', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'x-oauth-scopes',
          'x-oauth-scopes': 'repo, pull_request',
        },
        body: JSON.stringify({ login: 'me', id: 1 }),
      });
    });
    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await app.getByRole('button', { name: /Sessions/ }).click();
    await app.getByLabel('GitHub PAT').fill('tok');
    await app.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(app.getByText(/Connected as me/)).toBeVisible();
    await app.keyboard.press('Escape');

    await app.getByRole('button', { name: /Link Workspace/ }).click();
    await app.getByRole('button', { name: /Link a private workspace/ }).click();
    await expect(app.getByRole('dialog', { name: /Link a private workspace/ })).toBeVisible();
    const results = await new AxeBuilder({ page: app })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['region', 'color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
