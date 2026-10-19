// Waits and feedback — the brand loader on Studio's waits, and the Studio
// items of the October 2026 UX pass (STU-UX-2/3/4/7/9/10/12/20 in API Circle
// Lens's docs/planning/ux-enhancements-2026-10.md):
//
//   - a send waits on the brand mark with a running time, and a re-send keeps
//     the last response up, dimmed, until the new one lands;
//   - a failed send says "No response" and shows the message itself first;
//   - an import says what it imported, an OpenAPI import shows it is busy,
//     and a file upload takes YAML;
//   - the editor with nothing open offers New request and Import…;
//   - a header rename to a taken name says so instead of reverting silently;
//   - a mock server's run controls sit at the top of its card;
//   - a running plan's Run button wears the loader;
//   - the screen after a failed load counts what is still saved.
//
// The primitives (BrandLoader, LoadingState, EmptyState, Button `loading`,
// ConfirmDialog busy) are unit-tested in packages/ui-components.

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';
import { buildSeed } from './fixtures/idbSeed';

async function noAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['region', 'color-contrast'])
    .analyze();
  expect(results.violations).toEqual([]);
}

const PETSTORE_YAML = [
  'openapi: 3.0.0',
  'info:',
  '  title: Petstore',
  '  version: "1.0"',
  'paths:',
  '  /pets:',
  '    get:',
  '      responses:',
  '        "200":',
  '          description: ok',
  '    post:',
  '      responses:',
  '        "201":',
  '          description: created',
].join('\n');

async function openImport(app: Page): Promise<void> {
  await app.getByRole('button', { name: 'Editor actions', exact: true }).first().click();
  await app.getByRole('menuitem', { name: 'Import', exact: true }).click();
  // The dialog is a lazy chunk: the dev server compiles it on first use, which
  // under a parallel run takes longer than the default 5s.
  await expect(app.getByRole('dialog', { name: 'Import' })).toBeVisible({ timeout: 15_000 });
}

