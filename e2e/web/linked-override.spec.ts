import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module LV.
import { tcMapLV } from './fixtures/tcMapLV';
void Object.keys(tcMapLV);

function id(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}
// Linked-content overrides — covers the schema reshape (A.1) where
// overrides moved from `local.overrides.items` to
// `synced.linkedOverrides.requests` and the patch type expanded from 4
// fields (headers/contextVars/extractions/assertions) to every editable
// field (name/method/url/body + the originals).
//
// We seed a fake link directly via the e2e store bridge attached to
// `window.__apicircleStore`, then drive the linked-request editing that now
// lives inline in the main EditorPanel (the old LinkedRequestEditor modal was
// removed).

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
              source: {
                provider: 'github',
                repoFullName: 'a/b',
                branch: 'main',
                sessionMode: 'workspace',
              },
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
          // `sessions.github` is `{ workspace, links }` — see
          // WorkspaceLocal in @apicircle/shared.
          sessions: {
            ...((local as { sessions?: unknown }).sessions ?? {}),
            github: {
              workspace: {
                accountLogin: 'tester',
                tokenSecretId: 'sec-fake',
                grantedScopes: ['repo'],
                addedAt: t0,
                lastVerifiedAt: t0,
                canCreatePullRequests: true,
              },
              links: {},
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

// Linked-request editing now happens inline in the main EditorPanel (the
// old `LinkedRequestEditor` modal was removed — see App.tsx). The Editor
// sidebar renders linked workspaces as a collapsible tree group; clicking
// a request row sets `activeLinkedRequest` and the editor's unified
// selector resolves to the merged source+override view. Field edits route
// to `setLinkedRequestOverride` via the store's `routeLinkedField` helper.
async function openLinkedRequest(app: import('@playwright/test').Page): Promise<void> {
  await app.getByRole('button', { name: /^Editor$/ }).click();
  await app.getByRole('button', { name: /Expand linked workspace Source workspace/ }).click();
  await app.getByRole('button', { name: /Open Get user from Source workspace/ }).click();
}

test.describe('Linked-request override (A.1 — overrides moved to synced + full-field patch)', () => {
  test(
    tc(
      id('Linked release ledger refresh'),
      'Editor sidebar lists linked snapshot requests under a collapsible group',
    ),
    async ({ app }) => {
      await seedLink(app);
      await app.getByRole('button', { name: /^Editor$/ }).click();
      await expect(app.getByText('Linked workspaces').first()).toBeVisible();
      await app.getByRole('button', { name: /Expand linked workspace Source workspace/ }).click();
      await expect(
        app.getByRole('button', { name: /Open Get user from Source workspace/ }),
      ).toBeVisible();
    },
  );

  test(
    tc(
      id('Override per linked-version'),
      'opening a linked request shows the editor pre-filled from source + the Linked banner',
    ),
    async ({ app }) => {
      await seedLink(app);
      await openLinkedRequest(app);

      // The main editor renders Name / Method / URL pre-filled with the
      // source's values, plus a "Linked from" source banner.
      await expect(app.getByLabel('Request name')).toHaveValue('Get user');
      await expect(app.getByLabel('HTTP method')).toHaveValue('GET');
      await expect(app.getByLabel('Request URL')).toHaveValue('https://api.source.test/users/1');
      await expect(app.getByText(/Linked from/)).toBeVisible();
      await expect(app.getByText(/Source-clean/)).toBeVisible();
    },
  );

  test(
    tc(
      id('Compare diff between linked versions'),
      'editing the URL persists into synced.linkedOverrides.requests',
    ),
    async ({ app }) => {
      await seedLink(app);
      await openLinkedRequest(app);

      await app.getByLabel('Request URL').fill('https://staging.source.test/users/1');

      await expect
        .poll(async () => (await readRequestOverride(app))?.patch.url)
        .toBe('https://staging.source.test/users/1');
    },
  );

  test(
    tc(id('Link to latest version'), 'changing Method from GET to POST writes a method override'),
    async ({ app }) => {
      await seedLink(app);
      await openLinkedRequest(app);

      await app.getByLabel('HTTP method').selectOption('POST');

      await expect.poll(async () => (await readRequestOverride(app))?.patch.method).toBe('POST');
    },
  );

  test(
    tc(
      id('Multiple linked workspaces with conflicting var names'),
      'editing two fields persists both overrides on the patch',
    ),
    async ({ app }) => {
      await seedLink(app);
      await openLinkedRequest(app);

      await app.getByLabel('Request URL').fill('https://staging.source.test/x');
      await app.getByLabel('HTTP method').selectOption('PUT');

      await expect
        .poll(async () => (await readRequestOverride(app))?.patch.url)
        .toBe('https://staging.source.test/x');
      const stored = await readRequestOverride(app);
      expect(stored?.patch.method).toBe('PUT');
    },
  );

  test(
    tc(
      id('Source unpublished a version we pinned'),
      'per-field "Reset to source" clears that field only, leaving others intact',
    ),
    async ({ app }) => {
      await seedLink(app);
      await openLinkedRequest(app);

      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByLabel('Request URL').fill('https://staging.source.test/x');

      await expect
        .poll(async () => (await readRequestOverride(app))?.patch.url)
        .toBe('https://staging.source.test/x');
      let stored = await readRequestOverride(app);
      expect(stored?.patch.method).toBe('POST');

      // The Linked banner exposes a per-field reset chip for each
      // overridden field — "Reset url to source value".
      await app.getByRole('button', { name: 'Reset url to source value' }).click();

      await expect.poll(async () => (await readRequestOverride(app))?.patch.url).toBeUndefined();
      stored = await readRequestOverride(app);
      expect(stored?.patch.method).toBe('POST');
    },
  );

  test(
    tc(
      id('Update banner when source publishes new version'),
      'whole-override "Reset all to source" clears the entire override entry',
    ),
    async ({ app }) => {
      await seedLink(app);
      await openLinkedRequest(app);

      await app.getByLabel('Request URL').fill('https://staging.source.test/x');
      await app.getByLabel('HTTP method').selectOption('POST');

      await expect
        .poll(async () => (await readRequestOverride(app))?.patch.url)
        .toBe('https://staging.source.test/x');

      // The banner's "Reset all to source" clears the whole override entry.
      await app
        .getByRole('button', { name: 'Reset all local modifications for this linked request' })
        .click();

      await expect.poll(async () => await readRequestOverride(app)).toBeNull();
    },
  );

  test(
    tc(
      id('Unlink preserves local copies (optional)'),
      'the sidebar row shows the modified cue once an override exists',
    ),
    async ({ app }) => {
      await seedLink(app);
      await openLinkedRequest(app);
      await app.getByLabel('Request URL').fill('https://staging.x');

      await expect
        .poll(async () => (await readRequestOverride(app))?.patch.url)
        .toBe('https://staging.x');
      // The linked-tree row exposes a "(modified)" suffix + a cue dot.
      await expect(
        app.getByRole('button', { name: /Open Get user from Source workspace \(modified\)/ }),
      ).toBeVisible();
    },
  );
});
