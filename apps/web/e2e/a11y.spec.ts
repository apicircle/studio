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
  'Mocks',
  'MCP',
  'Help Center',
];

// Editor inner tabs — exercised against a freshly-created request so the
// editor surface is in its post-creation state (request name + URL +
// method + tab strip rendered). Catches violations that only show up
// once a request is selected (e.g. labels missing on dynamically
// rendered tab content).
const EDITOR_TABS = ['Params', 'Headers', 'Auth', 'Body', 'Context', 'Assertions'];

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

  for (const tab of EDITOR_TABS) {
    test(`Editor → ${tab} tab has zero WCAG 2.1 AA violations`, async ({ app, sidebar }) => {
      // Editor is the default panel — create a request so the editor
      // surface is fully rendered, then click the inner tab. The Body
      // tab name collides with the response viewer's body tab post-Send,
      // but pre-Send only the editor tab strip is rendered.
      await sidebar.createRequest(`a11y-${tab.toLowerCase()}`);
      // exact:true disambiguates inner tabs from the response viewer's
      // tab strip; auth's accessible name is "Auth · Inherit" (or the
      // current scheme), so we match it loosely instead.
      const tabButton =
        tab === 'Auth'
          ? app.getByRole('button', { name: /^Auth(\s·\s|$)/ }).first()
          : app.getByRole('button', { name: tab, exact: true }).first();
      await tabButton.click();
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
