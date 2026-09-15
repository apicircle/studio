import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeWorkspaceForGit } from '@apicircle/core';
import type { GlobalFileAsset, Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';

// "Import from workspace" — the create-working-branch flow can start the
// new branch from a workspace that already lives on the base branch,
// instead of from the local document.
//
// Two contracts are pinned here:
//
//   1. `listBranchWorkspaces` reads the base branch's
//      `.apicircle/registry.json` and is LENIENT about its content (a
//      branch with no / corrupt / empty registry is an empty picker, not
//      an error) while still propagating transport failures, so the form
//      can tell "nothing to import" apart from "couldn't ask".
//
//   2. `createWorkingBranch({ importWorkspaceId })` resolves the source
//      document BEFORE creating the ref (so a bad source leaves the repo
//      untouched), then copies it in under THIS workspace's id — clearing
//      the Global File Asset refs that only resolve under the source
//      workspace's attachment path.

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

/**
 * URL-routed fetch stub. The import flow interleaves contents reads with
 * ref writes, and the exact call order is an implementation detail these
 * tests should not encode — routing by URL keeps them honest about *what*
 * was requested without pinning *when*. `urls` records every request so a
 * test can assert that some call was never made.
 */
function routedFetch(routes: Array<[RegExp, ResponseSpec]>): {
  fetch: ReturnType<typeof vi.fn>;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    for (const [pattern, spec] of routes) {
      if (pattern.test(url)) return fakeResponse(spec);
    }
    throw new Error(`unrouted fetch: ${url}`);
  });
  return { fetch: fetchMock, urls };
}

/** A `contents` response body carrying `json` as base64, the way GitHub does. */
function contentsBody(path: string, json: string, sha = 'blob-sha'): ResponseSpec {
  return {
    body: {
      type: 'file',
      path,
      sha,
      size: json.length,
      content: btoa(unescape(encodeURIComponent(json))),
      encoding: 'base64',
    },
  };
}

function registryJson(
  workspaces: unknown[],
  activeWorkspaceId: string | null = null,
): ResponseSpec {
  return contentsBody(
    '.apicircle/registry.json',
    JSON.stringify({ schemaVersion: 1, activeWorkspaceId, workspaces }),
    'registry-sha',
  );
}

const REGISTRY_RE = /contents\/\.apicircle\/registry\.json/;
const SOURCE_ID = 'source-ws-1';
const SOURCE_RE = new RegExp(`contents/\\.apicircle/workspace-${SOURCE_ID}/workspace\\.json`);
const BRANCH_HEAD_RE = /\/branches\/main/;
const CREATE_REF_RE = /\/git\/refs$/;
const BRANCH_NAME = 'apicircle/import-1';

/**
 * A remote workspace document that is recognisably NOT the local one: one
 * request, one environment, and one Global File Asset whose bytes are
 * recorded as living on the SOURCE workspace's attachment path.
 */
function sourceDoc(): WorkspaceSynced {
  const base = useWorkspaceStore.getState().synced!;
  const now = '2026-01-01T00:00:00.000Z';
  const request: ApiRequest = {
    id: 'imported-req',
    name: 'Imported request',
    folderId: null,
    method: 'GET',
    url: 'https://example.test/imported',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'inherit' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
  };
  const asset: GlobalFileAsset = {
    id: 'asset-1',
    name: 'fixture.json',
    slotId: 'slot-1',
    filename: 'fixture.json',
    size: 12,
    mimeType: 'application/json',
    createdAt: now,
    updatedAt: now,
    baseBranchRef: {
      branchName: 'main',
      blobSha: 'asset-blob',
      commitSha: 'asset-commit',
      verifiedAt: now,
    },
    workingBranchRef: {
      branchName: 'other/branch',
      blobSha: 'asset-blob',
      commitSha: 'asset-commit',
      verifiedAt: now,
    },
  };
  return {
    ...base,
    workspaceId: SOURCE_ID,
    collections: {
      tree: { id: 'source-root', type: 'root', children: [{ kind: 'request', id: request.id }] },
      requests: { [request.id]: request },
      folders: {},
    },
    environments: {
      items: {
        prod: {
          name: 'prod',
          variables: [{ key: 'HOST', value: 'https://prod.test', encrypted: false }],
        },
      },
      activeName: 'prod',
      priorityOrder: [],
    },
    globalAssets: { ...base.globalAssets, files: { [asset.id]: asset } },
  };
}

