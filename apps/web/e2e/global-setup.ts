// Cycle 13 — globalSetup. Pre-warms the Vite dev server's lazy module
// graph so the first OAuth2 popup test in the batch doesn't pay for
// the cold-start compile within its 30s waitForEvent('close') window.
//
// Without this, the auth-code popup test was held back at skip — the
// dev server's first request transforms ~80 modules including Monaco's
// lazy-imported language workers and the IDB storage shim, which can
// take 8-15s on a cold cache. That shortened the popup choreography
// window to ~15s, which races BroadcastChannel + window.close on
// Chromium headless.
//
// What this does:
//   1. Boots a single chromium browser
//   2. Navigates to BASE_URL — triggers root component compile + hydrate
//   3. Waits for the brand text to confirm hydration completed
//   4. Triggers Monaco's lazy import by clicking through to a body-tab
//      JSON view — the same path the popup spec exercises later
//   5. Tears down. The dev server's module cache stays warm for the
//      remainder of the suite.

import { chromium, type FullConfig } from '@playwright/test';

const BASE_URL = 'http://localhost:5174';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    // Brand text appears once the workspace has hydrated from IDB.
    await page
      .getByText('API Circle Studio', { exact: true })
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Trigger Monaco's lazy import. The Editor's Body tab → JSON radio
    // mounts MonacoEditorBase, which dynamically imports the
    // monaco-editor bundle. This warms the lazy chunk so subsequent
    // tests don't pay for the import.
    try {
      await page.getByLabel('New request', { exact: true }).first().click({ timeout: 5_000 });
      await page.getByLabel('Inline rename request').fill('warmup');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Body', exact: true }).click({ timeout: 5_000 });
      await page.getByRole('radio', { name: 'JSON' }).click({ timeout: 5_000 });
      // Wait briefly for the editor to register; if it doesn't we don't
      // fail the run — the warmup is best-effort.
      await page
        .locator('[data-testid="monaco-editor"]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      // Best-effort. If the warmup paths drift (e.g. Body tab renamed),
      // the test suite will still surface the actual breakage; we just
      // don't get the warm-cache benefit on this run.
    }
  } finally {
    await browser.close();
  }
}
