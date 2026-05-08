import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

// End-to-end coverage for the Part-A linked-content redesign:
//
//   • A.2a — sidebar renders linked workspaces as collapsible groups
//   • A.2b — modal supports name/method/url/body field overrides
//   • A.2c — env panel renders linked environments with edit/reset/hide/add
//   • A.3  — single-request Send walks the SOURCE folder chain for inherit
//   • A.4  — update preview classifies entries into 6 buckets and lets the
//            user pick mine/theirs per both-changed entry
//   • A.4  — discard-all-modifications affordance on LinkCard
//
// All flows seed the linked-workspace state via the e2e store bridge
// (`window.__apicircleStore`) so they don't require a real GitHub session.

const T0 = '2026-04-27T00:00:00.000Z';
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers':
    'x-oauth-scopes, x-accepted-oauth-scopes, x-ratelimit-remaining, x-ratelimit-reset',
};

interface SeedRequest {
  id: string;
  name: string;
  folderId: string | null;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  query: Array<{ key: string; value: string; enabled: boolean }>;
  body: { type: string; content: string };
  auth: { type: string; token?: string };
  contextVars: Array<{ key: string; value: string }>;
  extractions: never[];
  assertions: never[];
  createdAt: string;
  updatedAt: string;
}

interface SeedFolder {
  id: string;
  name: string;
  parentId: string | null;
  auth?: { type: string; token?: string };
}

interface SeedSnapshot {
  workspaceName: string;
  pulledAt: string;
  ref: string;
  collections: {
    tree: { id: string; type: 'root'; children: Array<{ kind: 'request' | 'folder'; id: string }> };
    requests: Record<string, SeedRequest>;
    folders: Record<string, SeedFolder>;
  };
  environments: {
    items: Record<
      string,
      {
        name: string;
        variables: Array<{ key: string; value: string; encrypted: boolean }>;
      }
    >;
    activeName: string | null;
    priorityOrder: string[];
  };
}