/** The source document, served the way the Contents API would serve it. */
function sourceContents(doc: WorkspaceSynced = sourceDoc()): ResponseSpec {
  return contentsBody(
    `.apicircle/workspace-${SOURCE_ID}/workspace.json`,
    serializeWorkspaceForGit(doc),
  );
}

function importRoutes(sourceSpec: ResponseSpec): Array<[RegExp, ResponseSpec]> {
  return [
    [SOURCE_RE, sourceSpec],
    [BRANCH_HEAD_RE, { body: { name: 'main', commit: { sha: 'base-sha' } } }],
    [CREATE_REF_RE, { body: { ref: `refs/heads/${BRANCH_NAME}`, object: { sha: 'base-sha' } } }],
  ];
}

async function importFromBranch(importWorkspaceId = SOURCE_ID): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().createWorkingBranch({
      branchName: BRANCH_NAME,
      baseBranch: 'main',
      importWorkspaceId,
    });
  });
}

beforeEach(async () => {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  // Real session so `decryptSessionToken` can resolve a token from the vault.
  vi.stubGlobal(
    'fetch',
    routedFetch([
      [/\/user$/, { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo' } }],
    ]).fetch,
  );
  await act(async () => {
    await useWorkspaceStore.getState().connectGitHubSession('tok');
  });
  vi.unstubAllGlobals();
  act(() => {
    useWorkspaceStore.setState({
      local: {
        ...useWorkspaceStore.getState().local!,
        connectedRepo: {
          fullName: 'me/api',
          owner: 'me',
          name: 'api',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
          connectedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listBranchWorkspaces', () => {
  it('lists the branch registry entries with the active workspace first', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          REGISTRY_RE,
          registryJson(
            [
              { id: 'ws-a', name: 'Payments' },
              { id: 'ws-b', name: 'Billing' },
            ],
            'ws-b',
          ),
        ],
      ]).fetch,
    );
    const list = await useWorkspaceStore.getState().listBranchWorkspaces('main');
    expect(list).toEqual([
      { id: 'ws-b', name: 'Billing', isActive: true },
      { id: 'ws-a', name: 'Payments', isActive: false },
    ]);
  });

  it('reads the registry at the requested ref, not the default branch', async () => {
    const routed = routedFetch([[REGISTRY_RE, registryJson([{ id: 'ws-a', name: 'A' }])]]);
    vi.stubGlobal('fetch', routed.fetch);
    await useWorkspaceStore.getState().listBranchWorkspaces('release/2.x');
    expect(routed.urls[0]).toContain(`ref=${encodeURIComponent('release/2.x')}`);
  });

  it('returns [] when the branch carries no registry (404)', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([[REGISTRY_RE, { status: 404, body: { message: 'Not Found' } }]]).fetch,
    );
    await expect(useWorkspaceStore.getState().listBranchWorkspaces('main')).resolves.toEqual([]);
  });

  it('returns [] when the registry is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [REGISTRY_RE, contentsBody('.apicircle/registry.json', '{ not json', 'registry-sha')],
      ]).fetch,
    );
    await expect(useWorkspaceStore.getState().listBranchWorkspaces('main')).resolves.toEqual([]);
  });

  it('returns [] when the registry has no workspaces array', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          REGISTRY_RE,
          contentsBody('.apicircle/registry.json', JSON.stringify({ schemaVersion: 1 })),
        ],
      ]).fetch,
    );
    await expect(useWorkspaceStore.getState().listBranchWorkspaces('main')).resolves.toEqual([]);
  });

  it('drops entries whose id could escape the workspace-<id> path, and dedupes', async () => {
    // The registry is written by anyone with push access, so an id carrying
    // a separator or a traversal would otherwise be interpolated straight
    // into the follow-up `workspace-<id>/workspace.json` read.
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          REGISTRY_RE,
          registryJson([
            { id: '../../etc/passwd', name: 'evil' },
            { id: 'ws-a/../..', name: 'evil2' },
            { id: '..', name: 'evil3' },
            { id: 42, name: 'not-a-string' },
            null,
            'not-an-object',
            { id: 'ws-ok', name: 'Fine' },
            { id: 'ws-ok', name: 'Duplicate' },
          ]),
        ],
      ]).fetch,
    );
    const list = await useWorkspaceStore.getState().listBranchWorkspaces('main');
    expect(list).toEqual([{ id: 'ws-ok', name: 'Fine', isActive: false }]);
  });

  it('reports no name when an entry carries no usable one', async () => {
    // A registry written by hand, by the migration guide, or by another tool can
    // omit the name or leave it blank — the entry still lists, just unnamed.
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          REGISTRY_RE,
          registryJson([{ id: 'ws-a' }, { id: 'ws-b', name: '   ' }, { id: 'ws-c', name: 42 }]),
        ],
      ]).fetch,
    );
    const list = await useWorkspaceStore.getState().listBranchWorkspaces('main');
    expect(list).toEqual([
      { id: 'ws-a', name: null, isActive: false },
      { id: 'ws-b', name: null, isActive: false },
      { id: 'ws-c', name: null, isActive: false },
    ]);
  });

  it("treats the 'Workspace' placeholder older pushes wrote as no name", async () => {
    // Before names were pushed, every entry a push created was named 'Workspace',
    // so showing it would label every workspace on the branch identically.
    vi.stubGlobal(
      'fetch',
      routedFetch([[REGISTRY_RE, registryJson([{ id: 'ws-a', name: 'Workspace' }])]]).fetch,
    );
    const list = await useWorkspaceStore.getState().listBranchWorkspaces('main');
    expect(list).toEqual([{ id: 'ws-a', name: null, isActive: false }]);
  });

  it('keeps a real pushed name, trimmed, including the device default', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          REGISTRY_RE,
          registryJson([
            { id: 'ws-a', name: '  Payments API  ' },
            { id: 'ws-b', name: 'My Workspace' },
          ]),
        ],
      ]).fetch,
    );
    const list = await useWorkspaceStore.getState().listBranchWorkspaces('main');
    expect(list.map((w) => w.name)).toEqual(['Payments API', 'My Workspace']);
  });

  it('ignores a non-string activeWorkspaceId rather than marking an entry active', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [
          REGISTRY_RE,
          contentsBody(
            '.apicircle/registry.json',
            JSON.stringify({ activeWorkspaceId: 7, workspaces: [{ id: 'ws-a', name: 'A' }] }),
          ),
        ],
      ]).fetch,
    );
    const list = await useWorkspaceStore.getState().listBranchWorkspaces('main');
    expect(list).toEqual([{ id: 'ws-a', name: 'A', isActive: false }]);
  });

  it('propagates a transport failure instead of reporting an empty branch', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([[REGISTRY_RE, { status: 500, body: { message: 'boom' } }]]).fetch,
    );
    await expect(useWorkspaceStore.getState().listBranchWorkspaces('main')).rejects.toThrow();
  });

  it('returns [] for a blank branch without issuing a request', async () => {
    const routed = routedFetch([]);
    vi.stubGlobal('fetch', routed.fetch);
    await expect(useWorkspaceStore.getState().listBranchWorkspaces('  ')).resolves.toEqual([]);
    expect(routed.fetch).not.toHaveBeenCalled();
  });

  it('throws when no repo is connected', async () => {
    act(() => {
      useWorkspaceStore.setState({
        local: { ...useWorkspaceStore.getState().local!, connectedRepo: null },
      });
    });
    await expect(useWorkspaceStore.getState().listBranchWorkspaces('main')).rejects.toThrow(
      /Connect a repo/,
    );
  });

  it('throws when the workspace has not hydrated', async () => {
    act(() => {
      useWorkspaceStore.setState({ local: null });
    });
    await expect(useWorkspaceStore.getState().listBranchWorkspaces('main')).rejects.toThrow(
      /Workspace not ready/,
    );
  });
});