test.describe('Waiting on a response', () => {
  test('the first send waits on the brand mark with a running time', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await sidebar.createRequest('slow first send');
    await app.getByLabel('Request URL').fill(e2eMock.url('/delay/2500'));
    await app.getByRole('button', { name: /^Send$/ }).click();

    await expect(app.getByRole('status').filter({ hasText: 'Sending request…' })).toBeVisible();
    await expect(app.locator('svg[data-brand-loader="full"]')).toBeVisible();
    const elapsed = app.getByTestId('response-elapsed');
    await expect(elapsed).toHaveText(/^\d+\.\d s$/);
    // The clock moves while it waits.
    await expect(elapsed).not.toHaveText('0.0 s', { timeout: 2000 });
    await noAxeViolations(app);

    await expect(app.getByText(/^200\b/).first()).toBeVisible({ timeout: 10_000 });
    await expect(app.getByText('Sending request…')).toHaveCount(0);
  });

  test('a re-send keeps the last response up, dimmed, until the new one lands', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await sidebar.createRequest('re-send');
    await app.getByLabel('Request URL').fill(e2eMock.url('/delay/10'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200\b/).first()).toBeVisible();

    await app.getByLabel('Request URL').fill(e2eMock.url('/delay/2500'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(
      app.getByText('The last response stays here until the new one arrives.'),
    ).toBeVisible();
    const content = app.getByTestId('response-content');
    await expect(content).toHaveAttribute('aria-busy', 'true');
    await expect(content).toHaveClass(/opacity-50/);
    // The previous response is still there to read.
    await expect(content.getByText(/^200\b/)).toBeVisible();
    await noAxeViolations(app);

    await expect(app.getByTestId('response-content')).not.toHaveAttribute('aria-busy', 'true', {
      timeout: 10_000,
    });
    await expect(
      app.getByText('The last response stays here until the new one arrives.'),
    ).toHaveCount(0);
  });

  test('the response gets the larger share of the editor', async ({ app, e2eMock, sidebar }) => {
    await sidebar.createRequest('split');
    await app.getByLabel('Request URL').fill(e2eMock.url('/delay/10'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200\b/).first()).toBeVisible();
    const request = await app.locator('[data-panel-id="main"] [data-panel]').first().boundingBox();
    const response = await app.getByTestId('response-content').boundingBox();
    expect(request && response).toBeTruthy();
    expect(response!.height).toBeGreaterThan(request!.height * 0.9);
  });

  test('a failed send says "No response" and shows the message first', async ({ app, sidebar }) => {
    await sidebar.createRequest('unreachable');
    await app.getByLabel('Request URL').fill('http://this-cannot-resolve.invalid');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('No response', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(app.getByText('ERR', { exact: true })).toHaveCount(0);
    const alert = app.getByRole('alert').filter({ hasText: 'Network error' });
    // The browser's own words are on show, not folded away under Details.
    await expect(alert.getByText(/Failed to fetch/i)).toBeVisible();
    await expect(alert.getByText('Request details')).toBeVisible();
  });
});

test.describe('Importing', () => {
  test('an OpenAPI import says what it made, and the requests are there', async ({ app }) => {
    await openImport(app);
    await app.getByLabel('Import source').fill(PETSTORE_YAML);
    await expect(app.getByText(/Petstore · 2 operations \(OpenAPI 3\)/)).toBeVisible();
    await app.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(
      app.getByRole('status').filter({ hasText: 'Imported 2 requests from Petstore' }),
    ).toBeVisible();
    await expect(app.getByRole('dialog', { name: 'Import' })).toHaveCount(0);
    await expect(app.getByRole('treeitem', { name: /Petstore/ }).first()).toBeVisible();
  });

  test('a spec the web build cannot fully read still imports, with the notice', async ({ app }) => {
    await openImport(app);
    await app.getByLabel('Import source').fill(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'External refs', version: '1' },
        paths: {
          '/things': {
            get: {
              responses: {
                '200': {
                  description: 'ok',
                  content: {
                    'application/json': { schema: { $ref: 'https://example.test/s.json#/T' } },
                  },
                },
              },
            },
          },
        },
      }),
    );
    await app.getByRole('button', { name: 'Import', exact: true }).click();
    const toast = app
      .getByRole('status')
      .filter({ hasText: 'Imported 1 request from External refs' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/External \$ref/i);
  });

  test('a Postman collection import is confirmed too', async ({ app }) => {
    await openImport(app);
    await app.getByLabel('Import source').fill(
      JSON.stringify({
        info: {
          name: 'Postman pets',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [{ name: 'List', request: { method: 'GET', url: 'https://api.example.test/p' } }],
      }),
    );
    await app.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(
      app.getByRole('status').filter({ hasText: 'Imported 1 request from "Postman pets"' }),
    ).toBeVisible();
  });

  test('a file upload takes a YAML spec', async ({ app }) => {
    await openImport(app);
    const upload = app.getByLabel('Upload a file to import');
    await expect(upload).toHaveAttribute('accept', /\.yaml/);
    await expect(upload).toHaveAttribute('accept', /\.yml/);
    await upload.setInputFiles({
      name: 'petstore.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(PETSTORE_YAML),
    });
    await expect(app.getByText(/Petstore · 2 operations \(OpenAPI 3\)/)).toBeVisible();
    await expect(app.getByRole('button', { name: 'Upload file' })).toBeVisible();
  });
});

test.describe('The editor', () => {
  test('with nothing open, it offers New request and Import…', async ({ app }) => {
    await app.getByRole('button', { name: /^Request actions for Sample: GET \/anything/ }).click();
    await app.getByRole('menuitem', { name: 'Delete request' }).click();
    await app.getByRole('button', { name: 'Delete request' }).click();

    await expect(app.getByText('No request open')).toBeVisible();
    await noAxeViolations(app);
    await app.getByRole('button', { name: 'Import…' }).click();
    await expect(app.getByRole('dialog', { name: 'Import' })).toBeVisible();
    await app.getByRole('button', { name: 'Cancel' }).click();

    await app.getByRole('button', { name: 'New request', exact: true }).click();
    await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('New request');
  });

  test('renaming to a name the folder already has says so', async ({ app, sidebar }) => {
    await sidebar.createRequest('alpha');
    await sidebar.createRequest('beta');
    const name = app.getByLabel('Request name', { exact: true });
    await name.fill('Alpha');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(
      app
        .getByRole('alert')
        .filter({ hasText: 'A request named “Alpha” is already in this folder.' }),
    ).toBeVisible();
    await name.press('Tab');
    await expect(name).toHaveValue('beta');
    await expect(
      app.getByText('Kept “beta”: a request named “Alpha” is already in this folder.'),
    ).toBeVisible();
  });
});