function makeRequest(id: string, partial: Partial<SeedRequest> = {}): SeedRequest {
  return {
    id,
    name: `Request ${id}`,
    folderId: null,
    method: 'GET',
    url: `https://api.source.test/${id}`,
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

function makeSnapshot(args: {
  requests: SeedRequest[];
  folders?: SeedFolder[];
  envVars?: Array<{ envName: string; key: string; value: string }>;
  ref?: string;
}): SeedSnapshot {
  const folders = (args.folders ?? []).reduce<Record<string, SeedFolder>>((acc, f) => {
    acc[f.id] = f;
    return acc;
  }, {});
  const requests = args.requests.reduce<Record<string, SeedRequest>>((acc, r) => {
    acc[r.id] = r;
    return acc;
  }, {});
  const tree: SeedSnapshot['collections']['tree'] = {
    id: 'r',
    type: 'root',
    children: [
      ...(args.folders ?? [])
        .filter((f) => f.parentId === null)
        .map((f) => ({ kind: 'folder' as const, id: f.id })),
      ...args.requests
        .filter((r) => r.folderId === null)
        .map((r) => ({ kind: 'request' as const, id: r.id })),
    ],
  };
  const envItems: SeedSnapshot['environments']['items'] = {};
  for (const v of args.envVars ?? []) {
    envItems[v.envName] = envItems[v.envName] ?? { name: v.envName, variables: [] };
    envItems[v.envName].variables.push({ key: v.key, value: v.value, encrypted: false });
  }
  return {
    workspaceName: 'Source workspace',
    pulledAt: T0,
    ref: args.ref ?? 'v1.0.0',
    collections: { tree, requests, folders },
    environments: {
      items: envItems,
      activeName: Object.keys(envItems)[0] ?? null,
      priorityOrder: Object.keys(envItems),
    },
  };
}

async function seedLink(
  app: Page,
  args: {
    snapshot: SeedSnapshot;
    pinnedVersion?: string | null;
    perLinkLedger?: { versions: Array<{ version: string }>; currentVersion: string | null };
    name?: string;
    linkId?: string;
  },
): Promise<void> {
  // Inflate the version stubs to fully-shaped ReleaseVersion entries so
  // the LinkedChangelogModal (and any other consumer that walks the
  // ledger) doesn't crash on undefined fields.
  const inflatedLedger = args.perLinkLedger
    ? {
        currentVersion: args.perLinkLedger.currentVersion,
        versions: args.perLinkLedger.versions.map((v) => ({
          version: v.version,
          publishedAt: T0,
          notes: '',
          workspaceSnapshot: 'a'.repeat(64),
          deprecated: false,
          yanked: false,
        })),
      }
    : { versions: [], currentVersion: null };

  await app.evaluate(
    ({ args, t0, ledger }) => {
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
      const linkId = args.linkId ?? 'link-1';
      store.setState({
        synced: {
          ...synced,
          linkedWorkspaces: {
            [linkId]: {
              id: linkId,
              kind: 'private',
              name: args.name ?? 'Source workspace',
              source: { provider: 'github', repoFullName: 'a/b', branch: 'main' },
              scope: ['collections', 'environments'],
              pinnedVersion: args.pinnedVersion ?? '1.0.0',
              updatePolicy: 'manual',
              linkedAt: t0,
              requiredSecretKeyIds: [],
            },
          },
          releases: {
            ...((synced as { releases: Record<string, unknown> }).releases ?? {
              self: null,
              perLink: {},
            }),
            perLink: {
              ...((synced as { releases: { perLink: Record<string, unknown> } }).releases.perLink ??
                {}),
              [linkId]: ledger,
            },
          },
        },
        local: {
          ...local,
          linkedCollections: {
            [linkId]: args.snapshot,
          },
          // Only stub a fake session when the real session-connect helper
          // hasn't been called yet. Tests that go through
          // `setupRealSession` already have a decryptable token in the
          // vault — keep it.
          sessions: (local as { sessions?: { github?: unknown } }).sessions?.github
            ? (local as { sessions: unknown }).sessions
            : {
                ...((local as { sessions?: unknown }).sessions ?? {}),
                github: {
                  accountLogin: 'tester',
                  tokenSecretId: 'sec-fake',
                  grantedScopes: ['repo'],
                  addedAt: t0,
                  lastVerifiedAt: t0,
                },
              },
        },
      });
    },
    { args, t0: T0, ledger: inflatedLedger },
  );
}

async function readSyncedSlice<T>(
  app: Page,
  selector: (s: { synced: Record<string, unknown> }) => T,
): Promise<T> {
  return app.evaluate((src) => {
    const w = window as unknown as {
      __apicircleStore?: { getState: () => { synced: Record<string, unknown> } };
    };
    const fn = new Function('s', `return (${src})(s);`) as (s: unknown) => T;
    return fn(w.__apicircleStore!.getState());
  }, selector.toString());
}

/**
 * Drive the real `connectGitHubSession` flow with a mocked /user endpoint
 * so the secret vault carries a decryptable token. Required for any test
 * that exercises a code path calling `decryptSessionToken` (refresh /
 * preview / push / send-on-private-link, etc).
 */
async function setupRealSession(app: Page): Promise<void> {
  await app.route('https://api.github.com/user', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders,
        'x-oauth-scopes': 'repo, pull_request',
      },
      body: JSON.stringify({ login: 'me', id: 1 }),
    });
  });
  await app.getByRole('button', { name: /Open Secret Vault/ }).click();
  await app.getByRole('button', { name: /Sessions/ }).click();
  await app.getByLabel('GitHub PAT').fill('tok');
  await app.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(app.getByText(/Connected as me/)).toBeVisible();
  await app.keyboard.press('Escape');
}

// ===========================================================================
// A.2a — Sidebar tree
// ===========================================================================

