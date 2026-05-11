import { expect, test } from './fixtures/app';

// Linked-content overrides — covers the schema reshape (A.1) where
// overrides moved from `local.overrides.items` to
// `synced.linkedOverrides.requests` and the patch type expanded from 4
// fields (headers/contextVars/extractions/assertions) to every editable
// field (name/method/url/body + the originals).
//
// We seed a fake link directly via the e2e store bridge attached to
// `window.__apicircleStore`, then drive the LinkedRequestEditor modal.

interface SeedRequest {
  id: string;
  name: string;
  folderId: string | null;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  query: Array<{ key: string; value: string; enabled: boolean }>;
  body: { type: 'none' | 'json'; content: string };
  auth: { type: 'none' | 'inherit' | 'bearer'; token?: string };
  contextVars: Array<{ key: string; value: string }>;
  extractions: never[];
  assertions: never[];
  createdAt: string;
  updatedAt: string;
}

const T0 = '2026-04-27T00:00:00.000Z';

const SOURCE_REQUEST: SeedRequest = {
  id: 'src-1',
  name: 'Get user',
  folderId: null,
  method: 'GET',
  url: 'https://api.source.test/users/1',
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  query: [],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
  contextVars: [],
  extractions: [],
  assertions: [],
  createdAt: T0,
  updatedAt: T0,
};

async function seedLink(
  app: import('@playwright/test').Page,
  source: SeedRequest = SOURCE_REQUEST,
): Promise<void> {
  await app.evaluate(
    ({ src, t0 }) => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { synced: unknown; local: unknown };
          setState: (partial: unknown) => void;
        };
      };
      const store = w.__apicircleStore;
      if (!store) throw new Error('Store bridge missing');
      const state = store.getState();
      const synced = state.synced as Record<string, unknown>;
      const local = state.local as Record<string, unknown>;
      store.setState({
        synced: {
          ...synced,
          linkedWorkspaces: {
            'link-1': {
              id: 'link-1',
              kind: 'private',
              name: 'Source workspace',
              source: { provider: 'github', repoFullName: 'a/b', branch: 'main' },
              scope: ['collections'],
              pinnedVersion: '1.0.0',
              updatePolicy: 'manual',
              linkedAt: t0,
              requiredSecretKeyIds: [],
            },
          },
        },
        local: {
          ...local,
          linkedCollections: {
            'link-1': {
              workspaceName: 'Source',
              pulledAt: t0,
              ref: 'v1.0.0',
              collections: {
                tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: src.id }] },
                requests: { [src.id]: src },
                folders: {},
              },
              environments: { items: {}, activeName: null, priorityOrder: [] },
            },
          },
          sessions: {
            ...((local as { sessions?: unknown }).sessions ?? {}),
            github: {
              accountLogin: 'tester',
              tokenSecretId: 'sec-fake',
              grantedScopes: ['repo'],
              addedAt: t0,
              lastVerifiedAt: t0,
              canCreatePullRequests: true,
            },
          },
        },
      });
    },
    { src: source, t0: T0 },
  );
}

async function readRequestOverride(
  app: import('@playwright/test').Page,
): Promise<{ patch: Record<string, unknown> } | null> {
  return app.evaluate(() => {
    const w = window as unknown as {
      __apicircleStore?: {
        getState: () => {
          synced: {
            linkedOverrides: {
              requests: Record<string, { patch: Record<string, unknown> }>;
            };
          };
        };
      };
    };
    const got = w.__apicircleStore?.getState().synced.linkedOverrides.requests['link-1:src-1'];
    return got ?? null;
  });
}

test.describe('Linked-request override (A.1 — overrides moved to synced + full-field patch)', () => {
  test('Browse requests expander lists linked snapshot requests', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    const browse = app.getByRole('button', { name: /Browse requests \(1\)/ });
    await expect(browse).toBeVisible();
    await browse.click();
    await expect(app.getByRole('button', { name: /GET\s+Get user/ })).toBeVisible();
  });

  test('clicking a linked request opens the override modal with editable inputs pre-filled from source', async ({
    app,
  }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    const dialog = app.getByRole('dialog', { name: /Linked request override/ });
    await expect(dialog).toBeVisible();
    // The new modal renders Name / Method / URL / Body / Headers as
    // editable fields pre-filled with the source's values.
    await expect(dialog.getByLabel('Override name')).toHaveValue('Get user');
    await expect(dialog.getByLabel('Override method')).toHaveValue('GET');
    await expect(dialog.getByLabel('Override URL')).toHaveValue('https://api.source.test/users/1');
  });

  test('typing into Override URL persists into synced.linkedOverrides.requests', async ({
    app,
  }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    const url = app.getByLabel('Override URL');
    await url.fill('https://staging.source.test/users/1');

    await expect
      .poll(async () => (await readRequestOverride(app))?.patch.url)
      .toBe('https://staging.source.test/users/1');
  });

  test('changing Method from GET to POST writes a method override', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    await app.getByLabel('Override method').selectOption('POST');

    await expect.poll(async () => (await readRequestOverride(app))?.patch.method).toBe('POST');
  });

  test('typing into Override headers persists alongside other field overrides', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    await app.getByLabel('Override URL').fill('https://staging.source.test/x');
    await app.getByLabel('Override header value 1').fill('overridden-value');

    const stored = await readRequestOverride(app);
    expect(stored?.patch.url).toBe('https://staging.source.test/x');
    expect((stored?.patch.headers as Array<{ value: string }>)[0]?.value).toBe('overridden-value');
  });

  test('per-field "Reset to source" clears that field only, leaving others intact', async ({
    app,
  }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    await app.getByLabel('Override name').fill('Renamed locally');
    await app.getByLabel('Override URL').fill('https://staging.source.test/x');

    let stored = await readRequestOverride(app);
    expect(stored?.patch.name).toBe('Renamed locally');
    expect(stored?.patch.url).toBe('https://staging.source.test/x');

    // Click the per-field reset for URL specifically. Each modified
    // field exposes its own "Reset to source" button next to the
    // section heading.
    const urlReset = app.getByRole('button', { name: 'Reset this field to source' }).nth(1);
    await urlReset.click();

    stored = await readRequestOverride(app);
    expect(stored?.patch.url).toBeUndefined();
    expect(stored?.patch.name).toBe('Renamed locally');
  });

  test('whole-override Reset to source clears the entire override entry', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    await app.getByLabel('Override URL').fill('https://staging.source.test/x');
    await app.getByLabel('Override header value 1').fill('hh');

    // The whole-override "Reset to source" button only appears when an
    // override exists. It opens a confirm dialog (typed-confirm not
    // required for this one — just a regular Reset / Cancel pair).
    await app.getByRole('button', { name: 'Reset to source' }).click();
    await app.getByRole('button', { name: 'Reset', exact: true }).click();

    const stored = await readRequestOverride(app);
    expect(stored).toBeNull();
  });

  test('Browse expander shows the override badge when an override exists', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();
    await app.getByLabel('Override URL').fill('https://staging.x');

    await app.keyboard.press('Escape');
    // The LinkedRequestsList renders an `override` chip on the row.
    await expect(app.getByText('override').first()).toBeVisible();
  });
});