test.describe('Mock servers', () => {
  test('the run controls sit at the top of the card', async ({ app }) => {
    await app.getByRole('button', { name: /^Mocks$/ }).click();
    await app.getByRole('button', { name: /Create your first mock server|New mock/i }).click();
    await app.getByLabel('Mock server name').fill('Top bar');
    await app.getByRole('button', { name: /Create mock server/i }).click();

    const bar = app.getByRole('group', { name: 'Mock server status' });
    await expect(bar).toContainText('Stopped');
    // The web build cannot listen on a port: Start is there, held back, with why.
    await expect(bar.getByRole('button', { name: 'Start' })).toBeDisabled();
    await expect(bar).toContainText('Needs the');
    const barBox = await bar.boundingBox();
    const portBox = await app.getByLabel('Default port').boundingBox();
    expect(barBox!.y).toBeLessThan(portBox!.y);
  });
});

test.describe('Running a plan', () => {
  test('the Run button wears the loader while the plan runs', async ({ app, e2eMock, sidebar }) => {
    await sidebar.createRequest('slow step');
    await app.getByLabel('Request URL').fill(e2eMock.url('/delay/2500'));
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore: {
          getState: () => {
            local: { ui: { activeRequestId: string | null } };
            addPlan: (name: string) => string;
            addPlanStep: (planId: string, requestId: string) => void;
            setActivePlanId: (id: string) => void;
          };
        };
      };
      const s = w.__apicircleStore.getState();
      const planId = s.addPlan('Slow plan');
      s.addPlanStep(planId, s.local.ui.activeRequestId!);
      s.setActivePlanId(planId);
    });
    await app.getByRole('button', { name: /^Execution$/ }).click();
    await app.getByRole('button', { name: 'Run', exact: true }).click();
    const running = app.getByRole('button', { name: 'Running…' });
    await expect(running).toHaveAttribute('aria-busy', 'true');
    await expect(running.locator('svg[data-brand-loader]')).toBeVisible();
    await expect(app.getByRole('button', { name: 'Run with assertions' })).toBeDisabled();
    await expect(app.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({
      timeout: 15_000,
    });
  });
});

test.describe('After a failed load', () => {
  test('the recovery screen counts what is still saved', async ({ page }) => {
    const seed = buildSeed('seeded');
    await page.goto('/oauth-callback.html');
    // The two records disagree on which workspace they belong to.
    await page.evaluate(
      async ({ synced, local, registry }) => {
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          const req = indexedDB.open('apicircle-workspace', 3);
          req.onupgradeneeded = () => {
            for (const s of ['synced', 'local', 'registry']) {
              if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['synced', 'local', 'registry'], 'readwrite');
          const id = (synced as { workspaceId: string }).workspaceId;
          tx.objectStore('synced').put(synced, id);
          tx.objectStore('local').put({ ...local, workspaceId: 'someone-else' }, id);
          tx.objectStore('registry').put(registry, 'meta');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      {
        synced: seed.synced as unknown as Record<string, unknown>,
        local: seed.local as unknown as Record<string, unknown>,
        registry: seed.registry,
      },
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Couldn’t load your workspace' })).toBeVisible();
    await expect(
      page.getByText('Collections and environments: saved — 2 requests, 2 environments'),
    ).toBeVisible();
    await expect(page.getByText('History, vault and settings: saved')).toBeVisible();
    await expect(page.getByText(/0 requests/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Recover existing data' })).toBeEnabled();
    await noAxeViolations(page);
  });
});