describe('createWorkingBranch with importWorkspaceId', () => {
  it('copies the source document in under the local workspace id', async () => {
    const localId = useWorkspaceStore.getState().synced!.workspaceId;
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    const synced = useWorkspaceStore.getState().synced!;
    // Content is the source's...
    expect(synced.collections.requests['imported-req']?.name).toBe('Imported request');
    expect(synced.collections.tree.children).toEqual([{ kind: 'request', id: 'imported-req' }]);
    expect(synced.environments.items.prod).toBeDefined();
    expect(synced.environments.activeName).toBe('prod');
    // ...but the identity stays ours, so pushing writes our own directory
    // and leaves the source workspace on the branch untouched.
    expect(synced.workspaceId).toBe(localId);
    expect(useWorkspaceStore.getState().local!.workspaceId).toBe(localId);
  });

  it('replaces the previous document rather than merging into it', async () => {
    act(() => {
      useWorkspaceStore.getState().addRequest(null, 'Local only');
    });
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    const names = Object.values(useWorkspaceStore.getState().synced!.collections.requests).map(
      (r) => r.name,
    );
    expect(names).toEqual(['Imported request']);
  });

  it('clears Global File Asset branch refs, since the bytes live under the source id', async () => {
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    const asset = useWorkspaceStore.getState().synced!.globalAssets.files!['asset-1'];
    // Metadata survives; the provenance pointers do not — under our id that
    // attachment path holds nothing, so the pill must read "Missing".
    expect(asset.name).toBe('fixture.json');
    expect(asset.baseBranchRef).toBeNull();
    expect(asset.workingBranchRef).toBeNull();
  });

  it('fills every declared bucket when the remote document is missing some', async () => {
    // `parseWorkspaceJson` validates workspaceId / collections / environments
    // and hands the rest back untouched, so a doc written by a partial or
    // older writer can be missing whole top-level keys. Refresh survives that
    // by merging into a complete local doc; an import replaces wholesale, so
    // anything left undefined is what the next reader dereferences.
    const partial = JSON.stringify({
      schemaVersion: 1,
      workspaceId: SOURCE_ID,
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      // linkedWorkspaces / linkedOverrides / releases / globalAssets /
      // mockServers / meta all absent.
    });
    vi.stubGlobal(
      'fetch',
      routedFetch(
        importRoutes(contentsBody(`.apicircle/workspace-${SOURCE_ID}/workspace.json`, partial)),
      ).fetch,
    );

    await importFromBranch();

    const synced = useWorkspaceStore.getState().synced!;
    expect(synced.linkedWorkspaces).toEqual({});
    expect(synced.linkedOverrides).toEqual({ requests: {}, environmentVars: {} });
    expect(synced.releases).toEqual({ self: null, perLink: {} });
    expect(synced.globalAssets.schemas).toEqual({});
    expect(synced.globalAssets.graphql).toEqual({});
    expect(synced.mockServers).toEqual({});
    expect(synced.schemaVersion).toBe(1);
    expect(typeof synced.meta.createdAt).toBe('string');
    expect(typeof synced.meta.updatedAt).toBe('string');
    expect(typeof synced.meta.appVersion).toBe('string');
  });

  it('imports a document with no file assets without inventing a files map', async () => {
    const doc = sourceDoc();
    const { files: _files, ...assetsWithoutFiles } = doc.globalAssets;
    vi.stubGlobal(
      'fetch',
      routedFetch(importRoutes(sourceContents({ ...doc, globalAssets: assetsWithoutFiles }))).fetch,
    );

    await importFromBranch();

    expect(useWorkspaceStore.getState().synced!.globalAssets.files).toBeUndefined();
    expect(useWorkspaceStore.getState().synced!.collections.requests['imported-req']).toBeDefined();
  });

  it('captures a pre-import snapshot so the replaced document can be restored', async () => {
    act(() => {
      useWorkspaceStore.getState().addRequest(null, 'Local only');
    });
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    const snap = useWorkspaceStore
      .getState()
      .local!.snapshots.entries.find((e) => e.triggeredBy === 'pre-import');
    expect(snap).toBeDefined();
    expect(snap!.note).toContain(SOURCE_ID);
    expect(
      Object.values(snap!.workspaceSyncedSnapshot.collections.requests).some(
        (r) => r.name === 'Local only',
      ),
    ).toBe(true);

    // And the restore path actually puts the pre-import document back — the
    // warning in the form promises exactly this.
    act(() => {
      useWorkspaceStore.getState().restoreSnapshot(snap!.id);
    });
    expect(
      Object.values(useWorkspaceStore.getState().synced!.collections.requests).some(
        (r) => r.name === 'Local only',
      ),
    ).toBe(true);
  });

  it('clears the local caches keyed to the discarded document', async () => {
    act(() => {
      useWorkspaceStore.setState({
        local: {
          ...useWorkspaceStore.getState().local!,
          linkedCollections: {
            stale: {
              pulledAt: '2026-01-01T00:00:00.000Z',
              ref: 'main',
              collections: {
                tree: { id: 'r', type: 'root', children: [] },
                requests: {},
                folders: {},
              },
              environments: { items: {}, activeName: null, priorityOrder: [] },
            },
          },
          attachmentCache: {
            'slot-old': {
              slotId: 'slot-old',
              filename: 'old.json',
              mimeType: 'application/json',
              size: 1,
              localPath: 'idb://old',
              storage: 'indexeddb',
              source: 'workspace',
              requiredBy: [],
              downloadedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      });
    });
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    const local = useWorkspaceStore.getState().local!;
    expect(local.linkedCollections).toEqual({});
    expect(local.attachmentCache).toEqual({});
  });

  it('keeps run history, the secret vault, the session and the connected repo', async () => {
    const historyBefore = useWorkspaceStore.getState().local!.history;
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    const local = useWorkspaceStore.getState().local!;
    expect(local.history).toEqual(historyBefore);
    expect(local.secretIndex).toBeDefined();
    expect(local.sessions.github.workspace).not.toBeNull();
    expect(local.connectedRepo?.fullName).toBe('me/api');
  });

  it('leaves no pulled baseline and raises no first-pull prompt', async () => {
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    // Nothing on the branch sits at OUR workspace path yet, so the whole
    // document is legitimately unpushed — and the "remote already has
    // content" prompt would be a non-sequitur right after a deliberate
    // import of that very content.
    const local = useWorkspaceStore.getState().local!;
    expect(local.sync.lastPulledSnapshot).toBeNull();
    expect(local.sync.lastPulledSha).toBeNull();
    expect(useWorkspaceStore.getState().firstPullPrompt).toBeNull();
  });

  it('records the working branch it just created', async () => {
    vi.stubGlobal('fetch', routedFetch(importRoutes(sourceContents())).fetch);

    await importFromBranch();

    const branch = useWorkspaceStore.getState().local!.workingBranch;
    expect(branch?.name).toBe(BRANCH_NAME);
    expect(branch?.baseBranch).toBe('main');
    expect(branch?.headSha).toBe('base-sha');
    expect(branch?.lastPushedSha).toBeNull();
  });

  it('reads the source from the base branch ref', async () => {
    const routed = routedFetch(importRoutes(sourceContents()));
    vi.stubGlobal('fetch', routed.fetch);

    await importFromBranch();

    const sourceCall = routed.urls.find((u) => SOURCE_RE.test(u));
    expect(sourceCall).toContain('ref=main');
  });

  it('refuses a source with no workspace.json, without creating the branch', async () => {
    const routed = routedFetch(importRoutes({ status: 404, body: { message: 'Not Found' } }));
    vi.stubGlobal('fetch', routed.fetch);

    await expect(
      useWorkspaceStore.getState().createWorkingBranch({
        branchName: BRANCH_NAME,
        baseBranch: 'main',
        importWorkspaceId: SOURCE_ID,
      }),
    ).rejects.toThrow(/has no workspace\.json on main/);

    // Pre-flight ran before any write, so no ref was created and the user
    // is not left with a branch that holds none of the content they asked for.
    expect(routed.urls.some((u) => CREATE_REF_RE.test(u))).toBe(false);
    expect(useWorkspaceStore.getState().local!.workingBranch).toBeNull();
  });

  it('refuses a malformed source document, without creating the branch', async () => {
    const routed = routedFetch(
      importRoutes(
        contentsBody(`.apicircle/workspace-${SOURCE_ID}/workspace.json`, '{"nope": true}'),
      ),
    );
    vi.stubGlobal('fetch', routed.fetch);

    await expect(
      useWorkspaceStore.getState().createWorkingBranch({
        branchName: BRANCH_NAME,
        baseBranch: 'main',
        importWorkspaceId: SOURCE_ID,
      }),
    ).rejects.toThrow(/could not be read \(missing-workspace-id\)/);
    expect(routed.urls.some((u) => CREATE_REF_RE.test(u))).toBe(false);
  });

  it('refuses a source that is not JSON at all, without creating the branch', async () => {
    const routed = routedFetch(
      importRoutes(contentsBody(`.apicircle/workspace-${SOURCE_ID}/workspace.json`, 'not json')),
    );
    vi.stubGlobal('fetch', routed.fetch);

    await expect(
      useWorkspaceStore.getState().createWorkingBranch({
        branchName: BRANCH_NAME,
        baseBranch: 'main',
        importWorkspaceId: SOURCE_ID,
      }),
    ).rejects.toThrow(/could not be read \(invalid-json\)/);
    expect(routed.urls.some((u) => CREATE_REF_RE.test(u))).toBe(false);
  });

  it('rejects a workspace id that could escape the workspace path, before any request', async () => {
    const routed = routedFetch([]);
    vi.stubGlobal('fetch', routed.fetch);

    await expect(
      useWorkspaceStore.getState().createWorkingBranch({
        branchName: BRANCH_NAME,
        baseBranch: 'main',
        importWorkspaceId: '../../secrets',
      }),
    ).rejects.toThrow(/not a valid workspace id/);
    expect(routed.fetch).not.toHaveBeenCalled();
  });

  it('treats a blank importWorkspaceId as "no import" and keeps the local document', async () => {
    act(() => {
      useWorkspaceStore.getState().addRequest(null, 'Local only');
    });
    vi.stubGlobal(
      'fetch',
      routedFetch([
        [BRANCH_HEAD_RE, { body: { name: 'main', commit: { sha: 'base-sha' } } }],
        [
          CREATE_REF_RE,
          { body: { ref: `refs/heads/${BRANCH_NAME}`, object: { sha: 'base-sha' } } },
        ],
        [/contents\//, { status: 404, body: { message: 'Not Found' } }],
      ]).fetch,
    );

    await importFromBranch('   ');

    expect(
      Object.values(useWorkspaceStore.getState().synced!.collections.requests).some(
        (r) => r.name === 'Local only',
      ),
    ).toBe(true);
    expect(
      useWorkspaceStore
        .getState()
        .local!.snapshots.entries.some((e) => e.triggeredBy === 'pre-import'),
    ).toBe(false);
  });
});
