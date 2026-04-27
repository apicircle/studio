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
});
