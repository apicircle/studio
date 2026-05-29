import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    return fakeResponse(queue[i++]);
  });
}

function fileContents(json: string, sha = 'remote-sha'): ResponseSpec {
  const content = btoa(unescape(encodeURIComponent(json)));
  return {
    body: {
      type: 'file',
      path: 'workspace.json',
      sha,
      size: json.length,
      content,
      encoding: 'base64',
    },
  };
}

async function setupSession(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  vi.unstubAllGlobals();
}

describe('workspaceStore.linkPrivateWorkspace', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when no GitHub session is active', async () => {
    await expect(
      useWorkspaceStore.getState().linkPrivateWorkspace({
        repoFullName: 'me/api',
        branch: 'main',
      }),
    ).rejects.toThrow(/No GitHub session/);
  });

  it('rejects malformed repo full names', async () => {
    await setupSession();
    await expect(
      useWorkspaceStore
        .getState()
        .linkPrivateWorkspace({ repoFullName: 'just-a-name', branch: 'main' }),
    ).rejects.toThrow(/owner\/name/);
  });

  it('caches the source collections + environments into local.linkedCollections', async () => {
    await setupSession();
    const remoteJson = JSON.stringify({
      workspaceName: 'API',
      collections: {
        tree: { id: 'r', type: 'root', children: ['req-1'] },
        requests: {
          'req-1': {
            id: 'req-1',
            name: 'Greet',
            folderId: null,
            method: 'GET',
            url: 'https://example.test/hello',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            contextVars: [],
            assertions: [],
            createdAt: 't',
            updatedAt: 't',
          },
        },
        folders: {},
      },
      environments: {
        items: {
          dev: {
            name: 'dev',
            variables: [{ key: 'BASE_URL', value: 'https://dev', encrypted: false }],
          },
        },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
      releases: { self: { versions: [], currentVersion: null } },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));

    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });

    const snapshot = useWorkspaceStore.getState().local!.linkedCollections[link.id];
    expect(snapshot).toBeDefined();
    expect(snapshot.collections.requests['req-1'].name).toBe('Greet');
    expect(snapshot.environments.activeName).toBe('dev');
    expect(snapshot.ref).toMatch(/^HEAD@main$|^v/);
  });

  it('persists a LinkedWorkspace and caches the source ledger', async () => {
    await setupSession();
    const remoteJson = JSON.stringify({
      workspaceName: 'Payments API',
      releases: {
        self: {
          versions: [
            {
              version: '1.0.0',
              publishedAt: 't',
              notes: 'first',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '1.0.0',
        },
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));

    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'org/payments-api',
      branch: 'main',
    });

    expect(link.kind).toBe('private');
    // Names live on each consumer's local registry — the link defaults to
    // the repo path as its initial display label.
    expect(link.name).toBe('org/payments-api');
    expect(link.source).toEqual({
      provider: 'github',
      repoFullName: 'org/payments-api',
      branch: 'main',
      sessionMode: 'workspace',
    });
    expect(link.pinnedVersion).toBe('1.0.0');

    const synced = useWorkspaceStore.getState().synced!;
    expect(synced.linkedWorkspaces[link.id]).toEqual(link);
    expect(synced.releases.perLink[link.id].currentVersion).toBe('1.0.0');
    expect(synced.releases.perLink[link.id].versions).toHaveLength(1);
  });

  it('defaults to branch=main and pinnedVersion=null when source has no releases', async () => {
    await setupSession();
    const remoteJson = JSON.stringify({ workspaceName: 'Empty', releases: { self: null } });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));

    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/empty', branch: '' });
    expect(link.source.branch).toBe('main');
    expect(link.pinnedVersion).toBeNull();
  });

  it('throws when the remote workspace.json is missing', async () => {
    await setupSession();
    vi.stubGlobal('fetch', queuedFetch([{ body: { message: 'Not Found' }, status: 404 }]));
    await expect(
      useWorkspaceStore
        .getState()
        .linkPrivateWorkspace({ repoFullName: 'me/missing', branch: 'main' }),
    ).rejects.toThrow(/not found/);
  });

  it('rejects remote files that are not valid JSON', async () => {
    await setupSession();
    vi.stubGlobal('fetch', queuedFetch([fileContents('not-json')]));
    await expect(
      useWorkspaceStore.getState().linkPrivateWorkspace({ repoFullName: 'me/bad', branch: 'main' }),
    ).rejects.toThrow(/not valid JSON/);

    vi.stubGlobal('fetch', queuedFetch([fileContents('42')]));
    await expect(
      useWorkspaceStore
        .getState()
        .linkPrivateWorkspace({ repoFullName: 'me/bad2', branch: 'main' }),
    ).rejects.toThrow(/not an object/);
  });

  it('auto-populates requiredSecretKeyIds from every slot in the source secretKeys registry', async () => {
    await setupSession();
    const remoteJson = JSON.stringify({
      workspaceName: 'Source',
      // The previous filter that only included slots referenced by an
      // encrypted env var made declared slots silently invisible when
      // the binding was stale or never written. The new behavior: every
      // slot the source declares is seeded onto the link.
      secretKeys: {
        DB_TOKEN: {
          id: 'DB_TOKEN',
          label: 'Database token',
          createdAt: 't',
          salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        },
        ANOTHER_SLOT: {
          id: 'ANOTHER_SLOT',
          label: 'Another slot',
          createdAt: 't',
          salt: 'BBBBBBBBBBBBBBBBBBBBBB==',
        },
      },
      environments: {
        items: {
          dev: {
            name: 'dev',
            variables: [
              { key: 'DB_PASSWORD', value: 'enc:v1:...', encrypted: true, secretKeyId: 'DB_TOKEN' },
              { key: 'BASE_URL', value: 'https://dev', encrypted: false },
            ],
          },
        },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/src', branch: 'main' });
    expect(link.requiredSecretKeyIds.sort()).toEqual(['ANOTHER_SLOT', 'DB_TOKEN']);
  });

  it('provisions any secretValues supplied by the wizard after the link lands', async () => {
    await setupSession();
    const remoteJson = JSON.stringify({
      workspaceName: 'Source',
      secretKeys: {
        DB_TOKEN: {
          id: 'DB_TOKEN',
          label: 'Database token',
          createdAt: 't',
          salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        },
      },
      environments: {
        items: {
          dev: {
            name: 'dev',
            variables: [
              { key: 'DB_PASSWORD', value: 'enc:v1:...', encrypted: true, secretKeyId: 'DB_TOKEN' },
            ],
          },
        },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'me/src',
      branch: 'main',
      secretValues: { DB_TOKEN: 's3cret!', UNUSED: '   ' /* trimmed empty → skipped */ },
    });
    // The DB_TOKEN slot should now have a provisioned entry in
    // secretIndex bound to this link, marking it `set` on the link card.
    const local = useWorkspaceStore.getState().local!;
    const provisioned = Object.values(local.secretIndex.entries).find(
      (e) =>
        e.origin === 'linked' && e.linkedWorkspaceId === link.id && e.linkedKeyId === 'DB_TOKEN',
    );
    expect(provisioned).toBeDefined();
    // The UNUSED entry was empty/whitespace so nothing was provisioned for it.
    const unused = Object.values(local.secretIndex.entries).find(
      (e) => e.origin === 'linked' && e.linkedWorkspaceId === link.id && e.linkedKeyId === 'UNUSED',
    );
    expect(unused).toBeUndefined();
  });
});

describe('workspaceStore.linkPublicWorkspace', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links a public workspace anonymously when no GitHub session is active', async () => {
    const remoteJson = JSON.stringify({
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: { self: null },
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      return fakeResponse(fileContents(remoteJson));
    });
    vi.stubGlobal('fetch', fetchMock);

    const link = await useWorkspaceStore.getState().linkPublicWorkspace({
      repoFullName: 'open/source',
      branch: 'main',
    });

    expect(link.kind).toBe('public');
    expect(link.source.repoFullName).toBe('open/source');
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[link.id]).toEqual(link);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes a public workspace anonymously after the workspace session is absent', async () => {
    const initial = JSON.stringify({
      releases: { self: { versions: [], currentVersion: null } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(fileContents(initial))),
    );
    const link = await useWorkspaceStore.getState().linkPublicWorkspace({
      repoFullName: 'open/source',
      branch: 'main',
    });

    const updated = JSON.stringify({
      releases: {
        self: {
          versions: [
            {
              version: '1.0.0',
              publishedAt: 't',
              notes: 'public',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '1.0.0',
        },
      },
    });
    const refreshFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      return fakeResponse(fileContents(updated));
    });
    vi.stubGlobal('fetch', refreshFetch);

    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);

    expect(useWorkspaceStore.getState().synced!.releases.perLink[link.id].currentVersion).toBe(
      '1.0.0',
    );
    expect(refreshFetch).toHaveBeenCalledTimes(1);
  });
});