test.describe('A.2a — Editor sidebar linked-workspace tree', () => {
  test('linked workspace renders as a collapsible top-level group with pinned-version chip', async ({
    app,
  }) => {
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [makeRequest('src-1', { name: 'Get user' })] }),
      pinnedVersion: '1.0.0',
      name: 'Payments',
    });
    await app.getByRole('button', { name: /^Editor$/ }).click();

    // The whole "Linked workspaces" group renders as a sectionheader.
    await expect(app.getByText('Linked workspaces').first()).toBeVisible();
    // The link's row shows name + pinned-version chip.
    await expect(app.getByText('Payments').first()).toBeVisible();
    await expect(app.getByText('v1.0.0').first()).toBeVisible();
  });

  test('expanding the group reveals source requests; click opens the linked editor modal', async ({
    app,
  }) => {
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [makeRequest('src-1', { name: 'Get user' })] }),
      name: 'Payments',
    });
    await app.getByRole('button', { name: /^Editor$/ }).click();

    await app.getByRole('button', { name: /Expand linked workspace Payments/ }).click();
    const open = app.getByRole('button', { name: /Open Get user from Payments/ });
    await expect(open).toBeVisible();
    await open.click();

    await expect(app.getByRole('dialog', { name: /Linked request override/ })).toBeVisible();
  });

  test('a modified linked request shows the "modified" cue + override count badge', async ({
    app,
  }) => {
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [makeRequest('src-1', { name: 'Get user' })] }),
      name: 'Payments',
    });
    await app.getByRole('button', { name: /^Editor$/ }).click();

    // Open and modify the URL to register an override.
    await app.getByRole('button', { name: /Expand linked workspace Payments/ }).click();
    await app.getByRole('button', { name: /Open Get user from Payments/ }).click();
    await app.getByLabel('Override URL').fill('https://staging.source.test/users/1');
    await app.keyboard.press('Escape');

    // Re-expand and confirm the modified label + the X-mod badge on the root row.
    await expect(
      app.getByRole('button', { name: /Open Get user from Payments \(modified\)/ }),
    ).toBeVisible();
    await expect(app.getByText(/^1 mod$/)).toBeVisible();
  });
});

// ===========================================================================
// A.2c — Linked environments section
// ===========================================================================

test.describe('A.2c — Linked environments section', () => {
  test('renders source variables; per-row edit writes a per-variable override', async ({ app }) => {
    await seedLink(app, {
      snapshot: makeSnapshot({
        requests: [makeRequest('src-1')],
        envVars: [
          { envName: 'dev', key: 'BASE_URL', value: 'https://api.source.test' },
          { envName: 'dev', key: 'API_KEY', value: 'src-key' },
        ],
      }),
      name: 'Payments',
    });
    await app.getByRole('button', { name: /^Environments$/ }).click();
    await app.getByRole('button', { name: /Expand linked environments for Payments/ }).click();

    // Both source vars rendered.
    await expect(app.getByText('BASE_URL').first()).toBeVisible();
    await expect(app.getByText('API_KEY').first()).toBeVisible();

    // Edit BASE_URL.
    await app.getByLabel('Override value for BASE_URL').fill('https://my-fork.source.test');
    const stored = await readSyncedSlice(app, (s) => {
      const ov = (
        s.synced as {
          linkedOverrides: { environmentVars: Record<string, { value?: string }> };
        }
      ).linkedOverrides.environmentVars['link-1:dev:BASE_URL'];
      return ov?.value ?? null;
    });
    expect(stored).toBe('https://my-fork.source.test');
  });

  test('Hide soft-deletes a source variable; Restore brings it back', async ({ app }) => {
    await seedLink(app, {
      snapshot: makeSnapshot({
        requests: [makeRequest('src-1')],
        envVars: [{ envName: 'dev', key: 'OLD_VAR', value: 'old' }],
      }),
      name: 'Payments',
    });
    await app.getByRole('button', { name: /^Environments$/ }).click();
    await app.getByRole('button', { name: /Expand linked environments for Payments/ }).click();

    await app.getByRole('button', { name: /Hide OLD_VAR from this workspace/ }).click();
    await expect(app.getByText('hidden by you')).toBeVisible();

    await app.getByRole('button', { name: /Restore OLD_VAR from source/ }).click();
    // After restore the editable input is back.
    await expect(app.getByLabel('Override value for OLD_VAR')).toBeVisible();
  });

  test('Add row injects a consumer-only variable that doesn’t exist in source', async ({ app }) => {
    await seedLink(app, {
      snapshot: makeSnapshot({
        requests: [makeRequest('src-1')],
        envVars: [{ envName: 'dev', key: 'BASE_URL', value: 'src' }],
      }),
      name: 'Payments',
    });
    await app.getByRole('button', { name: /^Environments$/ }).click();
    await app.getByRole('button', { name: /Expand linked environments for Payments/ }).click();

    await app.getByRole('button', { name: /Add variable for this workspace/ }).click();
    await app.getByLabel('New consumer-only variable name').fill('LOCAL_FLAG');
    await app.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(app.getByText('LOCAL_FLAG')).toBeVisible();
    // Use exact match — the section header also contains the substring "added".
    await expect(app.getByText('added', { exact: true })).toBeVisible();
  });
});

