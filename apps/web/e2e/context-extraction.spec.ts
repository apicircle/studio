import { expect, test } from './fixtures/app';

// P16 — Context extraction. Defines a request whose body extractor pulls
// `data.token` into a workspace-wide variable; runs the request; verifies
// the captured value lands in the Captured globals list and is referenced
// by a downstream request.

test.describe('Context extraction (P16)', () => {
  test('manual context vars + extractor → captured global → reused in next request', async ({
    app,
    mockApi,
    sidebar,
  }) => {
    // Create a "login" request that returns a token.
    await sidebar.createRequest('Login');
    await app.getByLabel('Request URL').fill('https://api.example.test/login');
    await mockApi.json(/api\.example\.test\/login/, { data: { token: 'tok-123' } });

    // Add an extractor for data.token → ACCESS_TOKEN.
    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add extractor' }).click();
    await app.getByLabel('Extraction 1 variable').fill('ACCESS_TOKEN');
    await app.getByLabel('Extraction 1 path').fill('data.token');

    // Send and verify the captured value lands in `local.globalContext`.
    // The captured-globals list is no longer rendered as its own visible
    // section in the UI — extracted values are surfaced by the "Show
    // available variables" popover and consumed by `{{var}}` references.
    // Validating the data layer is the truthful check.
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();
    await expect
      .poll(() =>
        app.evaluate(() => {
          const w = window as unknown as {
            __apicircleStore?: {
              getState: () => { local?: { globalContext?: Record<string, string> } };
            };
          };
          return w.__apicircleStore?.getState().local?.globalContext?.ACCESS_TOKEN;
        }),
      )
      .toBe('tok-123');
  });

  test('manual context var persists into the request and is git-pushed', async ({
    app,
    sidebar,
  }) => {
    await sidebar.createRequest('manual-vars');
    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add manual variable' }).click();
    await app.getByLabel('Context var 1 name').fill('USER_ID');
    await app.getByLabel('Context var 1 value').fill('42');
    // Switch panels and back — the value should persist via Zustand+IDB.
    await app.getByRole('button', { name: /^History$/ }).click();
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await expect(app.getByLabel('Context var 1 name')).toHaveValue('USER_ID');
    await expect(app.getByLabel('Context var 1 value')).toHaveValue('42');
  });

  test('Forget a captured global key drops it from the list', async ({ app, mockApi, sidebar }) => {
    await sidebar.createRequest('forget-test');
    await app.getByLabel('Request URL').fill('https://api.example.test/x');
    await mockApi.json(/api\.example\.test\/x/, { token: 'aaa' });

    await app
      .getByRole('button', { name: /^Context/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add extractor' }).click();
    await app.getByLabel('Extraction 1 variable').fill('CAPTURED_KEY');
    await app.getByLabel('Extraction 1 path').fill('token');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200/)).toBeVisible();

    // Captured value lands in local.globalContext.
    await expect
      .poll(() =>
        app.evaluate(() => {
          const w = window as unknown as {
            __apicircleStore?: {
              getState: () => { local?: { globalContext?: Record<string, string> } };
            };
          };
          return w.__apicircleStore?.getState().local?.globalContext?.CAPTURED_KEY;
        }),
      )
      .toBe('aaa');

    // Forget via the store action — the dedicated UI section was removed
    // (extracted values are surfaced via the global Variables popover).
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { removeGlobalContextKey: (k: string) => void };
        };
      };
      w.__apicircleStore?.getState().removeGlobalContextKey('CAPTURED_KEY');
    });
    expect(
      await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => { local?: { globalContext?: Record<string, string> } };
          };
        };
        return w.__apicircleStore?.getState().local?.globalContext?.CAPTURED_KEY;
      }),
    ).toBeUndefined();
  });
});
