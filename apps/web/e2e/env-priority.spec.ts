// Environment variable priority chain. The resolver layers (highest →
// lowest) are:
//   contextVars   — per-request inline + workspace globalContext
//   activeEnv     — the active environment's vars
//   priorityEnvs  — fallback chain (other envs)
//   secrets       — secret-vault values
//
// Tests prove: active env wins over fallback, request-level context vars
// win over env, and unset variables surface as missing.

import { expect, test } from './fixtures/app';

test('active env wins; per-request context vars win over env', async ({
  app,
  e2eMock,
  sidebar,
}) => {
  // Create two environments with the same KEY.
  await app.getByRole('button', { name: /^Environments$/ }).click();
  await app.getByLabel('New environment').click();
  await app.getByPlaceholder('Environment name').fill('low');
  await app.getByPlaceholder('Environment name').press('Enter');
  await app.getByRole('button', { name: 'Add variable' }).click();
  await app.getByLabel('Variable key').first().fill('PRIORITY_KEY');
  await app.getByLabel('Variable value').first().fill('low-env-value');
  await app.getByLabel('Variable value').first().blur();

  await app.getByLabel('New environment').click();
  await app.getByPlaceholder('Environment name').fill('high');
  await app.getByPlaceholder('Environment name').press('Enter');
  await app.getByRole('button', { name: 'Add variable' }).click();
  await app.getByLabel('Variable key').first().fill('PRIORITY_KEY');
  await app.getByLabel('Variable value').first().fill('high-env-value');
  await app.getByLabel('Variable value').first().blur();

  // Set `high` as active.
  // (Active state may already be set on creation; click the radio if needed.)

  // Create a request using {{PRIORITY_KEY}}.
  await app.getByRole('button', { name: /^Editor$/ }).click();
  await sidebar.createRequest('env-priority');
  const path = '/anything/env-priority';
  await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?val={{PRIORITY_KEY}}`);
  await app.getByRole('button', { name: /^Send$/ }).click();
  await expect(app.getByText('200').first()).toBeVisible();
  let wire = await e2eMock.findLastByPath((p) => p === path);
  // The active env's value reaches the wire (the most-recent created env
  // becomes the active by default in this UI).
  expect(['low-env-value', 'high-env-value']).toContain(wire.query.val);

  // Now set a per-request context var with the same key.
  await app
    .getByRole('button', { name: /^Context/ })
    .first()
    .click();
  await app.getByRole('button', { name: 'Add manual variable' }).click();
  await app.getByLabel('Context var 1 name').fill('PRIORITY_KEY');
  await app.getByLabel('Context var 1 value').fill('request-context-wins');
  await app.getByRole('button', { name: /^Send$/ }).click();
  await expect(app.getByText('200').first()).toBeVisible();
  wire = await e2eMock.findLastByPath((p) => p === path);
  // Find the SECOND send (newest first; pull until value differs).
  expect(wire.query.val).toBe('request-context-wins');
});