// ===========================================================================
// A.3 — Send with source folder-auth inheritance
// ===========================================================================

test.describe('A.3 — Single-request Send for linked requests', () => {
  test('Send walks the source folder chain when request.auth = inherit', async ({ app }) => {
    // Source structure: folder F has bearer auth; request lives inside F
    // and inherits. Consumer has no folders — the resolver MUST use the
    // snapshot's folder chain.
    const folder: SeedFolder = {
      id: 'src-folder-1',
      name: 'Authed folder',
      parentId: null,
      auth: { type: 'bearer', token: 'src-bearer' },
    };
    const req = makeRequest('src-1', {
      folderId: 'src-folder-1',
      auth: { type: 'inherit' },
      url: 'https://api.source.test/protected',
    });
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [req], folders: [folder] }),
      name: 'Payments',
    });

    // Intercept the outbound request so we can assert the Authorization header.
    let capturedAuth: string | null = null;
    await app.route('https://api.source.test/protected', async (route) => {
      capturedAuth = route.request().headers().authorization ?? null;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ ok: true }),
      });
    });

    // Open the linked request from the sidebar tree, then Send. The source
    // request lives inside a folder, so we expand the folder first.
    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app.getByRole('button', { name: /Expand linked workspace Payments/ }).click();
    await app.getByRole('button', { name: /Expand Authed folder/ }).click();
    await app.getByRole('button', { name: /Open Request src-1 from Payments/ }).click();
    await app.getByRole('button', { name: 'Send linked request' }).click();
    // Wait until the modal reflects a successful run via its lastRun status line.
    await expect(app.getByText(/Last run:.*200/)).toBeVisible();

    expect(capturedAuth).toBe('Bearer src-bearer');
  });

  test('URL override is honored at Send time', async ({ app }) => {
    const req = makeRequest('src-1', { url: 'https://api.source.test/prod-only' });
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [req] }),
      name: 'Payments',
    });

    let capturedUrl: string | null = null;
    await app.route('https://staging.source.test/v2', async (route) => {
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ ok: true }),
      });
    });

    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app.getByRole('button', { name: /Expand linked workspace Payments/ }).click();
    await app.getByRole('button', { name: /Open Request src-1 from Payments/ }).click();
    await app.getByLabel('Override URL').fill('https://staging.source.test/v2');
    await app.getByRole('button', { name: 'Send linked request' }).click();
    await expect(app.getByText(/Last run:.*200/)).toBeVisible();

    expect(capturedUrl).toBe('https://staging.source.test/v2');
  });

  test('source env {{VAR}} resolves via the snapshot, with consumer override applied on top', async ({
    app,
  }) => {
    const req = makeRequest('src-1', { url: '{{BASE_URL}}/users/1' });
    await seedLink(app, {
      snapshot: makeSnapshot({
        requests: [req],
        envVars: [{ envName: 'dev', key: 'BASE_URL', value: 'https://from-source.test' }],
      }),
      name: 'Payments',
    });

    // Override the source env value via the linked envs section.
    await app.getByRole('button', { name: /^Environments$/ }).click();
    await app.getByRole('button', { name: /Expand linked environments for Payments/ }).click();
    await app.getByLabel('Override value for BASE_URL').fill('https://my-fork.test');

    let capturedUrl: string | null = null;
    await app.route('https://my-fork.test/users/1', async (route) => {
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', ...corsHeaders },
        body: JSON.stringify({}),
      });
    });

    await app.getByRole('button', { name: /^Editor$/ }).click();
    await app.getByRole('button', { name: /Expand linked workspace Payments/ }).click();
    await app.getByRole('button', { name: /Open Request src-1 from Payments/ }).click();
    await app.getByRole('button', { name: 'Send linked request' }).click();
    await expect(app.getByText(/Last run:.*200/)).toBeVisible();

    expect(capturedUrl).toBe('https://my-fork.test/users/1');
  });
});

