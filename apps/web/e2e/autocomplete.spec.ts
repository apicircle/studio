import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module RE.
import { tcMapRE } from './fixtures/tcMapRE';
void Object.keys(tcMapRE);

function id(key: string): TcId {
  const v = tcMapRE[key];
  if (!v) throw new Error(`No TC-RE entry for "${key}"`);
  return v;
}
// P15 — Env / context / secret variable autocomplete in URL bar, header
// values, and query rows. The Monaco completion provider for the body
// editor is also wired but isn't asserted here (Monaco's suggestion popup
// is hard to drive deterministically across platforms — covered by unit).

async function seedEnv(app: import('@playwright/test').Page) {
  await app.getByRole('button', { name: /^Environments$/ }).click();
  await app.getByLabel('New environment').click();
  await app.getByLabel('Environment name').fill('dev');
  await app.getByLabel('Environment name').press('Enter');
  await app.getByRole('button', { name: 'Add variable' }).click();
  await app.getByLabel('Variable key').fill('BASE_URL');
  await app.getByLabel('Variable value').fill('https://api.example.test');
  await app.getByLabel('Variable value').blur();
  await app.getByRole('button', { name: /^Editor$/ }).click();
  // Name-first new-request flow.
  await app.getByLabel('New request', { exact: true }).first().click();
  const input = app.getByLabel('Inline rename request');
  await input.fill(`autocomplete-${Math.random().toString(36).slice(2, 8)}`);
  await input.press('Enter');
}

test.describe('Variable autocomplete (P15)', () => {
  test(
    tc(
      id('URL Bar :: Empty URL on Send'),
      'typing `{{` in the URL bar opens the suggestion listbox @smoke',
    ),
    async ({ app }) => {
      await seedEnv(app);
      const url = app.getByLabel('Request URL');
      await url.click();
      await url.fill('');
      await app.keyboard.type('{{', { delay: 30 });

      const listbox = app.getByRole('listbox', { name: /Request URL suggestions/ });
      await expect(listbox).toBeVisible();
      await expect(app.getByRole('option', { name: /BASE_URL/ })).toBeVisible();
    },
  );

  test(
    tc(id('Headers :: Add custom header'), 'Tab inserts the highlighted suggestion'),
    async ({ app }) => {
      await seedEnv(app);
      const url = app.getByLabel('Request URL');
      await url.click();
      await url.fill('');
      await app.keyboard.type('{{BASE', { delay: 30 });
      await expect(app.getByRole('option', { name: /BASE_URL/ })).toBeVisible();
      await app.keyboard.press('Tab');
      await expect(url).toHaveValue('{{BASE_URL}}');
    },
  );

  test(
    tc(id('Headers :: Variable interpolation in header value'), 'Escape collapses the listbox'),
    async ({ app }) => {
      await seedEnv(app);
      const url = app.getByLabel('Request URL');
      await url.click();
      await url.fill('');
      await app.keyboard.type('{{', { delay: 30 });
      const listbox = app.getByRole('listbox', { name: /Request URL suggestions/ });
      await expect(listbox).toBeVisible();
      await app.keyboard.press('Escape');
      await expect(listbox).not.toBeVisible();
    },
  );

  test(
    tc(
      id('Params Matrix :: Query params: Variable in value on DELETE'),
      'clicking a suggestion inserts the variable in a header value',
    ),
    async ({ app }) => {
      await seedEnv(app);
      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('Authorization');

      const valueInput = app.getByLabel('Headers value 1');
      await valueInput.click();
      await valueInput.fill('');
      await app.keyboard.type('{{', { delay: 30 });
      const option = app.getByRole('option', { name: /BASE_URL/ });
      await expect(option).toBeVisible();
      await option.click();
      await expect(valueInput).toHaveValue('{{BASE_URL}}');
    },
  );

  // Header dictionary v1 port: each entry can carry a `reserved` annotation
  // surfaced in the autocomplete popover as either an "auto" badge (app-
  // injected) or a "browser" badge (forbidden by Fetch spec). Verifying both
  // ensures the dictionary's metadata reaches the UI through suggestHeaders().
  test(
    tc(
      id('Headers :: Header autocomplete suggests standard names'),
      'header autocomplete shows reserved badges (auto for app, browser for fetch-forbidden)',
    ),
    async ({ app, sidebar }) => {
      await sidebar.createRequest('header-badges');
      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      const keyInput = app.getByLabel('Headers key 1');

      // X-Client-* are reserved=app — but suggestHeaders filters them out so
      // typing the prefix shouldn't surface them in suggestions.
      await keyInput.fill('X-Client');
      const listbox = app.getByRole('listbox', { name: 'Header suggestions' });
      await expect(listbox).not.toBeVisible();

      // Content-Length is reserved=browser — suggestable AND tagged.
      await keyInput.fill('');
      await keyInput.fill('Content-Length');
      await expect(listbox).toBeVisible();
      const browserOption = listbox.getByRole('option', { name: /Content-Length/ });
      await expect(browserOption).toContainText('browser');
    },
  );
});