describe('workspaceStore.refreshLinkedWorkspace + unlinkWorkspace', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refresh re-fetches and updates the cached ledger', async () => {
    await setupSession();
    const initial = JSON.stringify({
      workspaceName: 'API',
      releases: {
        self: {
          versions: [
            {
              version: '0.1.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '0.1.0',
        },
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(initial)]));
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });

    const updated = JSON.stringify({
      workspaceName: 'API',
      releases: {
        self: {
          versions: [
            {
              version: '0.1.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
            {
              version: '0.2.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'b'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '0.2.0',
        },
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(updated)]));
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);
    const ledger = useWorkspaceStore.getState().synced!.releases.perLink[link.id];
    expect(ledger.currentVersion).toBe('0.2.0');
    expect(ledger.versions).toHaveLength(2);
  });

  it('unlink also clears the cached collections snapshot', async () => {
    await setupSession();
    const remoteJson = JSON.stringify({
      workspaceName: 'X',
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      releases: { self: null },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/x', branch: 'main' });
    expect(useWorkspaceStore.getState().local!.linkedCollections[link.id]).toBeDefined();

    useWorkspaceStore.getState().unlinkWorkspace(link.id);
    expect(useWorkspaceStore.getState().local!.linkedCollections[link.id]).toBeUndefined();
  });

  it('unlink removes the link entry and its cached ledger', async () => {
    await setupSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([fileContents(JSON.stringify({ workspaceName: 'X', releases: { self: null } }))]),
    );
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/x', branch: 'main' });

    useWorkspaceStore.getState().unlinkWorkspace(link.id);
    const synced = useWorkspaceStore.getState().synced!;
    expect(synced.linkedWorkspaces[link.id]).toBeUndefined();
    expect(synced.releases.perLink[link.id]).toBeUndefined();
  });

  it('refresh throws when the link id is unknown', async () => {
    await setupSession();
    await expect(
      useWorkspaceStore.getState().refreshLinkedWorkspace('non-existent'),
    ).rejects.toThrow(/not found/);
  });
});