// ===========================================================================
// A.4 — Update preview / 3-way merge resolution
// ===========================================================================

test.describe('A.4 — Update preview flow', () => {
  /** Set up the contents-fetch route to return the supplied target snapshot when "Review update" runs. */
  async function mockSourceFetch(
    app: Page,
    snapshot: {
      workspaceName: string;
      releases: { self: { currentVersion: string } | null };
    } & Record<string, unknown>,
  ): Promise<void> {
    const remoteJson = JSON.stringify(snapshot);
    const base64 = Buffer.from(remoteJson, 'utf-8').toString('base64');
    await app.route('https://api.github.com/repos/a/b/contents/workspace.json**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', ...corsHeaders },
        body: JSON.stringify({
          type: 'file',
          path: 'workspace.json',
          sha: 'remote-sha',
          size: remoteJson.length,
          content: base64,
          encoding: 'base64',
        }),
      });
    });
  }

  test('source-only entry classifies as fast-forward and applies cleanly', async ({ app }) => {
    await setupRealSession(app);
    // Base: r1 with old URL. Target: r1 with new URL. No override.
    const baseSnap = makeSnapshot({
      requests: [makeRequest('r1', { name: 'r1', url: 'https://old.test/r1' })],
    });
    await seedLink(app, {
      snapshot: baseSnap,
      pinnedVersion: '1.0.0',
      perLinkLedger: {
        versions: [{ version: '1.0.0' }, { version: '2.0.0' }],
        currentVersion: '2.0.0',
      },
    });

    // Target snapshot the source's workspace.json should produce.
    await mockSourceFetch(app, {
      workspaceName: 'Source workspace',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: {
          r1: makeRequest('r1', { name: 'r1', url: 'https://new.test/r1' }),
        },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: {
        self: { versions: [{ version: '2.0.0' }], currentVersion: '2.0.0' },
      },
    });

    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Review update.*v2\.0\.0/ }).click();

    const dialog = app.getByRole('dialog', { name: /Update Source workspace.*v1\.0\.0.*v2\.0\.0/ });
    await expect(dialog).toBeVisible();
    // Single source-only entry, no decision required.
    await expect(dialog.getByText(/source-only · 1/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply update' }).click();

    // After apply: pinnedVersion bumps and the modal closes.
    await expect(dialog).not.toBeVisible();
    const pinned = await readSyncedSlice(
      app,
      (s) =>
        (
          s.synced as {
            linkedWorkspaces: Record<string, { pinnedVersion: string | null }>;
          }
        ).linkedWorkspaces['link-1'].pinnedVersion,
    );
    expect(pinned).toBe('2.0.0');
  });

  test('both-changed entry requires a decision; "Accept source" drops the override', async ({
    app,
  }) => {
    await setupRealSession(app);
    // Base: r1 with old URL. Override: header X. Target: r1 with new URL.
    const baseReq = makeRequest('r1', { name: 'r1', url: 'https://old.test/r1' });
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [baseReq] }),
      pinnedVersion: '1.0.0',
      perLinkLedger: {
        versions: [{ version: '1.0.0' }, { version: '2.0.0' }],
        currentVersion: '2.0.0',
      },
    });
    // Add a request override.
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            setLinkedRequestOverride: (
              linkedWorkspaceId: string,
              itemId: string,
              patch: Record<string, unknown>,
            ) => void;
          };
        };
      };
      w.__apicircleStore?.getState().setLinkedRequestOverride('link-1', 'r1', {
        headers: [{ key: 'X', value: '1', enabled: true }],
      });
    });

    await mockSourceFetch(app, {
      workspaceName: 'Source workspace',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: {
          r1: makeRequest('r1', { name: 'r1', url: 'https://new.test/r1' }),
        },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: { self: { versions: [{ version: '2.0.0' }], currentVersion: '2.0.0' } },
    });

    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Review update.*v2\.0\.0/ }).click();
    const dialog = app.getByRole('dialog', { name: /Update Source workspace.*v2\.0\.0/ });
    await expect(dialog).toBeVisible();

    // Apply is disabled until the both-changed decision is made.
    const apply = dialog.getByRole('button', { name: 'Apply update' });
    await expect(apply).toBeDisabled();

    await dialog.getByRole('button', { name: 'Accept source' }).click();
    await expect(apply).toBeEnabled();
    await apply.click();

    // After apply: override dropped, pinnedVersion bumped.
    const stateAfter = await readSyncedSlice(app, (s) => {
      const synced = s.synced as {
        linkedWorkspaces: Record<string, { pinnedVersion: string | null }>;
        linkedOverrides: { requests: Record<string, unknown> };
      };
      return {
        pinned: synced.linkedWorkspaces['link-1'].pinnedVersion,
        hasOverride: Boolean(synced.linkedOverrides.requests['link-1:r1']),
      };
    });
    expect(stateAfter.pinned).toBe('2.0.0');
    expect(stateAfter.hasOverride).toBe(false);
  });

  test('both-changed with "Keep mine" preserves the override across the version bump', async ({
    app,
  }) => {
    await setupRealSession(app);
    const baseReq = makeRequest('r1', { name: 'r1', url: 'https://old.test/r1' });
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [baseReq] }),
      pinnedVersion: '1.0.0',
      perLinkLedger: {
        versions: [{ version: '1.0.0' }, { version: '2.0.0' }],
        currentVersion: '2.0.0',
      },
    });
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            setLinkedRequestOverride: (
              a: string,
              b: string,
              patch: Record<string, unknown>,
            ) => void;
          };
        };
      };
      w.__apicircleStore?.getState().setLinkedRequestOverride('link-1', 'r1', {
        url: 'https://my-fork.test/r1',
      });
    });

    await mockSourceFetch(app, {
      workspaceName: 'Source workspace',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: makeRequest('r1', { name: 'r1', url: 'https://new.test/r1' }) },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: { self: { versions: [{ version: '2.0.0' }], currentVersion: '2.0.0' } },
    });

    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Review update.*v2\.0\.0/ }).click();
    const dialog = app.getByRole('dialog', { name: /Update Source workspace.*v2\.0\.0/ });
    await dialog.getByRole('button', { name: 'Keep mine' }).click();
    await dialog.getByRole('button', { name: 'Apply update' }).click();

    const after = await readSyncedSlice(app, (s) => {
      const synced = s.synced as {
        linkedWorkspaces: Record<string, { pinnedVersion: string | null }>;
        linkedOverrides: { requests: Record<string, { patch: { url?: string } }> };
      };
      return {
        pinned: synced.linkedWorkspaces['link-1'].pinnedVersion,
        url: synced.linkedOverrides.requests['link-1:r1']?.patch.url,
      };
    });
    expect(after.pinned).toBe('2.0.0');
    expect(after.url).toBe('https://my-fork.test/r1');
  });

  test('byte-equal source produces an empty preview with the "nothing to apply" empty state', async ({
    app,
  }) => {
    await setupRealSession(app);
    const r = makeRequest('r1', { name: 'r1' });
    await seedLink(app, {
      snapshot: makeSnapshot({ requests: [r] }),
      pinnedVersion: '1.0.0',
      perLinkLedger: { versions: [{ version: '2.0.0' }], currentVersion: '2.0.0' },
    });
    // Target is byte-identical to base.
    await mockSourceFetch(app, {
      workspaceName: 'Source workspace',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: r },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: { self: { versions: [{ version: '2.0.0' }], currentVersion: '2.0.0' } },
    });

    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await app.getByRole('button', { name: /Review update.*v2\.0\.0/ }).click();
    const dialog = app.getByRole('dialog', { name: /Update Source workspace.*v2\.0\.0/ });
    await expect(dialog.getByText(/Nothing to apply/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply update' })).toBeDisabled();
  });
});

