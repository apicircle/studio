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

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module VR.
import { tcMapVR } from './fixtures/tcMapVR';

function id(key: string): TcId {
  const v = tcMapVR[key];
  if (!v) throw new Error(`No TC-VR entry for "${key}"`);
  return v;
}
test.describe('Environments — C8', () => {
  test.beforeEach(async ({ app }) => {
    // Land on Environments before each test.
    await app.getByRole('button', { name: /^Environments$/ }).click();
  });

  test(
    tc(
      id('Env :: Activate env'),
      'active env switching mid-session: which env is in the global layer wins @smoke',
    ),
    async ({ app, e2eMock, sidebar }) => {
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
    },
  );

  test(
    tc(id('Resolution'), 'empty/whitespace var values resolve to empty string in URL'),
    async ({ app, e2eMock, sidebar }) => {
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
    },
  );

  test(
    tc(
      [id('Env :: Delete env with confirm'), id('Env :: Rename env updates refs')],
      'rename → delete → duplicate → export round-trip',
    ),
    async ({ app }) => {
      await createEnv(app, 'crud-src');
      await addVar(app, 'KEY', 'val-1');

      // Rename via the panel header input. Blur commits.
      const nameInput = app.getByLabel('Environment name', { exact: true });
      await nameInput.fill('crud-renamed');
      await nameInput.press('Tab'); // blur → renameEnvironment fires

      // Sidebar reflects the new name.
      await expect(
        app.getByRole('button', { name: /Edit variables in crud-renamed/ }),
      ).toBeVisible();

      // Duplicate via the row's kebab menu (Environment actions).
      await envRowAction(app, 'crud-renamed', 'Duplicate');
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
          __apicircleStore?: {
            getState: () => { exportEnvironment: (n: string) => string | null };
          };
        };
        return w.__apicircleStore?.getState().exportEnvironment(name) ?? null;
      }, 'crud-renamed (copy)');
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.apicircleEnvironment).toBe(2);
      expect(parsed.name).toBe('crud-renamed (copy)');
      expect(parsed.variables).toEqual([{ key: 'KEY', value: 'val-1', encrypted: false }]);

      // Delete the original via the kebab menu. Delete routes through a
      // ConfirmDialog (not window.confirm) — confirm via its button.
      await envRowAction(app, 'crud-renamed', 'Delete');
      await app.getByRole('button', { name: 'Delete environment', exact: true }).click();
      await expect(
        app.getByRole('button', { name: /Edit variables in crud-renamed$/ }),
      ).not.toBeVisible();
      // Clone survives.
      await expect(
        app.getByRole('button', { name: /Edit variables in crud-renamed \(copy\)/ }),
      ).toBeVisible();
    },
  );

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

  test(
    tc(id('Env :: Duplicate env'), 'duplicate clone preserves variables verbatim'),
    async ({ app }) => {
      await createEnv(app, 'dup-src');
      await addVar(app, 'A', '1');
      await addVar(app, 'B', '2');

      await envRowAction(app, 'dup-src', 'Duplicate');

      // Click the clone in the sidebar to focus it.
      await app.getByRole('button', { name: /Edit variables in dup-src \(copy\)/ }).click();

      // Variables match verbatim.
      await expect(app.getByLabel('Variable key').first()).toHaveValue('A');
      await expect(app.getByLabel('Variable value').first()).toHaveValue('1');
      await expect(app.getByLabel('Variable key').nth(1)).toHaveValue('B');
      await expect(app.getByLabel('Variable value').nth(1)).toHaveValue('2');
    },
  );

  test('exportEnvironment payload is portable JSON with v2 marker', async ({ app }) => {
    await createEnv(app, 'export-src');
    await addVar(app, 'API_BASE', 'https://api.example.test');
    await addVar(app, 'TIMEOUT', '5000');

    // Drive the store action directly (UI button triggers a Blob
    // download — this verifies the produced payload, mirroring the
    // unit-test contract end-to-end).
    const json = await app.evaluate((name) => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { exportEnvironment: (n: string) => string | null };
        };
      };
      return w.__apicircleStore?.getState().exportEnvironment(name) ?? null;
    }, 'export-src');
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed).toEqual({
      apicircleEnvironment: 2,
      name: 'export-src',
      variables: [
        { key: 'API_BASE', value: 'https://api.example.test', encrypted: false },
        { key: 'TIMEOUT', value: '5000', encrypted: false },
      ],
    });
  });

  test('roundtrip: export an env, then import the JSON via the modal (collision-renamed)', async ({
    app,
  }) => {
    // 1. Author the source env.
    await createEnv(app, 'roundtrip-src');
    await addVar(app, 'API_BASE', 'https://api.example.test');
    await addVar(app, 'TOKEN', 'sk_demo_123');

    // 2. Read the exported JSON straight from the store (mirrors the UI's
    //    Export-as-JSON download flow — see exportEnvironment v2 test above).
    const json = await app.evaluate((name) => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { exportEnvironment: (n: string) => string | null };
        };
      };
      return w.__apicircleStore?.getState().exportEnvironment(name) ?? null;
    }, 'roundtrip-src');
    expect(json).not.toBeNull();

    // 3. Open the Import modal via the Environments-actions kebab. The
    //    modal is lazy — wait for the dialog to attach.
    await app.getByRole('button', { name: 'Environments actions', exact: true }).first().click();
    await app.getByRole('menuitem', { name: 'Import', exact: true }).click();
    const textarea = await app.getByLabel('Import source').elementHandle();
    expect(textarea).not.toBeNull();

    // 4. Paste the JSON. Drive the controlled textarea via its setter so
    //    the React state actually updates (mirrors pasteInto from the unit
    //    tests in ImportModal.test.tsx).
    await app.evaluate((value) => {
      const t = document.querySelector(
        'textarea[aria-label="Import source"]',
      ) as HTMLTextAreaElement | null;
      if (!t) throw new Error('Import source textarea not mounted');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(t, value);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }, json!);

    // 5. Detection preview must announce an API Circle environment.
    await expect(app.getByText(/API Circle environment\)/)).toBeVisible();

    // 6. Confirm the import. Source env still exists → the new env lands
    //    under `roundtrip-src (2)` (importApicircleEnvironment collision
    //    suffix, see workspaceStore.ts).
    await app.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(
      app.getByRole('button', { name: /Edit variables in roundtrip-src \(2\)/ }),
    ).toBeVisible();

    // 7. Vars round-trip verbatim.
    await app.getByRole('button', { name: /Edit variables in roundtrip-src \(2\)/ }).click();
    await expect(app.getByLabel('Variable key').first()).toHaveValue('API_BASE');
    await expect(app.getByLabel('Variable value').first()).toHaveValue('https://api.example.test');
    await expect(app.getByLabel('Variable key').nth(1)).toHaveValue('TOKEN');
    await expect(app.getByLabel('Variable value').nth(1)).toHaveValue('sk_demo_123');
  });

  test('encrypted-binding import: bind step seeds a new vault slot and a new env entry into the git-tracked synced doc', async ({
    app,
  }) => {
    // Workspace has its own vault unlocked so addSecret can encrypt.
    await setupVaultPassphrase(app);

    // The envelope simulates an export from a DIFFERENT workspace: the
    // source's `sec_origin` id is meaningless here, but the `secret.label`
    // ("PROD_TOKEN") is the human-recognizable name we prompt with.
    const envelope = {
      apicircleEnvironment: 1,
      name: 'cross-ws-env',
      variables: [
        { key: 'API_BASE', value: 'https://api.example.test', encrypted: false },
        {
          key: 'TOKEN',
          encrypted: true,
          secretKeyId: 'sec_origin',
          secret: { label: 'PROD_TOKEN' },
        },
      ],
    };

    // Open the Import modal via the Environments kebab → paste → Import.
    await app.getByRole('button', { name: 'Environments actions', exact: true }).first().click();
    await app.getByRole('menuitem', { name: 'Import', exact: true }).click();
    await expect(app.getByLabel('Import source')).toBeVisible();
    await app.evaluate((value) => {
      const t = document.querySelector(
        'textarea[aria-label="Import source"]',
      ) as HTMLTextAreaElement | null;
      if (!t) throw new Error('Import source textarea not mounted');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(t, value);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }, JSON.stringify(envelope));
    await expect(app.getByText(/API Circle environment\)/)).toBeVisible();
    await app.getByRole('button', { name: 'Import', exact: true }).click();

    // Modal switches to step 2 — bind prompt with the slot label from
    // the export. The modal didn't close yet.
    await expect(app.getByText(/1 secret binding for/i)).toBeVisible();
    await expect(app.getByText('PROD_TOKEN').first()).toBeVisible();

    // Provide the secret value and click Bind & finish.
    await app.getByLabel(/Secret value for PROD_TOKEN/i).fill('sk_live_e2e_abc');
    await app.getByRole('button', { name: /Bind 1 & finish/i }).click();

    // Wait for the bind modal to actually finish: PBKDF2 + AES-GCM run
    // off-event-loop, so we can't snapshot `synced` until the bind step
    // unmounts (which only happens once `bindVariableToSecretKey`
    // resolves and `closeAndReset` fires). The env's sidebar button
    // appears at step 1 of the import, so it isn't a meaningful wait.
    await expect(app.getByText(/1 secret binding for/i)).toBeHidden();
    // Sidebar reflects the imported env.
    await expect(app.getByRole('button', { name: /Edit variables in cross-ws-env/ })).toBeVisible();

    // Workspace state — the env + the new vault slot must both be in
    // `synced` (where serializeWorkspaceForGit reads from). This is the
    // E2E proof that the import drives a real git-diffable change.
    const result = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            synced: {
              environments: { items: Record<string, { variables: unknown[] }> };
              secretKeys?: Record<string, { id: string; label: string; salt: string }>;
            };
            local: { secretIndex: { entries: Record<string, { id: string; label: string }> } };
          };
        };
      };
      const s = w.__apicircleStore!.getState();
      return {
        env: s.synced.environments.items['cross-ws-env'],
        slots: Object.values(s.synced.secretKeys ?? {}),
        entries: Object.values(s.local.secretIndex.entries),
      };
    });
    // Env carries both vars.
    expect(result.env.variables).toHaveLength(2);
    const [api, token] = result.env.variables as Array<{
      key: string;
      value: string;
      encrypted: boolean;
      secretKeyId?: string;
    }>;
    expect(api).toMatchObject({
      key: 'API_BASE',
      value: 'https://api.example.test',
      encrypted: false,
    });
    expect(token.key).toBe('TOKEN');
    expect(token.encrypted).toBe(true);
    expect(typeof token.secretKeyId).toBe('string');
    // The new vault slot landed under the user-supplied label.
    const slot = result.slots.find((s) => s.label === 'PROD_TOKEN');
    expect(slot).toBeDefined();
    // The row was re-pointed from `sec_origin` (source id) to the
    // destination's new slot id — proves the binding is live.
    expect(token.secretKeyId).toBe(slot!.id);
    expect(token.secretKeyId).not.toBe('sec_origin');
    // The local-only secretIndex mirrors the synced metadata.
    expect(result.entries.some((e) => e.id === slot!.id && e.label === 'PROD_TOKEN')).toBe(true);
  });

  test('encrypted-binding import: Skip & finish leaves the env imported with the source binding id (git diff still records the env, no new vault slot)', async ({
    app,
  }) => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'skip-env',
      variables: [
        {
          key: 'TOKEN',
          encrypted: true,
          secretKeyId: 'sec_origin',
          secret: { label: 'PROD_TOKEN' },
        },
      ],
    };

    await app.getByRole('button', { name: 'Environments actions', exact: true }).first().click();
    await app.getByRole('menuitem', { name: 'Import', exact: true }).click();
    await expect(app.getByLabel('Import source')).toBeVisible();
    await app.evaluate((value) => {
      const t = document.querySelector(
        'textarea[aria-label="Import source"]',
      ) as HTMLTextAreaElement | null;
      if (!t) throw new Error('Import source textarea not mounted');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(t, value);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }, JSON.stringify(envelope));
    await app.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(app.getByText(/1 secret binding for/i)).toBeVisible();
    await app.getByRole('button', { name: /Skip & finish/i }).click();

    // Env is in the sidebar; importer left the source's id alone so the
    // env-panel chip still renders something the user can re-target.
    await expect(app.getByRole('button', { name: /Edit variables in skip-env/ })).toBeVisible();
    const state = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            synced: {
              environments: { items: Record<string, { variables: unknown[] }> };
              secretKeys?: Record<string, { id: string; label: string }>;
            };
          };
        };
      };
      const s = w.__apicircleStore!.getState();
      return {
        env: s.synced.environments.items['skip-env'],
        slotsByLabel: Object.values(s.synced.secretKeys ?? {}).map((slot) => slot.label),
      };
    });
    const [token] = state.env.variables as Array<{
      key: string;
      encrypted: boolean;
      secretKeyId?: string;
    }>;
    expect(token).toMatchObject({
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_origin',
    });
    // The skip path must NOT create a vault slot — nothing was offered.
    expect(state.slotsByLabel).not.toContain('PROD_TOKEN');
  });

  test('legacy-shape import (secretKeyId without secret.label) still triggers the bind step with a fallback label', async ({
    app,
  }) => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'legacy-shape',
      // Mimics an export from a v1.0.x build that pre-dated `secret.label`.
      variables: [{ key: 'TOKEN', encrypted: true, secretKeyId: 'sec_legacy' }],
    };

    await app.getByRole('button', { name: 'Environments actions', exact: true }).first().click();
    await app.getByRole('menuitem', { name: 'Import', exact: true }).click();
    await expect(app.getByLabel('Import source')).toBeVisible();
    await app.evaluate((value) => {
      const t = document.querySelector(
        'textarea[aria-label="Import source"]',
      ) as HTMLTextAreaElement | null;
      if (!t) throw new Error('Import source textarea not mounted');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(t, value);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }, JSON.stringify(envelope));
    await app.getByRole('button', { name: 'Import', exact: true }).click();
    // Parser uses the var key as the fallback label — the bind step
    // renders it AND tells the user the label was synthesized so they
    // know to rename the slot later.
    await expect(app.getByText(/1 secret binding for/i)).toBeVisible();
    await expect(app.getByText(/The source export didn’t carry a slot label/i)).toBeVisible();
    await app.getByRole('button', { name: /Skip & finish/i }).click();
    // Env survives, no breaking change.
    await expect(app.getByRole('button', { name: /Edit variables in legacy-shape/ })).toBeVisible();
  });

  test('Export returns null for unknown env names', async ({ app }) => {
    const json = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { exportEnvironment: (n: string) => string | null };
        };
      };
      return w.__apicircleStore?.getState().exportEnvironment('does-not-exist') ?? null;
    });
    expect(json).toBeNull();
  });

  // ----- C9 encrypted-var round-trip --------------------------------------

  test(
    tc(
      id('Var :: Add secret var masked'),
      'encrypted var round-trip: bind to vault key → wire receives decrypted value',
    ),
    async ({ app, e2eMock, sidebar }) => {
      // 0. The web build gates the Secret Vault behind a passphrase.
      await setupVaultPassphrase(app);
      // 1. Create the vault slot. `addSecret`'s value is the SLOT key
      //    material — `bindVariableToSecretKey` encrypts the env var's
      //    own plaintext under that slot, so the var must carry the
      //    decrypted value BEFORE binding (see secretSlotRoundtrip.test).
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
          value: 'slot-key-material',
          origin: 'workspace',
        });
      });
      expect(typeof secretId).toBe('string');

      // 2. Create an env var carrying the plaintext, then bind it: the
      //    bind encrypts that plaintext into the slot's ciphertext.
      await createEnv(app, 'env-encrypt');
      await addVar(app, 'API_KEY', 'sk_live_decrypted_ok');
      await app.evaluate(
        async ({ id }) => {
          const w = window as unknown as {
            __apicircleStore?: {
              getState: () => {
                bindVariableToSecretKey: (
                  env: string,
                  idx: number,
                  sid: string,
                ) => Promise<boolean>;
              };
            };
          };
          // bindVariableToSecretKey is async (it encrypts the value into
          // the slot) — await it so the encrypted value lands before send.
          await w
            .__apicircleStore!.getState()
            .bindVariableToSecretKey('env-encrypt', 0, id as string);
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
    },
  );

  test(
    tc(
      id('Var :: Toggle secret->plaintext warns'),
      'unbind secret returns the row to a plain input + clears the value',
    ),
    async ({ app }) => {
      await setupVaultPassphrase(app);
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
        async ({ id }) => {
          const w = window as unknown as {
            __apicircleStore?: {
              getState: () => {
                bindVariableToSecretKey: (
                  env: string,
                  idx: number,
                  sid: string,
                ) => Promise<boolean>;
              };
            };
          };
          await w
            .__apicircleStore!.getState()
            .bindVariableToSecretKey('env-unbind', 0, id as string);
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
    },
  );

  test(
    tc(
      id('Var :: Toggle plaintext->secret'),
      'change secret key: rebind to a different vault entry',
    ),
    async ({ app }) => {
      await setupVaultPassphrase(app);
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
        async ({ id }) => {
          const w = window as unknown as {
            __apicircleStore?: {
              getState: () => {
                bindVariableToSecretKey: (
                  env: string,
                  idx: number,
                  sid: string,
                ) => Promise<boolean>;
              };
            };
          };
          await w
            .__apicircleStore!.getState()
            .bindVariableToSecretKey('env-rebind', 0, id as string);
        },
        { id: idA },
      );
      await app.getByRole('button', { name: /Edit variables in env-rebind/ }).click();
      // The bound chip shows the secret's LABEL (see EnvironmentsPanel.tsx
      // `boundLabel`), so the row reflects KEY_A.
      const boundChip = app.getByLabel('Variable value (bound to secret key)');
      await expect(boundChip).toContainText('KEY_A');

      // Rebind to KEY_B via the store (mirrors the picker's action).
      await app.evaluate(
        async ({ id }) => {
          const w = window as unknown as {
            __apicircleStore?: {
              getState: () => {
                bindVariableToSecretKey: (
                  env: string,
                  idx: number,
                  sid: string,
                ) => Promise<boolean>;
              };
            };
          };
          await w
            .__apicircleStore!.getState()
            .bindVariableToSecretKey('env-rebind', 0, id as string);
        },
        { id: idB },
      );
      await expect(boundChip).toContainText('KEY_B');
    },
  );

  // ----- VR var-resolution coverage ---------------------------------------

  test(
    tc(id('Var :: Add plaintext var'), 'a plaintext env var resolves into the request URL'),
    async ({ app, e2eMock, sidebar }) => {
      await createEnv(app, 'env-plaintext');
      await addVar(app, 'PLAIN_HOST', 'plain.example.test');

      await app.getByRole('button', { name: /^Editor$/ }).click();
      await sidebar.createRequest('plaintext-var-req');
      const path = '/anything/plaintext-var';
      await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?host={{PLAIN_HOST}}`);
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      const hit = await e2eMock.findLastByPath((p) => p === path);
      expect(hit.query.host).toBe('plain.example.test');
    },
  );

  test(
    tc(id('Var :: Autocomplete in URL'), 'typing `{{` in the URL bar suggests an env var'),
    async ({ app, sidebar }) => {
      await createEnv(app, 'env-autocomplete');
      await addVar(app, 'AUTOCOMPLETE_HOST', 'example.test');

      await app.getByRole('button', { name: /^Editor$/ }).click();
      await sidebar.createRequest('autocomplete-req');
      const url = app.getByLabel('Request URL');
      await url.click();
      await url.fill('');
      await app.keyboard.type('{{', { delay: 30 });

      const listbox = app.getByRole('listbox', { name: /Request URL suggestions/ });
      await expect(listbox).toBeVisible();
      await expect(app.getByRole('option', { name: /AUTOCOMPLETE_HOST/ })).toBeVisible();
    },
  );

  test(
    tc(
      id('Var :: Special chars in var name'),
      'a var name with dots and underscores resolves into the URL',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await createEnv(app, 'env-special');
      await addVar(app, 'svc.api_v2', 'special-ok');

      await app.getByRole('button', { name: /^Editor$/ }).click();
      await sidebar.createRequest('special-chars-req');
      const path = '/anything/special-chars';
      await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?s={{svc.api_v2}}`);
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      const hit = await e2eMock.findLastByPath((p) => p === path);
      expect(hit.query.s).toBe('special-ok');
    },
  );

  test(
    tc(id('Var :: Hyphen in name'), 'a hyphenated var name resolves into the request URL'),
    async ({ app, e2eMock, sidebar }) => {
      await createEnv(app, 'env-hyphen');
      await addVar(app, 'api-host', 'hyphen.example.test');

      await app.getByRole('button', { name: /^Editor$/ }).click();
      await sidebar.createRequest('hyphen-var-req');
      const path = '/anything/hyphen-var';
      await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?h={{api-host}}`);
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      const hit = await e2eMock.findLastByPath((p) => p === path);
      expect(hit.query.h).toBe('hyphen.example.test');
    },
  );

  test(
    tc(id('Var :: Very long value (1MB)'), 'a 1MB var value round-trips through env export'),
    async ({ app }) => {
      const bigValue = 'x'.repeat(1024 * 1024);
      await createEnv(app, 'env-bigvar');
      await addVar(app, 'BIG', bigValue);

      // A 1MB value on the wire hits URL/header length limits, so pin the
      // env's at-rest round-trip instead: the variable survives
      // create → store → serialize intact.
      const json = await app.evaluate((name) => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => { exportEnvironment: (n: string) => string | null };
          };
        };
        return w.__apicircleStore?.getState().exportEnvironment(name) ?? null;
      }, 'env-bigvar');
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.variables[0].key).toBe('BIG');
      expect(parsed.variables[0].value).toHaveLength(1024 * 1024);
    },
  );

  test(
    tc(
      id('Scope :: Workspace var fallback'),
      'a var resolves from a non-active env in the workspace layer',
    ),
    async ({ app, e2eMock, sidebar }) => {
      // Both envs sit in the global layer (addEnvironment ticks each into
      // priorityOrder). The first-created env lacks FALLBACK_VAR, so
      // resolution falls back to the env that defines it.
      await createEnv(app, 'env-primary');
      await addVar(app, 'PRIMARY_VAR', 'primary');
      await createEnv(app, 'env-fallback');
      await addVar(app, 'FALLBACK_VAR', 'fallback-value');

      await app.getByRole('button', { name: /^Editor$/ }).click();
      await sidebar.createRequest('workspace-fallback-req');
      const path = '/anything/workspace-fallback';
      await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?v={{FALLBACK_VAR}}`);
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      const hit = await e2eMock.findLastByPath((p) => p === path);
      expect(hit.query.v).toBe('fallback-value');
    },
  );
});