describe('workspaceStore required secret keys', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function linkOnce(): Promise<string> {
    await setupSession();
    const remoteJson = JSON.stringify({ workspaceName: 'API', releases: { self: null } });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });
    return link.id;
  }

  it('addLinkedRequiredKey appends + dedupes, rejects empty', async () => {
    const id = await linkOnce();
    useWorkspaceStore.getState().addLinkedRequiredKey(id, 'API_KEY');
    useWorkspaceStore.getState().addLinkedRequiredKey(id, 'API_KEY');
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[id].requiredSecretKeyIds).toEqual([
      'API_KEY',
    ]);
    expect(() => useWorkspaceStore.getState().addLinkedRequiredKey(id, '   ')).toThrow(
      /cannot be empty/,
    );
  });

  it('provisionLinkedSecret tags vault entry as origin=linked and rotates on re-provision', async () => {
    const id = await linkOnce();
    useWorkspaceStore.getState().addLinkedRequiredKey(id, 'API_KEY');
    const sid = await useWorkspaceStore.getState().provisionLinkedSecret(id, 'API_KEY', 'secret-1');
    const entry = useWorkspaceStore.getState().local!.secretIndex.entries[sid];
    expect(entry.origin).toBe('linked');
    expect(entry.linkedWorkspaceId).toBe(id);
    expect(entry.linkedKeyId).toBe('API_KEY');

    // Re-provisioning the same (link, key) re-uses the same id (rotates value).
    const again = await useWorkspaceStore
      .getState()
      .provisionLinkedSecret(id, 'API_KEY', 'secret-2');
    expect(again).toBe(sid);
    const decrypted = await useWorkspaceStore.getState().decryptSecret(sid);
    expect(decrypted).toBe('secret-2');
  });

  it('removeLinkedRequiredKey drops the key list entry AND the provisioned secret', async () => {
    const id = await linkOnce();
    useWorkspaceStore.getState().addLinkedRequiredKey(id, 'API_KEY');
    const sid = await useWorkspaceStore.getState().provisionLinkedSecret(id, 'API_KEY', 'v');
    await useWorkspaceStore.getState().removeLinkedRequiredKey(id, 'API_KEY');
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[id].requiredSecretKeyIds).toEqual(
      [],
    );
    expect(useWorkspaceStore.getState().local!.secretIndex.entries[sid]).toBeUndefined();
  });
});

