import { expect, test } from './fixtures/app';

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
  await app.getByLabel('New request').click();
}

test.describe('Variable autocomplete (P15)', () => {
  test('typing `{{` in the URL bar opens the suggestion listbox', async ({ app }) => {
    await seedEnv(app);
    const url = app.getByLabel('Request URL');
    await url.click();
    await url.fill('');
    await app.keyboard.type('{{', { delay: 30 });

    const listbox = app.getByRole('listbox', { name: /Request URL suggestions/ });
    await expect(listbox).toBeVisible();
    await expect(app.getByRole('option', { name: /BASE_URL/ })).toBeVisible();
  });

  test('Tab inserts the highlighted suggestion', async ({ app }) => {
    await seedEnv(app);
    const url = app.getByLabel('Request URL');
    await url.click();
    await url.fill('');
    await app.keyboard.type('{{BASE', { delay: 30 });
    await expect(app.getByRole('option', { name: /BASE_URL/ })).toBeVisible();
    await app.keyboard.press('Tab');
    await expect(url).toHaveValue('{{BASE_URL}}');
  });

  test('Escape collapses the listbox', async ({ app }) => {
    await seedEnv(app);
    const url = app.getByLabel('Request URL');
    await url.click();
    await url.fill('');
    await app.keyboard.type('{{', { delay: 30 });
    const listbox = app.getByRole('listbox', { name: /Request URL suggestions/ });
    await expect(listbox).toBeVisible();
    await app.keyboard.press('Escape');
    await expect(listbox).not.toBeVisible();
  });

  test('clicking a suggestion inserts the variable in a header value', async ({ app }) => {
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
  });
});
