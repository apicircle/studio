// Fixture for multi-tab / multi-context tests. The web app lives in a
// single origin (http://localhost:5174) so two tabs in the SAME browser
// context share IndexedDB, localStorage, cookies, and BroadcastChannel.
// That's the "two tabs of the same user" model — covered by `twoTabs`
// below.
//
// For the "two devs on two devices" model we need two SEPARATE
// BrowserContexts (separate cookie jars, separate IDB). Each context's
// IDB is per-origin-per-context, so workspace edits do NOT bleed
// across contexts — useful for asserting push/pull conflict flows.
// That's `twoContexts`.

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

interface TwoTabsFixture {
  /**
   * Two pages in the SAME browser context. They share IndexedDB,
   * localStorage, and BroadcastChannel. Use this for "multi-tab on
   * same device" cases.
   */
  twoTabs: { tabA: Page; tabB: Page };

  /**
   * Two pages in SEPARATE browser contexts (different cookies, IDB).
   * Use this for "two devs on two devices" cases that exercise
   * cross-device push/pull conflict resolution.
   */
  twoContexts: { ctxA: BrowserContext; ctxB: BrowserContext; pageA: Page; pageB: Page };
}

export const test = base.extend<TwoTabsFixture>({
  twoTabs: async ({ context, page }, use) => {
    // Reuse the already-open `page` as tab A so the default app fixture
    // can also build on top of it; tab B is a fresh page in the same
    // context.
    const tabA = page;
    await tabA.goto('/');
    await expect(tabA.getByText('API Circle Studio', { exact: true })).toBeVisible();

    const tabB = await context.newPage();
    await tabB.goto('/');
    await expect(tabB.getByText('API Circle Studio', { exact: true })).toBeVisible();

    await use({ tabA, tabB });

    // Tab B is owned by the fixture; close it on teardown so the
    // worker's page count stays predictable. Guard against tests that
    // close tabB themselves (e.g. the TC-WB-0003 tab-close spec) so
    // the fixture stays idempotent.
    if (!tabB.isClosed()) {
      await tabB.close();
    }
  },

  twoContexts: async ({ browser }, use) => {
    const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const ctxB = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await pageA.goto('/');
    await pageB.goto('/');
    await expect(pageA.getByText('API Circle Studio', { exact: true })).toBeVisible();
    await expect(pageB.getByText('API Circle Studio', { exact: true })).toBeVisible();

    await use({ ctxA, ctxB, pageA, pageB });

    await ctxA.close();
    await ctxB.close();
  },
});

export { expect } from '@playwright/test';
