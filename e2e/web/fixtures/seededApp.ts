// Sister fixture to `./app.ts` that pre-seeds the page's IndexedDB
// with a named workspace variant before the app hydrates. Tests opt in
// per-file:
//
//   import { test, expect } from './fixtures/seededApp';
//   test.use({ workspaceVariant: 'seeded' });
//   test('does X with a populated workspace', async ({ app }) => { ... });
//
// The default variant is `'empty'` so the fixture is safe to import in
// specs that don't need seeded state — behaviour matches the plain
// `./app` fixture's empty-IDB start.

import { expect, test as base, type Page } from '@playwright/test';
import { test as appTest } from './app';
import { seedAndOpen, type WorkspaceVariant } from './idbSeed';

interface SeededFixtures {
  /** Workspace variant to seed before navigating to `/`. */
  workspaceVariant: WorkspaceVariant;
  /** Pre-hydrated page with the seeded workspace already active. */
  app: Page;
}

// Re-extend the base app fixture so all `mockApi`, `sidebar`, `monaco`,
// `e2eMock` helpers stay available — only the `app` page-boot flow
// changes to seed first.
export const test = appTest.extend<SeededFixtures>({
  workspaceVariant: ['empty', { option: true }],
  app: async ({ page, workspaceVariant }, use) => {
    await seedAndOpen(page, workspaceVariant);
    // Same brand-visible gate as the plain app fixture so callers can't
    // race the hydration finishing.
    await expect(page.getByText('API Circle Studio', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await use(page);
  },
});

export { expect };
export { base };
