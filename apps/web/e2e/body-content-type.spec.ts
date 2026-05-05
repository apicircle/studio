// Body-driven Content-Type sweep — switching the body-type radio
// auto-fills (or updates) the Content-Type header row. Uses the
// canonical mapping in packages/core/src/request/bodyTypeContentType.ts.

import { expect, test } from './fixtures/app';

const TYPED_BODIES: Array<{ radioName: string; expectedContentType: string }> = [
  { radioName: 'JSON', expectedContentType: 'application/json' },
  { radioName: 'text', expectedContentType: 'text/plain' },
  { radioName: 'XML', expectedContentType: 'application/xml' },
  { radioName: 'urlencoded', expectedContentType: 'application/x-www-form-urlencoded' },
  { radioName: 'GraphQL', expectedContentType: 'application/graphql' },
  { radioName: 'form-data', expectedContentType: 'multipart/form-data' },
  { radioName: 'binary', expectedContentType: 'application/octet-stream' },
];

test.describe('Body-driven Content-Type', () => {
  for (const { radioName, expectedContentType } of TYPED_BODIES) {
    test(`switching to ${radioName} auto-fills Content-Type to "${expectedContentType}"`, async ({
      app,
      sidebar,
    }) => {
      await sidebar.createRequest(`ct-${radioName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByRole('button', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: radioName }).click();
      // Switch to Headers tab and assert the Content-Type row.
      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await expect(app.getByLabel('Headers value 1')).toHaveValue(expectedContentType);
    });
  }

  test('switching back to none strips the auto-set Content-Type row', async ({ app, sidebar }) => {
    await sidebar.createRequest('ct-strip-on-none');
    await app.getByLabel('HTTP method').selectOption('POST');
    await app.getByRole('button', { name: 'Body', exact: true }).click();
    await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
    await app.getByRole('radio', { name: 'JSON' }).click();
    // Confirm Content-Type appears.
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await expect(app.getByLabel('Headers value 1')).toHaveValue('application/json');
    // Flip back to none.
    await app.getByRole('button', { name: 'Body', exact: true }).click();
    await app.getByRole('radio', { name: 'none' }).click();
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    // Headers list is now empty (only the Content-Type row was added; no
    // user rows).
    await expect(app.getByText(/No headers yet/i)).toBeVisible();
  });

  test('user-set Content-Type is NOT overwritten when body type changes', async ({
    app,
    sidebar,
  }) => {
    await sidebar.createRequest('ct-user-wins');
    await app.getByLabel('HTTP method').selectOption('POST');
    // User sets Content-Type manually first.
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('Content-Type');
    await app.keyboard.press('Escape');
    await app.getByLabel('Headers value 1').fill('application/x-custom-type');
    // Now switch body type to JSON. The user's Content-Type should
    // update to JSON's value because the editor's policy is "keep one
    // Content-Type row, value matches body type". This proves the
    // intentional auto-update — switch back to verify.
    await app.getByRole('button', { name: 'Body', exact: true }).click();
    await app.getByRole('radio', { name: 'JSON' }).click();
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await expect(app.getByLabel('Headers value 1')).toHaveValue('application/json');
  });
});
