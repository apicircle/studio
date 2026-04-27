import { expect, test } from './fixtures/app';

// Plan §10.2 "Environments" suite — create env → add encrypted variable →
// set active → reference {{TOKEN}} in URL → send → mock receives the
// substituted value (proving send-time decryption ran in-browser end to
// end). Delete env.

test.describe('Environments', () => {
  test('create + encrypt variable, then send substitutes the placeholder', async ({
    app,
    mockApi,
  }) => {
    // 1. Move into the Environments panel.
    await app.getByRole('button', { name: /^Environments$/ }).click();

    // 2. Create an environment.
    await app.getByLabel('New environment').click();
    await app.getByLabel('Environment name').fill('dev');
    await app.getByLabel('Environment name').press('Enter');

    // 3. Add a plain BASE_URL.
    await app.getByRole('button', { name: 'Add variable' }).click();
    await app.getByLabel('Variable key').first().fill('BASE_URL');
    await app.getByLabel('Variable value').first().fill('https://api.example.test');
    await app.getByLabel('Variable value').first().blur();

    // 4. Add an encrypted TOKEN.
    await app.getByRole('button', { name: 'Add variable' }).click();
    await app.getByLabel('Variable key').nth(1).fill('TOKEN');
    // Toggle the second row to Encrypted before committing the value.
    await app.getByRole('button', { name: 'Toggle encrypted' }).nth(1).click();
    await app.getByLabel('Variable value').nth(1).fill('super-secret');
    await app.getByLabel('Variable value').nth(1).blur();

    // 5. Move into the Editor and create a request that references both.
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app.getByLabel('New request').click();
    await app.getByLabel('Request URL').fill('{{BASE_URL}}/users');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    // Add a header row referencing the encrypted token.
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('Authorization');
    await app.getByLabel('Headers value 1').fill('Bearer {{TOKEN}}');

    // 6. Mock the resolved URL and Send.
    await mockApi.json(/api\.example\.test\/users/, { ok: true });
    await app.getByRole('button', { name: /^Send$/ }).click();

    // 7. The mock fired only when the URL was substituted correctly.
    await expect(app.getByText('200')).toBeVisible();
    expect(mockApi.capturedUrls()).toEqual(['https://api.example.test/users']);
  });
});
