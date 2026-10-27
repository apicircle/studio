import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module JS ($ref resolution).
import { tcMapJS } from './fixtures/tcMapJS';

function id(key: string): TcId {
  const v = tcMapJS[key];
  if (!v) throw new Error(`No TC-JS entry for "${key}"`);
  return v;
}

// A spec split across files, end to end in the web app: upload it, see which
// files its `$ref`s want, supply them, and take the spec away as one file.
// Studio reads no file and fetches no URL for a reference — every document
// here reaches it as an upload.

const root = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Split pets', version: '1' },
  paths: {
    '/pets': { $ref: 'paths/pets.json' },
    '/health': { get: { responses: { '200': { description: 'ok' } } } },
  },
});
const pets = JSON.stringify({
  get: {
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { $ref: '../schemas/pet.json#/Pet' } } },
      },
    },
  },
});
const pet = JSON.stringify({
  Pet: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
});

const json = (name: string, text: string) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(text),
});

/** Dismiss the notices, which sit over the dock's lower half. Only the toast
 *  viewport's own Dismiss buttons: other panels have one too. */
async function dismissToasts(app: Page) {
  const toasts = app.locator('[aria-live="polite"].fixed');
  for (const close of await toasts.getByRole('button', { name: 'Dismiss' }).all()) {
    await close.click();
  }
}

/** Open the Assets dock on its Files tab and return the dock. */
async function openFiles(app: Page) {
  await app.getByRole('button', { name: 'Open Global Assets', exact: true }).click();
  const dock = app.getByRole('complementary', { name: 'Workspace inspector' });
  await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: /^Files/ }).click();
  return dock;
}

test.describe('A spec split across files', () => {
  test(
    tc(id('External $ref broken (asset missing)'), 'lists the files a spec points at, as missing'),
    async ({ app }) => {
      const dock = await openFiles(app);
      await dock.getByLabel('Global file asset').setInputFiles(json('openapi.json', root));
      await expect(app.getByText("This spec points to 1 file Studio doesn't have")).toBeVisible();
      await dismissToasts(app);

      const refs = dock.getByRole('region', { name: 'Referenced files' });
      await expect(refs.getByText(/^1 of 1 referenced file missing/)).toBeVisible();
      await expect(refs.getByText('paths/pets.json')).toBeVisible();
      await expect(refs.getByText('Missing', { exact: true })).toBeVisible();
      await expect(refs.getByRole('button', { name: 'Download one file' })).toBeDisabled();
      // One operation is readable; the other lives in the missing file.
      await expect(dock.getByText('OpenAPI 3 · 1 op')).toBeVisible();

      const results = await new AxeBuilder({ page: app })
        .include('[aria-label="Referenced files"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .disableRules(['region', 'color-contrast'])
        .analyze();
      expect(results.violations).toEqual([]);
    },
  );

  test(
    tc(
      id('External $ref to file'),
      'supplies the files, reads the whole spec, and hands it over as one file',
    ),
    async ({ app }) => {
      const dock = await openFiles(app);
      await dock.getByLabel('Global file asset').setInputFiles(json('openapi.json', root));
      const refs = dock.getByRole('region', { name: 'Referenced files' });
      await expect(refs.getByText('paths/pets.json')).toBeVisible();
      await dismissToasts(app);

      // Several at once, matched by name — pet.json only becomes a reference
      // once pets.json is in, and is matched on the next round.
      await refs
        .getByLabel('Upload referenced files for openapi.json')
        .setInputFiles([json('pet.json', pet), json('pets.json', pets)]);
      await expect(
        refs.getByText('All 2 referenced files are here: the spec is read in full.'),
      ).toBeVisible();
      await expect(dock.getByText('OpenAPI 3 · 2 ops')).toBeVisible();
      await dismissToasts(app);

      // The dock scrolls itself: on a short window, reaching a control at its foot scrolls the
      // dock, never a clipped (overflow: hidden) container — that would shift the editor behind it.
      await app.setViewportSize({ width: 1024, height: 420 });
      await refs.getByRole('button', { name: 'Save as new spec' }).focus();
      const clippedAndScrolled = await app.evaluate(
        () =>
          [...document.querySelectorAll('div')].filter(
            (el) => el.scrollTop > 0 && getComputedStyle(el).overflowY === 'hidden',
          ).length,
      );
      expect(clippedAndScrolled).toBe(0);

      const [download] = await Promise.all([
        app.waitForEvent('download'),
        refs.getByRole('button', { name: 'Download one file' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('openapi.bundled.json');
      const bundled = JSON.parse(readFileSync((await download.path())!, 'utf8')) as {
        paths: Record<string, { $ref?: string }>;
      };
      // Every reference now points inside the one file.
      const refsInFile = JSON.stringify(bundled).match(/"\$ref":"[^"]*"/g) ?? [];
      expect(refsInFile.length).toBeGreaterThan(0);
      expect(refsInFile.every((r) => r.startsWith('"$ref":"#'))).toBe(true);
      expect(bundled.paths['/pets'].$ref).toBe('#/x-apicircle-documents/paths~1pets.json');

      await refs.getByRole('button', { name: 'Save as new spec' }).click();
      await expect(app.getByText('Saved "openapi.json (one file)"')).toBeVisible();

      // Back in the list: the supplied files sit inside their spec's row, and
      // the one-file spec is a row of its own.
      const back = dock.getByRole('button', { name: 'Back to list' });
      if (await back.isVisible()) await back.click();
      await expect(dock.getByText('+2 files')).toBeVisible();
      await expect(
        dock.getByRole('list', { name: 'Files referenced by openapi.json' }).getByRole('button'),
      ).toHaveCount(2);
      await expect(dock.getByRole('button', { name: /^openapi\.json \(one file\)/ })).toBeVisible();
    },
  );

  test(
    tc(id('$ref to URL (http)'), 'never fetches a URL reference, and takes a copy instead'),
    async ({ app }) => {
      const requests: string[] = [];
      app.on('request', (r) => {
        if (r.url().startsWith('https://specs.example.com')) requests.push(r.url());
      });
      const remote = JSON.stringify({
        openapi: '3.0.3',
        paths: { '/pets': { $ref: 'https://specs.example.com/paths/pets.json' } },
      });
      const dock = await openFiles(app);
      await dock.getByLabel('Global file asset').setInputFiles(json('remote.json', remote));
      const refs = dock.getByRole('region', { name: 'Referenced files' });
      await expect(refs).toBeVisible();
      await dismissToasts(app);
      await expect(
        refs.getByText('A URL — never fetched. Upload a copy of the file it points at.'),
      ).toBeVisible();
      await refs
        .getByLabel('Upload a file for https://specs.example.com/paths/pets.json')
        .setInputFiles(json('pets-copy.json', JSON.stringify({ get: { responses: {} } })));
      await expect(refs.getByText(/^All 1 referenced file is here/)).toBeVisible();
      expect(requests).toEqual([]);
    },
  );
});