describe('workspaceStore marketplace flow', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('searchMarketplace forwards the query and returns normalized repos', async () => {
    await setupSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        {
          body: {
            items: [
              {
                full_name: 'org/payments-api',
                name: 'payments-api',
                owner: { login: 'org' },
                description: 'desc',
                topics: ['apicircle-marketplace'],
                stargazers_count: 5,
                default_branch: 'main',
              },
            ],
          },
        },
      ]),
    );
    const results = await useWorkspaceStore.getState().searchMarketplace('payments');
    expect(results).toHaveLength(1);
    expect(results[0].fullName).toBe('org/payments-api');
    expect(results[0].topics).toContain('apicircle-marketplace');
  });

  it('searchMarketplace works anonymously (no session) and omits the Authorization header', async () => {
    const fetchMock = queuedFetch([
      {
        body: {
          items: [
            {
              full_name: 'org/anon-api',
              name: 'anon-api',
              owner: { login: 'org' },
              description: 'no-auth desc',
              topics: ['apicircle-marketplace'],
              stargazers_count: 0,
              default_branch: 'main',
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const results = await useWorkspaceStore.getState().searchMarketplace('anon');
    expect(results).toHaveLength(1);
    expect(results[0].fullName).toBe('org/anon-api');
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('linkPublicWorkspace persists with kind=public + marketplace metadata', async () => {
    await setupSession();
    const remoteJson = JSON.stringify({
      workspaceName: 'Public API',
      releases: {
        self: {
          versions: [
            {
              version: '2.0.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '2.0.0',
        },
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));
    const link = await useWorkspaceStore.getState().linkPublicWorkspace({
      repoFullName: 'org/public-api',
      branch: 'main',
      marketplace: {
        listedAs: 'Public API',
        tags: ['apicircle-marketplace', 'rest'],
        summary: 'Public API workspace',
      },
    });
    expect(link.kind).toBe('public');
    expect(link.marketplace?.listedAs).toBe('Public API');
    expect(link.pinnedVersion).toBe('2.0.0');
  });
});

describe('workspaceStore.pinLinkedVersion', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function linkWithTwoVersions(): Promise<string> {
    await setupSession();
    const remoteJson = JSON.stringify({
      workspaceName: 'API',
      releases: {
        self: {
          versions: [
            {
              version: '0.1.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
            {
              version: '0.2.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'b'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '0.2.0',
        },
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileContents(remoteJson)]));
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });
    return link.id;
  }

  it('switches the pin between cached versions', async () => {
    const id = await linkWithTwoVersions();
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[id].pinnedVersion).toBe('0.2.0');

    useWorkspaceStore.getState().pinLinkedVersion(id, '0.1.0');
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[id].pinnedVersion).toBe('0.1.0');
  });

  it('null unpins (track latest)', async () => {
    const id = await linkWithTwoVersions();
    useWorkspaceStore.getState().pinLinkedVersion(id, null);
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[id].pinnedVersion).toBeNull();
  });

  it('throws when the version is not in the cached ledger', async () => {
    const id = await linkWithTwoVersions();
    expect(() => useWorkspaceStore.getState().pinLinkedVersion(id, '9.9.9')).toThrow(
      /not in the cached ledger/,
    );
  });

  it('throws when the link id is unknown', async () => {
    expect(() => useWorkspaceStore.getState().pinLinkedVersion('nope', '1.0.0')).toThrow(
      /not found/,
    );
  });
});
