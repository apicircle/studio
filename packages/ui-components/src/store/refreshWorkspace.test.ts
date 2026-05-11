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

/**
 * Mock for the new branch-existence probe `refreshWorkspace` runs before
 * the diff (introduced with the post-merge / branch-deleted detection
 * flow). 200 with a valid branch payload = branch is alive — refresh
 * proceeds normally.
 */
function branchHeadOk(branchName = 'apicircle/wb-aaa'): ResponseSpec {
  return { body: { name: branchName, commit: { sha: 'sha-head' } } };
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
    vi.stubGlobal(
      'fetch',
      queuedFetch([branchHeadOk(), { body: { message: 'Not Found' }, status: 404 }]),
    );
    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('no-remote');
    // Snapshot is unchanged.
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBeNull();
  });

  it('returns up-to-date and refreshes the snapshot when local + remote match', async () => {
    await setupConnectedBranch();
    const local = useWorkspaceStore.getState().synced!;
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(local, 'remote-sha-1')]));
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
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(remote, 'sha-r1')]));

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
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(remote, 'sha-r2')]));

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
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(remote)]));

    await useWorkspaceStore.getState().refreshWorkspace();
    useWorkspaceStore.getState().cancelRefresh();
    expect(useWorkspaceStore.getState().pendingRefresh).toBeNull();
    expect(useWorkspaceStore.getState().synced!.workspaceName).toBe('Mine');
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBeNull();
  });

  // Retirement detection: refresh runs `getBranchHead` (and `getPullRequest`
  // if a PR was opened) before the diff. If those say the branch is over,
  // we clear `workingBranch`, set `local.retiredBranch`, and return
  // `status: 'retired'` — the panel flips back to CreateBranchForm with
  // the retirement banner above.
  describe('retirement detection', () => {
    /**
     * Open a PR on the working branch so the PR-state probe has something
     * to fetch. Reuses the same helper queue pattern as setupConnectedBranch.
     */
    async function openPrOnBranch(prNumber = 42): Promise<void> {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          {
            body: {
              number: prNumber,
              html_url: `https://github.com/me/api/pull/${prNumber}`,
              state: 'open',
              title: 'Test PR',
            },
          },
        ]),
      );
      // Mark the branch as pushed so createPullRequest can run.
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local,
          workingBranch: { ...local.workingBranch!, lastPushedSha: 'sha-pushed' },
        },
      });
      await useWorkspaceStore.getState().createPullRequest({ title: 'Test', body: '' });
      vi.unstubAllGlobals();
    }

    it('retires with reason `pr-merged` and clears workingBranch when PR is merged', async () => {
      await setupConnectedBranch();
      await openPrOnBranch(42);

      // Refresh probes: 1) getBranchHead, 2) getPullRequest. PR comes back
      // merged → store retires the branch and short-circuits.
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          branchHeadOk(),
          {
            body: {
              number: 42,
              html_url: 'https://github.com/me/api/pull/42',
              state: 'closed',
              merged: true,
            },
          },
        ]),
      );
      const result = await useWorkspaceStore.getState().refreshWorkspace();
      expect(result.status).toBe('retired');
      const after = useWorkspaceStore.getState().local!;
      expect(after.workingBranch).toBeNull();
      expect(after.retiredBranch).not.toBeNull();
      expect(after.retiredBranch?.reason).toBe('pr-merged');
      expect(after.retiredBranch?.prNumber).toBe(42);
      expect(after.retiredBranch?.branchName).toBe('apicircle/wb-aaa');
      expect(after.retiredBranch?.prUrl).toBe('https://github.com/me/api/pull/42');
    });

    it('retires with reason `branch-deleted` when GitHub returns 404 for the branch', async () => {
      await setupConnectedBranch();
      // No PR opened; branch is gone (deleted on GitHub by some other actor).
      vi.stubGlobal('fetch', queuedFetch([{ body: { message: 'Not Found' }, status: 404 }]));
      const result = await useWorkspaceStore.getState().refreshWorkspace();
      expect(result.status).toBe('retired');
      const after = useWorkspaceStore.getState().local!;
      expect(after.workingBranch).toBeNull();
      expect(after.retiredBranch?.reason).toBe('branch-deleted');
      expect(after.retiredBranch?.branchName).toBe('apicircle/wb-aaa');
    });

    it('does NOT retire when branch is alive and PR is still open — refresh proceeds normally', async () => {
      await setupConnectedBranch();
      await openPrOnBranch(7);
      const local = useWorkspaceStore.getState().synced!;

      vi.stubGlobal(
        'fetch',
        queuedFetch([
          branchHeadOk(),
          {
            body: {
              number: 7,
              html_url: 'https://github.com/me/api/pull/7',
              state: 'open',
              merged: false,
            },
          },
          fileContents(local, 'sha-still-alive'),
        ]),
      );
      const result = await useWorkspaceStore.getState().refreshWorkspace();
      expect(result.status).toBe('up-to-date');
      const after = useWorkspaceStore.getState().local!;
      expect(after.workingBranch).not.toBeNull();
      expect(after.retiredBranch).toBeNull();
    });

    it('does NOT retire when probes are inconclusive (transient 5xx)', async () => {
      // The user is offline / GitHub is flaky. We should NOT pretend we
      // know the branch state and retire it — keep the working branch and
      // surface the underlying error.
      await setupConnectedBranch();
      vi.stubGlobal('fetch', queuedFetch([{ body: { message: 'Server' }, status: 500 }]));
      // The probe swallows transient errors and returns null; refresh then
      // moves on to getContents which also 500s and surfaces the error.
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          { body: { message: 'Server' }, status: 500 },
          { body: { message: 'Server' }, status: 500 },
        ]),
      );
      await expect(useWorkspaceStore.getState().refreshWorkspace()).rejects.toThrow();
      const after = useWorkspaceStore.getState().local!;
      // Branch is preserved despite the transient failure.
      expect(after.workingBranch).not.toBeNull();
      expect(after.retiredBranch).toBeNull();
    });

    it('clears any pending firstPullPrompt on retirement', async () => {
      await setupConnectedBranch();
      // Stage a stale firstPullPrompt to mimic the post-create-branch state.
      useWorkspaceStore.setState({
        firstPullPrompt: { branchName: 'apicircle/wb-aaa', remoteSha: 'old-sha' },
      });

      vi.stubGlobal('fetch', queuedFetch([{ body: { message: 'Not Found' }, status: 404 }]));
      await useWorkspaceStore.getState().refreshWorkspace();
      expect(useWorkspaceStore.getState().firstPullPrompt).toBeNull();
    });
  });

  describe('dismissRetiredBranch', () => {
    it('clears local.retiredBranch when set', async () => {
      await setupConnectedBranch();
      // Run the retirement path to populate retiredBranch organically.
      vi.stubGlobal('fetch', queuedFetch([{ body: { message: 'Not Found' }, status: 404 }]));
      await useWorkspaceStore.getState().refreshWorkspace();
      expect(useWorkspaceStore.getState().local!.retiredBranch).not.toBeNull();

      useWorkspaceStore.getState().dismissRetiredBranch();
      expect(useWorkspaceStore.getState().local!.retiredBranch).toBeNull();
    });

    it('is a safe no-op when nothing is retired', async () => {
      // Pre-condition: no retired branch.
      await act(async () => {
        await useWorkspaceStore.getState().hydrate();
      });
      expect(useWorkspaceStore.getState().local!.retiredBranch).toBeNull();
      // Should not throw.
      useWorkspaceStore.getState().dismissRetiredBranch();
      expect(useWorkspaceStore.getState().local!.retiredBranch).toBeNull();
    });
  });

  describe('createWorkingBranch auto-clears retiredBranch', () => {
    it('a successful createWorkingBranch wipes the retirement banner', async () => {
      await setupConnectedBranch();
      // Force-set retiredBranch to model the post-merge state.
      const local0 = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local0,
          workingBranch: null,
          retiredBranch: {
            branchName: 'apicircle/wb-aaa',
            reason: 'pr-merged',
            retiredAt: '2026-05-09T12:00:00.000Z',
            prUrl: 'https://github.com/me/api/pull/1',
            prNumber: 1,
          },
        },
      });

      // Now create a fresh working branch — retiredBranch should auto-clear.
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          { body: { name: 'main', commit: { sha: 'sha-main' } } }, // getBranchHead
          { body: { ref: 'refs/heads/apicircle/new-one', object: { sha: 'sha-main' } } }, // createBranch
          { body: { message: 'Not Found' }, status: 404 }, // getContents probe
        ]),
      );
      await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/new-one' });
      const after = useWorkspaceStore.getState().local!;
      expect(after.retiredBranch).toBeNull();
      expect(after.workingBranch?.name).toBe('apicircle/new-one');
    });
  });
});