// ===========================================================================
// A.4 — Discard all modifications
// ===========================================================================

test.describe('A.4 — Discard all modifications', () => {
  test('"Discard N mods" drops every override for the link without changing pinned version', async ({
    app,
  }) => {
    const r = makeRequest('r1', { name: 'r1' });
    await seedLink(app, {
      snapshot: makeSnapshot({
        requests: [r],
        envVars: [{ envName: 'dev', key: 'BASE_URL', value: 'src' }],
      }),
      name: 'Payments',
    });

    // Add one request override and one env-var override.
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            setLinkedRequestOverride: (
              a: string,
              b: string,
              patch: Record<string, unknown>,
            ) => void;
            setLinkedEnvVarOverride: (
              a: string,
              env: string,
              key: string,
              patch: Record<string, unknown>,
            ) => void;
          };
        };
      };
      w.__apicircleStore?.getState().setLinkedRequestOverride('link-1', 'r1', {
        url: 'https://staging.test/r1',
      });
      w.__apicircleStore?.getState().setLinkedEnvVarOverride('link-1', 'dev', 'BASE_URL', {
        value: 'https://override.test',
      });
    });

    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    // The card shows "Discard 2 mods" — typed-confirm pattern via ConfirmDialog
    // (Discard all / Cancel pair; no typed-confirm string for this one).
    await app
      .getByRole('button', { name: /Discard all 2 local modifications for Payments/ })
      .click();
    await app.getByRole('button', { name: 'Discard all', exact: true }).click();

    const after = await readSyncedSlice(app, (s) => {
      const synced = s.synced as {
        linkedWorkspaces: Record<string, { pinnedVersion: string | null }>;
        linkedOverrides: {
          requests: Record<string, unknown>;
          environmentVars: Record<string, unknown>;
        };
      };
      return {
        pinned: synced.linkedWorkspaces['link-1'].pinnedVersion,
        reqs: Object.keys(synced.linkedOverrides.requests).length,
        envs: Object.keys(synced.linkedOverrides.environmentVars).length,
      };
    });
    expect(after.pinned).toBe('1.0.0');
    expect(after.reqs).toBe(0);
    expect(after.envs).toBe(0);
  });
});

