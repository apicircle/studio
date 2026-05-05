// Validate-on-send feature: workspace toggle + pre-send panel + Send-blocked
// when blockers are present.
//
// Each test starts from default settings (toggle ON) and exercises the
// rule it cares about. Validation is computed in core/preSendValidation
// and rendered by ./packages/ui-components/src/panels/editor/PreSendPanel.

import { expect, test } from './fixtures/app';

async function openSettings(app: import('@playwright/test').Page): Promise<void> {
  await app.getByRole('button', { name: 'Open workspace settings' }).click();
  await expect(app.getByRole('dialog', { name: 'Workspace settings' })).toBeVisible();
}

async function setValidateOnSend(
  app: import('@playwright/test').Page,
  value: boolean,
): Promise<void> {
  await openSettings(app);
  const checkbox = app.getByRole('checkbox', { name: 'Validate before sending' });
  if ((await checkbox.isChecked()) !== value) {
    await checkbox.click();
  }
  // Close popover.
  await app.keyboard.press('Escape');
  await expect(app.getByRole('dialog', { name: 'Workspace settings' })).not.toBeVisible();
}

test.describe('Validate on send', () => {
  test('toggle off → no panel even on a broken request', async ({ app, sidebar }) => {
    await setValidateOnSend(app, false);
    await sidebar.createRequest('vos-off');
    // Reference an unresolved {{var}} — would normally trigger a warning.
    await app.getByLabel('Request URL').fill('https://api.example.test/{{MISSING_VAR}}');
    await expect(app.getByLabel('Pre-send validation')).not.toBeVisible();
    // Restore default for the rest of the suite.
    await setValidateOnSend(app, true);
  });

  test('toggle on + unresolved {{var}} → warning surfaces', async ({ app, sidebar }) => {
    await setValidateOnSend(app, true);
    await sidebar.createRequest('vos-unresolved');
    await app.getByLabel('Request URL').fill('https://api.example.test/{{NOPE_NOT_DEFINED}}');
    const panel = app.getByLabel('Pre-send validation');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/NOPE_NOT_DEFINED/)).toBeVisible();
  });

  test('toggle on + unbound path placeholder → warning surfaces', async ({ app, sidebar }) => {
    await setValidateOnSend(app, true);
    await sidebar.createRequest('vos-path');
    await app.getByLabel('Request URL').fill('https://api.example.test/users/{userId}');
    const panel = app.getByLabel('Pre-send validation');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Path parameter "userId" is empty/)).toBeVisible();
  });

  test('toggle on + Bearer with empty token → blocker disables Send', async ({ app, sidebar }) => {
    await setValidateOnSend(app, true);
    await sidebar.createRequest('vos-bearer-empty');
    await app.getByRole('button', { name: /^Auth/ }).first().click();
    await app.getByLabel('Auth type').selectOption('bearer');
    // Don't fill the token — that's the trigger.
    const panel = app.getByLabel('Pre-send validation');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Bearer token is empty/)).toBeVisible();
    // Send button must be disabled.
    await expect(app.getByRole('button', { name: /^Send$/ })).toBeDisabled();
  });

  test('blocker clears when fields fill in → Send re-enables', async ({ app, sidebar }) => {
    await setValidateOnSend(app, true);
    await sidebar.createRequest('vos-bearer-fill');
    await app.getByRole('button', { name: /^Auth/ }).first().click();
    await app.getByLabel('Auth type').selectOption('bearer');
    await expect(app.getByRole('button', { name: /^Send$/ })).toBeDisabled();
    // Fill the token.
    await app.getByRole('textbox', { name: 'Bearer token', exact: true }).fill('a-token');
    // Panel disappears (no warnings/blockers); Send re-enables.
    await expect(app.getByLabel('Pre-send validation')).not.toBeVisible();
    await expect(app.getByRole('button', { name: /^Send$/ })).toBeEnabled();
  });
});
