import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapAL } from './fixtures/tcMapAL';
import type { TcId } from './fixtures/tcCoverage';

void tcMapAL;

function alId(key: string): TcId {
  const v = tcMapAL[key];
  if (!v) throw new Error(`No TC-AL entry for "${key}"`);
  return v;
}

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
    test(`${tab} panel has zero WCAG 2.1 AA violations${tab === 'Editor' ? ' @smoke' : ''}`, async ({
      app,
    }) => {
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
          ? app.getByRole('tab', { name: /^Auth(\s·\s|$)/ }).first()
          : app.getByRole('button', { name: tab, exact: true }).first();
      await tabButton.click();
      const results = await new AxeBuilder({ page: app })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .disableRules(['region', 'color-contrast'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('Secret Vault dock has zero WCAG 2.1 AA violations', async ({ app }) => {
    // The Secret Vault now opens in the right-side dock (an `aside` with
    // role="complementary"), not a modal — see layout/RightDock.tsx.
    // The rail button opens the dock with the Vault tab selected.
    await app.getByRole('button', { name: /Open Secret Vault/ }).click();
    await expect(app.getByRole('complementary', { name: 'Workspace inspector' })).toBeVisible();
    await expect(app.getByRole('tab', { name: 'Vault' })).toHaveAttribute('aria-selected', 'true');
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

// ===========================================================================
// AL module — assert the 8 manual-workbook A11y rows. Most are now
// covered by axe directly (failures surface as violations in the sweep
// above). The remaining rows are auxiliary checks we can assert in
// isolation: Reduced Motion, Color Independence, Contrast (which we
// turn OFF in the main sweep but verify on a sampled surface here),
// Screen Reader (assertion: every interactive control has an
// accessible name).
// ===========================================================================

test.describe('A11y — workbook AL rows', () => {
  test(tc(alId('Tab Order'), 'tab traversal lands on a focusable control'), async ({ app }) => {
    await app.keyboard.press('Tab');
    const firstFocused = await app.evaluate(() => document.activeElement?.tagName ?? '');
    expect(firstFocused).not.toBe('BODY');
    expect(firstFocused).not.toBe('');
  });

  test(tc(alId('Focus Ring'), 'focused button shows a focus outline or ring'), async ({ app }) => {
    const workspaceBtn = app.getByRole('button', { name: /^Workspace$/ });
    await workspaceBtn.focus();
    const outline = await workspaceBtn.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        outline: s.outline,
        outlineWidth: s.outlineWidth,
        boxShadow: s.boxShadow,
      };
    });
    const hasOutline = outline.outlineWidth !== '0px' && outline.outline !== 'none';
    const hasShadowRing = outline.boxShadow !== 'none' && outline.boxShadow.length > 0;
    expect(hasOutline || hasShadowRing).toBe(true);
  });

  test(
    tc(alId('Screen Reader'), 'every interactive control on the editor has an accessible name'),
    async ({ app, sidebar }) => {
      await sidebar.createRequest('sr-check');
      const unnamed = await app.evaluate(() => {
        const els = document.querySelectorAll(
          'button:not([aria-hidden="true"]), [role="button"]:not([aria-hidden="true"]), [role="tab"]:not([aria-hidden="true"]), [role="menuitem"]:not([aria-hidden="true"])',
        );
        let count = 0;
        for (const el of Array.from(els)) {
          const name =
            el.getAttribute('aria-label') ??
            el.getAttribute('aria-labelledby') ??
            (el.textContent ?? '').trim();
          if (!name || name.length === 0) count++;
        }
        return count;
      });
      expect(unnamed).toBe(0);
    },
  );

  test(
    tc(alId('Color Independence'), 'tab state has a non-colour signal'),
    async ({ app, sidebar }) => {
      await sidebar.createRequest('ci-check');
      const tab = app.getByRole('tab', { name: 'Params', exact: true }).first();
      await tab.click();
      const ariaSel = await tab.getAttribute('aria-selected');
      const dataState = await tab.getAttribute('data-state');
      const ariaCurrent = await tab.getAttribute('aria-current');
      const className = (await tab.getAttribute('class')) ?? '';
      // The editor tab strip is a real ARIA tablist (packages/ui-components/
      // src/primitives/Tabs.tsx) — the active tab carries aria-selected="true",
      // a valid WCAG non-colour signal (aria-current/data-state kept as fallbacks).
      const hasNonColourSignal =
        ariaSel === 'true' ||
        dataState === 'active' ||
        ariaCurrent === 'page' ||
        /active|selected/i.test(className);
      expect(hasNonColourSignal).toBe(true);
    },
  );

  test(
    tc(alId('Reduced Motion'), 'prefers-reduced-motion: reduce loads without long animations'),
    async ({ app }) => {
      await app.emulateMedia({ reducedMotion: 'reduce' });
      await app.reload();
      await expect(app.getByText('API Circle Studio', { exact: true })).toBeVisible();
      const longAnim = await app.evaluate(() => {
        const sidebar = document.querySelector('[role="navigation"]') ?? document.body;
        const cs = getComputedStyle(sidebar);
        const dur = cs.transitionDuration || '0s';
        const num = parseFloat(dur);
        return Number.isFinite(num) ? num : 0;
      });
      expect(longAnim).toBeLessThanOrEqual(0.5);
    },
  );

  test(tc(alId('Keyboard Only'), 'sidebar is operable from keyboard alone'), async ({ app }) => {
    const workspaceBtn = app.getByRole('button', { name: /^Workspace$/ });
    await workspaceBtn.focus();
    await app.keyboard.press('Enter');
    const results = await new AxeBuilder({ page: app })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['region', 'color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test(tc(alId('ARIA'), 'no ARIA-misuse violations on the entry surface'), async ({ app }) => {
    const results = await new AxeBuilder({ page: app }).withTags(['cat.aria']).analyze();
    expect(results.violations).toEqual([]);
  });

  test(
    tc(alId('Contrast'), 'core text on the primary surface meets WCAG AA contrast'),
    async ({ app }) => {
      // The main sweep disables `color-contrast` because theme tokens
      // are exercised separately. Here we run it ONLY for the default
      // theme surface — the most-trafficked colour pair. If/when a
      // designer iterates on tokens, this assertion drives the
      // discussion — don't silence it without sign-off.
      const results = await new AxeBuilder({ page: app }).withRules(['color-contrast']).analyze();
      expect(results.violations).toEqual([]);
    },
  );
});
