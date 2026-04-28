import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSynced } from '@apicircle/shared';
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

async function setupConnectedBranch(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
      {
        body: {
          full_name: 'me/api',
          name: 'api',
          owner: { login: 'me' },
          default_branch: 'main',
          permissions: { push: true, admin: false },
        },
      },
      { body: { name: 'main', commit: { sha: 'sha-main' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  await useWorkspaceStore.getState().connectRepo('me', 'api');
  await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/wb-aaa' });
  vi.unstubAllGlobals();
}

function fileContents(synced: WorkspaceSynced, sha = 'remote-blob-sha'): ResponseSpec {
  const json = JSON.stringify(synced);
  // GitHub returns base64 with line wraps; emulate the un-wrapped shape, the
  // client strips the wraps either way.
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

describe('workspaceStore.refreshWorkspace', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when no working branch exists', async () => {
    await expect(useWorkspaceStore.getState().refreshWorkspace()).rejects.toThrow(
      /Create a working branch/,
    );
  });

  it('returns no-remote when GitHub answers 404 (workspace.json not pushed yet)', async () => {
    await setupConnectedBranch();
    vi.stubGlobal('fetch', queuedFetch([{ body: { message: 'Not Found' }, status: 404 }]));
    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('no-remote');
    // Snapshot is unchanged.
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBeNull();
  });

  it('returns up-to-date and refreshes the snapshot when local + remote match', async () => {
    await setupConnectedBranch();
    const local = useWorkspaceStore.getState().synced!;
    vi.stubGlobal('fetch', queuedFetch([fileContents(local, 'remote-sha-1')]));
    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('up-to-date');
    const sync = useWorkspaceStore.getState().local!.sync;
    expect(sync.lastPulledSha).toBe('remote-sha-1');
    expect(sync.lastPulledSnapshot).toEqual(local);
    expect(sync.lastPulledAt).not.toBeNull();
  });

  it('auto-merges remote-only changes (fast-forward) without a conflict modal', async () => {
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    // Remote adds a request that local doesn't have; nothing local-changed.
    const remote: WorkspaceSynced = {
      ...localSynced,
      collections: {
        ...localSynced.collections,
        requests: {
          'remote-only': {
            id: 'remote-only',
            name: 'From remote',
            folderId: null,
            method: 'GET',
            url: 'https://x',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: 't',
            updatedAt: 't',
          },
        },
      },
    };
    vi.stubGlobal('fetch', queuedFetch([fileContents(remote, 'sha-r1')]));

    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('merged');
    const merged = useWorkspaceStore.getState().synced!;
    expect(merged.collections.requests['remote-only']).toBeDefined();
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBe('sha-r1');
  });

  it('stashes the diff for the resolver when conflicts exist; commitRefresh applies the picks', async () => {
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    // Local renames the workspace; remote renames it differently. With no
    // base snapshot (first refresh), this is a conflict.
    useWorkspaceStore.getState().setWorkspaceName('Mine');
    const remote: WorkspaceSynced = { ...localSynced, workspaceName: 'Theirs' };
    vi.stubGlobal('fetch', queuedFetch([fileContents(remote, 'sha-r2')]));

    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('conflicts');
    expect(useWorkspaceStore.getState().pendingRefresh).not.toBeNull();
    // Synced doc is NOT mutated until commitRefresh.
    expect(useWorkspaceStore.getState().synced!.workspaceName).toBe('Mine');

    await useWorkspaceStore.getState().commitRefresh({ 'workspaceName:': 'theirs' });
    expect(useWorkspaceStore.getState().synced!.workspaceName).toBe('Theirs');
    expect(useWorkspaceStore.getState().pendingRefresh).toBeNull();
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBe('sha-r2');
  });

  it('cancelRefresh drops the pending diff without writing anything', async () => {
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.getState().setWorkspaceName('Mine');
    const remote: WorkspaceSynced = { ...localSynced, workspaceName: 'Theirs' };
    vi.stubGlobal('fetch', queuedFetch([fileContents(remote)]));

    await useWorkspaceStore.getState().refreshWorkspace();
    useWorkspaceStore.getState().cancelRefresh();
    expect(useWorkspaceStore.getState().pendingRefresh).toBeNull();
    expect(useWorkspaceStore.getState().synced!.workspaceName).toBe('Mine');
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBeNull();
  });
});
