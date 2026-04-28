import { expect, test } from './fixtures/app';

// P20 — Linked-request overrides. The "browse" surface lives on each
// LinkCard in the Link Workspace panel. Drives the modal: read-only base
// fields, override headers + ctx vars + extractions + assertions, reset.
//
// Real link/refresh flow needs a GitHub session — we seed a snapshot
// directly via the e2e store bridge attached to window.__apicircleStore.

interface SeedRequest {
  id: string;
  name: string;
  folderId: null;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  query: Array<{ key: string; value: string; enabled: boolean }>;
  body: { type: 'none'; content: '' };
  auth: { type: 'none' };
  contextVars: Array<{ key: string; value: string }>;
  extractions: never[];
  assertions: never[];
  createdAt: string;
  updatedAt: string;
}

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
  createdAt: '2026-04-27T00:00:00.000Z',
  updatedAt: '2026-04-27T00:00:00.000Z',
};

async function seedLink(
  app: import('@playwright/test').Page,
  source: SeedRequest = SOURCE_REQUEST,
): Promise<void> {
  await app.evaluate(
    ({ src }) => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            synced: unknown;
            local: unknown;
          };
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
              pinnedVersion: null,
              updatePolicy: 'manual',
              linkedAt: 't',
              requiredSecretKeyIds: [],
            },
          },
        },
        local: {
          ...local,
          linkedCollections: {
            'link-1': {
              workspaceName: 'Source',
              pulledAt: 't',
              ref: 'main',
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
              addedAt: 't',
              lastVerifiedAt: 't',
            },
          },
        },
      });
    },
    { src: source },
  );
}

test.describe('Linked-request override (P20)', () => {
  test('Browse requests expander lists linked snapshot requests', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    const browse = app.getByRole('button', { name: /Browse requests \(1\)/ });
    await expect(browse).toBeVisible();
    await browse.click();
    await expect(app.getByRole('button', { name: /GET\s+Get user/ })).toBeVisible();
  });

  test('clicking a linked request opens the override modal with read-only source fields', async ({
    app,
  }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    const dialog = app.getByRole('dialog', { name: /Linked request override/ });
    await expect(dialog).toBeVisible();
    // Read-only metadata: method, URL, body type, auth type. The method
    // is rendered inside a <code> — match exactly so we disambiguate from
    // the source-request pill that also contains "GET".
    await expect(dialog.getByText('GET', { exact: true })).toBeVisible();
    await expect(dialog.getByText('https://api.source.test/users/1')).toBeVisible();
  });

  test('typing into Override headers persists into the local override patch', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();

    const valueInput = app.getByLabel('Override header value 1');
    await valueInput.fill('overridden-value');

    const patch = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            local: {
              overrides: {
                items: Record<string, { patch: { headers: Array<{ value: string }> } }>;
              };
            };
          };
        };
      };
      return w.__apicircleStore?.getState().local.overrides.items['link-1:src-1']?.patch;
    });
    expect(patch?.headers?.[0]?.value).toBe('overridden-value');
  });

  test('Browse expander shows the override badge when an override exists', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();
    await app.getByLabel('Override header value 1').fill('x');

    // Close + re-open the expander; the badge should now be visible.
    await app.keyboard.press('Escape');
    await expect(app.getByText('override').first()).toBeVisible();
  });

  test('Reset to source clears the override after confirmation', async ({ app }) => {
    await seedLink(app);
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Browse requests \(1\)/ }).click();
    await app.getByRole('button', { name: /GET\s+Get user/ }).click();
    await app.getByLabel('Override header value 1').fill('temp');

    await app.getByRole('button', { name: 'Reset to source' }).click();
    await app.getByRole('button', { name: 'Reset', exact: true }).click();

    const exists = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => { local: { overrides: { items: Record<string, unknown> } } };
        };
      };
      return Boolean(w.__apicircleStore?.getState().local.overrides.items['link-1:src-1']);
    });
    expect(exists).toBe(false);
  });
});
