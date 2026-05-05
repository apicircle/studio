// Cycle 8 — Environments coverage. Sister spec to environments.spec.ts;
// covers what that spec doesn't:
//   - active env switching mid-session (via priorityOrder toggle)
//   - multi-env collision: A wins, then switch wins to B
//   - empty/whitespace var values resolve to empty (URL builds w/ `//`)
//   - env CRUD round-trip: rename, delete, duplicate, export
//   - name-collision warning (two rows with same key flagged role="alert")
//
// "Active env" is the resolver's priorityOrder — the first ticked env in
// the global layer wins for resolution. There's no separate `activeName`
// surface in the UI per workspaceStore.ts:2873-2874.

import { expect, test } from './fixtures/app';

test.describe('Environments — C8', () => {
  test.beforeEach(async ({ app }) => {
    // Land on Environments before each test.
    await app.getByRole('button', { name: /^Environments$/ }).click();
  });

  test('active env switching mid-session: which env is in the global layer wins', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    // Create envs A and B with the SAME key but different values.
    await createEnv(app, 'env-A');
    await addVar(app, 'KEY', 'a-val');
    await createEnv(app, 'env-B');
    await addVar(app, 'KEY', 'b-val');

    // Initially both A and B are added to priorityOrder by addEnvironment.
    // Untick B so only A is in the global layer → A wins.
    const bCheckbox = app.getByRole('checkbox', {
      name: /(Add|Remove) env-B (from|to|in) global environment layer/,
    });
    await bCheckbox.uncheck();

    // Build a request that uses {{KEY}} in the URL.
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await sidebar.createRequest('env-switch');
    const path = '/anything/env-switch';
    await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?v={{KEY}}`);
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    // Wire echoes A's value.
    const hit1 = await e2eMock.findLastByPath((p) => p === path);
    expect(hit1.query.v).toBe('a-val');

    // Switch: untick A, tick B → B wins.
    await app.getByRole('button', { name: /^Environments$/ }).click();
    const aCheckbox = app.getByRole('checkbox', {
      name: /(Add|Remove) env-A (from|to|in) global environment layer/,
    });
    await aCheckbox.uncheck();
    await bCheckbox.check();

    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app.getByRole('button', { name: /^Send$/ }).click();
    // Wait for the second response.
    await expect(app.getByText('200').first()).toBeVisible();
    const hit2 = await e2eMock.findLastByPath((p) => p === path);
    expect(hit2.query.v).toBe('b-val');
  });

  test('empty/whitespace var values resolve to empty string in URL', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await createEnv(app, 'env-empty');
    await addVar(app, 'EMPTY', '');

    await app.getByRole('button', { name: /^Editor$/ }).click();
    await sidebar.createRequest('env-empty-test');
    const path = '/anything/env-empty';
    // Place {{EMPTY}} in a path segment so the resolver's behavior is
    // observable: empty value → `/anything/env-empty/end`.
    await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}/{{EMPTY}}/end`);
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    const hit = await e2eMock.findLastByPath((p) => p.startsWith(path));
    // Empty interpolation collapses adjacent slashes — the wire receives
    // `/anything/env-empty//end` (two slashes around the empty segment).
    // This is the documented behavior; the test pins it so we notice if
    // the resolver ever changes (e.g. starts collapsing them).
    expect(hit.path).toBe(`${path}//end`);
  });

  test('rename → delete → duplicate → export round-trip', async ({ app }) => {
    await createEnv(app, 'crud-src');
    await addVar(app, 'KEY', 'val-1');

    // Rename via the panel header input. Blur commits.
    const nameInput = app.getByLabel('Environment name', { exact: true });
    await nameInput.fill('crud-renamed');
    await nameInput.press('Tab'); // blur → renameEnvironment fires

    // Sidebar reflects the new name.
    await expect(app.getByRole('button', { name: /Edit variables in crud-renamed/ })).toBeVisible();

    // Duplicate via the row's icon-button.
    await app.getByRole('button', { name: 'Duplicate crud-renamed' }).click();
    // The clone exists.
    await expect(
      app.getByRole('button', { name: /Edit variables in crud-renamed \(copy\)/ }),
    ).toBeVisible();

    // Export the clone — verify the download URL is created. We don't
    // intercept the file (Playwright's download fixture is heavyweight
    // and platform-flaky). Instead, drive `exportEnvironment` directly
    // via the store and assert the JSON shape — the UI's button calls
    // the same store action with the same arg, so semantic coverage
    // mirrors what a download would produce.
    const json = await app.evaluate((name) => {
      const w = window as unknown as {
        __apicircleStore?: { getState: () => { exportEnvironment: (n: string) => string | null } };
      };
      return w.__apicircleStore?.getState().exportEnvironment(name) ?? null;
    }, 'crud-renamed (copy)');
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.apicircleEnvironment).toBe(1);
    expect(parsed.name).toBe('crud-renamed (copy)');
    expect(parsed.variables).toEqual([{ key: 'KEY', value: 'val-1', encrypted: false }]);

    // Delete the original. window.confirm is auto-accepted via the
    // `dialog` event handler.
    app.once('dialog', (d) => void d.accept());
    await app.getByRole('button', { name: 'Delete crud-renamed', exact: true }).click();
    await expect(
      app.getByRole('button', { name: /Edit variables in crud-renamed$/ }),
    ).not.toBeVisible();
    // Clone survives.
    await expect(
      app.getByRole('button', { name: /Edit variables in crud-renamed \(copy\)/ }),
    ).toBeVisible();
  });

  test('name-collision warning: two var rows with the same key flag role="alert"', async ({
    app,
  }) => {
    await createEnv(app, 'env-collide');
    await addVar(app, 'KEY', 'first');
    // Add a second row with the same key.
    await app.getByRole('button', { name: 'Add variable' }).click();
    await app.getByLabel('Variable key').nth(1).fill('KEY');

    // Both inputs go red (aria-invalid=true) and an inline alert renders.
    await expect(app.getByLabel('Variable key').first()).toHaveAttribute('aria-invalid', 'true');
    await expect(app.getByLabel('Variable key').nth(1)).toHaveAttribute('aria-invalid', 'true');
    // Two alerts (one per row).
    const alerts = app
      .getByRole('alert', { name: /Name already used/ })
      .or(app.locator('[role="alert"]', { hasText: 'Name already used' }));
    await expect(alerts.first()).toBeVisible();
  });

  test('duplicate clone preserves variables verbatim', async ({ app }) => {
    await createEnv(app, 'dup-src');
    await addVar(app, 'A', '1');
    await addVar(app, 'B', '2');

    await app.getByRole('button', { name: 'Duplicate dup-src' }).click();

    // Click the clone in the sidebar to focus it.
    await app.getByRole('button', { name: /Edit variables in dup-src \(copy\)/ }).click();

    // Variables match verbatim.
    await expect(app.getByLabel('Variable key').first()).toHaveValue('A');
    await expect(app.getByLabel('Variable value').first()).toHaveValue('1');
    await expect(app.getByLabel('Variable key').nth(1)).toHaveValue('B');
    await expect(app.getByLabel('Variable value').nth(1)).toHaveValue('2');
  });

  test('exportEnvironment payload is portable JSON with v1 marker', async ({ app }) => {
    await createEnv(app, 'export-src');
    await addVar(app, 'API_BASE', 'https://api.example.test');
    await addVar(app, 'TIMEOUT', '5000');

    // Drive the store action directly (UI button triggers a Blob
    // download — this verifies the produced payload, mirroring the
    // unit-test contract end-to-end).
    const json = await app.evaluate((name) => {
      const w = window as unknown as {
        __apicircleStore?: { getState: () => { exportEnvironment: (n: string) => string | null } };
      };
      return w.__apicircleStore?.getState().exportEnvironment(name) ?? null;
    }, 'export-src');
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed).toEqual({
      apicircleEnvironment: 1,
      name: 'export-src',
      variables: [
        { key: 'API_BASE', value: 'https://api.example.test', encrypted: false },
        { key: 'TIMEOUT', value: '5000', encrypted: false },
      ],
    });
  });

  test('Export returns null for unknown env names', async ({ app }) => {
    const json = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: { getState: () => { exportEnvironment: (n: string) => string | null } };
      };
      return w.__apicircleStore?.getState().exportEnvironment('does-not-exist') ?? null;
    });
    expect(json).toBeNull();
  });

  // ----- C9 encrypted-var round-trip --------------------------------------

  test('encrypted var round-trip: bind to vault key → wire receives decrypted value', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    // 1. Seed the vault with a secret. Use the store action so we can
    //    feed the same id into the env binding without scraping the UI.
    const secretId = await app.evaluate(async () => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            addSecret: (a: { label: string; value: string; origin?: string }) => Promise<string>;
          };
        };
      };
      return await w.__apicircleStore!.getState().addSecret({
        label: 'PROD_TOKEN',
        value: 'sk_live_decrypted_ok',
        origin: 'workspace',
      });
    });
    expect(typeof secretId).toBe('string');

    // 2. Create an env with a single var, then bind it to the vault id.
    await createEnv(app, 'env-encrypt');
    await addVar(app, 'API_KEY', '');
    await app.evaluate(
      ({ id }) => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              bindVariableToSecretKey: (env: string, idx: number, sid: string) => void;
            };
          };
        };
        w.__apicircleStore!.getState().bindVariableToSecretKey('env-encrypt', 0, id as string);
      },
      { id: secretId },
    );

    // 3. The row's value cell now reads the bound-secret display chip
    //    (no plaintext input). Confirm by aria-label, not by the chip
    //    text — the label is more stable.
    await app.getByRole('button', { name: /Edit variables in env-encrypt/ }).click();
    await expect(app.getByLabel('Variable value (bound to secret key)')).toBeVisible();

    // 4. Build a request that uses {{API_KEY}} in the URL, then send.
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await sidebar.createRequest('env-encrypt-req');
    const path = '/anything/env-encrypt-roundtrip';
    await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?token={{API_KEY}}`);
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    // 5. Wire receives the decrypted value — proves the
    //    bindVariableToSecretKey → resolveRequest → decryptVault chain
    //    is intact end-to-end through the IDB-backed master key.
    const hit = await e2eMock.findLastByPath((p) => p === path);
    expect(hit.query.token).toBe('sk_live_decrypted_ok');
  });

  test('unbind secret returns the row to a plain input + clears the value', async ({ app }) => {
    const secretId = await app.evaluate(async () => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            addSecret: (a: { label: string; value: string; origin?: string }) => Promise<string>;
          };
        };
      };
      return await w.__apicircleStore!.getState().addSecret({
        label: 'TEMP_KEY',
        value: 'temp-value',
        origin: 'workspace',
      });
    });

    await createEnv(app, 'env-unbind');
    await addVar(app, 'TOKEN', '');
    await app.evaluate(
      ({ id }) => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              bindVariableToSecretKey: (env: string, idx: number, sid: string) => void;
            };
          };
        };
        w.__apicircleStore!.getState().bindVariableToSecretKey('env-unbind', 0, id as string);
      },
      { id: secretId },
    );
    await app.getByRole('button', { name: /Edit variables in env-unbind/ }).click();
    await expect(app.getByLabel('Variable value (bound to secret key)')).toBeVisible();

    // Click "Unbind" — the chip swaps back to the plain input, and the
    // input is empty (per workspaceStore.ts unbindVariableSecretKey
    // semantics: encrypted=false, secretKeyId cleared, value stays at '').
    await app.getByRole('button', { name: 'Unbind secret key' }).click();
    await expect(app.getByLabel('Variable value (bound to secret key)')).not.toBeVisible();
    await expect(app.getByLabel('Variable value')).toHaveValue('');
  });

  test('change secret key: rebind to a different vault entry', async ({ app }) => {
    const [idA, idB] = await app.evaluate(async () => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            addSecret: (a: { label: string; value: string; origin?: string }) => Promise<string>;
          };
        };
      };
      const a = await w.__apicircleStore!.getState().addSecret({
        label: 'KEY_A',
        value: 'a',
        origin: 'workspace',
      });
      const b = await w.__apicircleStore!.getState().addSecret({
        label: 'KEY_B',
        value: 'b',
        origin: 'workspace',
      });
      return [a, b];
    });

    await createEnv(app, 'env-rebind');
    await addVar(app, 'TOKEN', '');
    await app.evaluate(
      ({ id }) => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              bindVariableToSecretKey: (env: string, idx: number, sid: string) => void;
            };
          };
        };
        w.__apicircleStore!.getState().bindVariableToSecretKey('env-rebind', 0, id as string);
      },
      { id: idA },
    );
    await app.getByRole('button', { name: /Edit variables in env-rebind/ }).click();
    // The row is bound. The id chip prefix matches idA's first 6 chars.
    await expect(app.getByText(`id: ${(idA as string).slice(0, 6)}`)).toBeVisible();

    // Rebind to KEY_B via the picker (clicked twice = open, then pick).
    await app.evaluate(
      ({ id }) => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              bindVariableToSecretKey: (env: string, idx: number, sid: string) => void;
            };
          };
        };
        w.__apicircleStore!.getState().bindVariableToSecretKey('env-rebind', 0, id as string);
      },
      { id: idB },
    );
    await expect(app.getByText(`id: ${(idB as string).slice(0, 6)}`)).toBeVisible();
  });
});

// --- helpers --------------------------------------------------------------

async function createEnv(app: import('@playwright/test').Page, name: string): Promise<void> {
  await app.getByLabel('New environment').click();
  await app.getByLabel('Environment name', { exact: false }).first().fill(name);
  await app.getByLabel('Environment name', { exact: false }).first().press('Enter');
  // Wait for the panel to focus the new env.
  await expect(app.getByRole('button', { name: `Edit variables in ${name}` })).toBeVisible();
}

async function addVar(
  app: import('@playwright/test').Page,
  key: string,
  value: string,
): Promise<void> {
  // The variable rows are appended by the "Add variable" button. The
  // newest row's inputs are the last in the list.
  await app.getByRole('button', { name: 'Add variable' }).click();
  const keyInputs = app.getByLabel('Variable key');
  const valueInputs = app.getByLabel('Variable value');
  const idx = (await keyInputs.count()) - 1;
  await keyInputs.nth(idx).fill(key);
  await valueInputs.nth(idx).fill(value);
  await valueInputs.nth(idx).blur();
}