// ===========================================================================
// A.5 — Push-to-Git round-trip:
// the byte-identical serialize/parse/serialize round-trip is covered at the
// unit-test level in `packages/core/src/git/serializeWorkspace.test.ts`. The
// Playwright surface here just confirms that overrides land on `synced` (not
// `local`), which is the precondition for the unit-tested round-trip to be
// what gets pushed.
// ===========================================================================

test.describe('A.5 — Overrides live on synced (precondition for push round-trip)', () => {
  test('every override path writes to synced.linkedOverrides, never to local.overrides', async ({
    app,
  }) => {
    const r = makeRequest('r1', { name: 'r1' });
    await seedLink(app, {
      snapshot: makeSnapshot({
        requests: [r],
        envVars: [{ envName: 'dev', key: 'BASE_URL', value: 'src' }],
      }),
      name: 'Payments',
    });
    await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            setLinkedRequestOverride: (
              a: string,
              b: string,
              patch: Record<string, unknown>,
            ) => void;
            setLinkedEnvVarOverride: (
              a: string,
              env: string,
              key: string,
              patch: Record<string, unknown>,
            ) => void;
          };
        };
      };
      w.__apicircleStore?.getState().setLinkedRequestOverride('link-1', 'r1', {
        method: 'POST',
        url: 'https://staging.test/r1',
      });
      w.__apicircleStore
        ?.getState()
        .setLinkedEnvVarOverride('link-1', 'dev', 'OLD_VAR', { removed: true });
    });

    const shape = await app.evaluate(() => {
      const w = window as unknown as {
        __apicircleStore?: {
          getState: () => {
            synced: {
              linkedOverrides: {
                requests: Record<string, unknown>;
                environmentVars: Record<string, unknown>;
              };
            };
            local: Record<string, unknown>;
          };
        };
      };
      const state = w.__apicircleStore!.getState();
      return {
        reqOverrideCount: Object.keys(state.synced.linkedOverrides.requests).length,
        envOverrideCount: Object.keys(state.synced.linkedOverrides.environmentVars).length,
        // Pre-A.1 there was a `local.overrides` field. Confirm it's gone.
        localHasLegacyOverrides: 'overrides' in state.local,
      };
    });
    expect(shape.reqOverrideCount).toBe(1);
    expect(shape.envOverrideCount).toBe(1);
    expect(shape.localHasLegacyOverrides).toBe(false);
  });
});