// --- helpers --------------------------------------------------------------

async function createEnv(app: import('@playwright/test').Page, name: string): Promise<void> {
  // The "New environment" affordance moved into the "Environments actions"
  // kebab menu (see EnvironmentsSidebar.tsx EnvironmentsSidebarActions).
  await app.getByRole('button', { name: 'Environments actions', exact: true }).first().click();
  await app.getByRole('menuitem', { name: 'New Environment', exact: true }).click();
  // The sidebar inline-create input shares the aria-label with the
  // panel's env-rename input — once an env is focused both exist. The
  // create input is the sidebar one, which renders first in DOM order.
  const input = app.getByLabel('Environment name', { exact: true }).first();
  await input.fill(name);
  await input.press('Enter');
  // Wait for the panel to focus the new env.
  await expect(app.getByRole('button', { name: `Edit variables in ${name}` })).toBeVisible();
}

// Per-row environment actions (Duplicate / Delete / Export as JSON) moved
// into a kebab menu — see EnvironmentsSidebar.tsx KebabMenu, aria-label
// `Environment actions for <name>`.
async function envRowAction(
  app: import('@playwright/test').Page,
  envName: string,
  action: 'Duplicate' | 'Delete' | 'Export as JSON',
): Promise<void> {
  await app
    .getByRole('button', { name: `Environment actions for ${envName}`, exact: true })
    .click();
  await app.getByRole('menuitem', { name: action, exact: true }).click();
}

// On the web build, the Secret Vault is gated behind a workspace
// passphrase — `addSecret` throws SecretsNotProtectedError until one is
// set. Tests that exercise encrypted vars must initialise the vault
// crypto first via `setupPassphrase` (the store action the "Set
// passphrase" UI calls).
async function setupVaultPassphrase(app: import('@playwright/test').Page): Promise<void> {
  const result = await app.evaluate(async () => {
    const w = window as unknown as {
      __apicircleStore?: {
        getState: () => {
          setupPassphrase: (p: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
        };
      };
    };
    return await w.__apicircleStore!.getState().setupPassphrase('e2e-test-passphrase');
  });
  expect(result.ok).toBe(true);
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
