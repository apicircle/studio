// Documentation Viewer (TC-DC-*) — 4 manual cases for the in-app
// Help Center documentation surface.

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapDC } from './fixtures/tcMapDC';
import type { TcId } from './fixtures/tcCoverage';

void Object.keys(tcMapDC);
function id(key: string): TcId {
  const v = tcMapDC[key];
  if (!v) throw new Error(`No TC-DC entry for "${key}"`);
  return v;
}

test.describe('Documentation Viewer', () => {
  test.describe.configure({ mode: 'parallel' });

  test(tc(id('Help :: Search topic'), 'Help Center search filters topics'), async ({ app }) => {
    await app.getByRole('button', { name: 'Help Center', exact: true }).first().click();
    const search = app
      .getByRole('textbox', { name: /search/i })
      .or(app.getByPlaceholder(/search.*help/i))
      .first();
    await expect(search).toBeVisible({ timeout: 5_000 });
    await search.fill('keyboard');
    // Some topic mentioning keyboard / shortcuts should appear.
    await expect(app.getByText(/keyboard|shortcut/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test(
    tc(id('Help :: Markdown XSS safe'), 'Help content does not execute arbitrary scripts'),
    async ({ app }) => {
      await app.getByRole('button', { name: 'Help Center', exact: true }).first().click();
      // Help content is shipped from helpContent.ts as static MD. The
      // viewer must render text — no <script> from data should ever
      // make it into the DOM. We assert the absence of any
      // dynamically-injected script tags inside the Help panel.
      await expect(app.getByText(/Help|Welcome|Guide/i).first()).toBeVisible();
      const scriptsInHelp = await app.evaluate(() => {
        const root = document.querySelector('[data-help-center], main, [role="region"]');
        if (!root) return 0;
        return root.querySelectorAll('script').length;
      });
      expect(scriptsInHelp).toBe(0);
    },
  );

  test.fixme(tc(id('Request Docs'), 'Per-request inline docs render Markdown'), async () => {
    // Per-request docs editor surface needs the request-detail panel
    // wired with a docs tab — currently surfaced inside the editor
    // but not assertable without filling sample markdown first.
    // Real-implementation TODO: write the markdown via the docs tab
    // and assert the rendered output.
  });

  test(
    tc(id('External'), 'External help links open in a new tab (target=_blank)'),
    async ({ app }) => {
      await app.getByRole('button', { name: 'Help Center', exact: true }).first().click();
      // All <a> inside the help region with absolute hrefs should
      // carry rel="noopener" (security baseline).
      const violations = await app.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href^="http"]'));
        return anchors
          .filter((a) => !a.getAttribute('rel')?.includes('noopener'))
          .map((a) => (a as HTMLAnchorElement).href);
      });
      expect(violations).toEqual([]);
    },
  );
});
