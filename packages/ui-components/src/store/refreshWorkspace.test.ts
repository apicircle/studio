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
  const wsId = synced.workspaceId;
  return {
    body: {
      type: 'file',
      path: `.apicircle/workspace-${wsId}/workspace.json`,
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

  // Regression: after auto-merge the snapshot baseline MUST be the
  // remote, not the merged doc. Storing `merged` made local-only edits
  // disappear from the unpushed-changes strip ("No unpushed changes")
  // until the user pushed — at which point those edits silently went
  // through. The strip is the user's only signal of "what will this
  // push do?", so it has to stay honest.
  it('after auto-merge with a local-only edit, the strip still reports it as unpushed', async () => {
    const { summarizeUnpushedChanges } = await import('@apicircle/core');
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    // Local seeds an execution plan; remote has no plans.
    const localWithPlan: WorkspaceSynced = {
      ...localSynced,
      executionPlans: {
        'plan-local': {
          id: 'plan-local',
          name: 'Local plan',
          steps: [],
          envPriorityOrder: [],
          createdAt: 't',
          updatedAt: 't',
        },
      },
    };
    useWorkspaceStore.setState({ synced: localWithPlan });
    const remote: WorkspaceSynced = { ...localSynced, executionPlans: {} };
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(remote, 'sha-merge-1')]));

    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('merged');
    const { local: localAfter, synced: syncedAfter } = useWorkspaceStore.getState();
    // Synced retained the plan (auto-merge kept the local-only entry).
    expect(syncedAfter!.executionPlans?.['plan-local']).toBeDefined();
    // Snapshot is the REMOTE, not the merged doc — that's the fix.
    expect(localAfter!.sync.lastPulledSnapshot?.executionPlans?.['plan-local']).toBeUndefined();
    // The unpushed-changes strip therefore correctly surfaces the local edit.
    const summary = summarizeUnpushedChanges(localAfter!.sync.lastPulledSnapshot, syncedAfter!);
    expect(summary.changes.find((c) => c.bucket === 'executionPlan')?.kind).toBe('added');
    expect(summary.total).toBeGreaterThan(0);
  });

  // Regression: a mutation that lands DURING the GitHub round-trip (e.g.,
  // the user uploads a file in form-data or via Global Assets while the
  // cold-launch focus refresh is still fetching workspace.json from
  // GitHub) MUST survive the auto-merge. The original `refreshWorkspace`
  // captured `synced` at function entry — and any in-flight edit was
  // silently dropped when the merge ran against the stale snapshot, then
  // wrote `set({ synced: merged })`. The fix re-reads `synced` and
  // `local` after the awaits, immediately before `computeThreeWayDiff`.
  it('preserves a local-only mutation that lands during the GitHub fetch (the file-upload race)', async () => {
    await setupConnectedBranch();
    const startSynced = useWorkspaceStore.getState().synced!;
    // Seed `lastPulledSnapshot` so the 3-way diff has a non-null base.
    // Without this, the diff classifier sends every divergent entity to
    // 'conflict' (line 311 of threeWayDiff.ts) and the test would never
    // reach the auto-merge path the race lives in.
    useWorkspaceStore.setState({
      local: {
        ...useWorkspaceStore.getState().local!,
        sync: {
          ...useWorkspaceStore.getState().local!.sync,
          lastPulledSnapshot: startSynced,
          lastPulledSha: 'sha-base',
          lastPulledAt: '2026-06-06T00:00:00.000Z',
        },
      },
    });
    // Remote has a remote-only addition so the auto-merge path fires (the
    // diff is non-empty, conflict-free). Without this, the code would
    // take the up-to-date path and not exercise the race.
    const remote: WorkspaceSynced = {
      ...startSynced,
      collections: {
        ...startSynced.collections,
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

    // Custom fetch: the branch-probe responds synchronously, but the
    // workspace.json read parks on a deferred so we can inject a
    // mid-fetch mutation before resolving.
    let releaseFetch: () => void = () => {};
    const fetchParked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return fakeResponse(branchHeadOk());
      if (call === 2) {
        // Wait for the test to mutate state, then return the remote doc.
        await fetchParked;
        return fakeResponse(fileContents(remote, 'sha-mid-fetch'));
      }
      throw new Error(`unexpected fetch call #${call}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    // Kick off the refresh (don't await).
    const refreshing = useWorkspaceStore.getState().refreshWorkspace();
    // Yield once so refreshWorkspace can reach its first awaited fetch.
    await Promise.resolve();
    await Promise.resolve();

    // Mid-fetch mutation: drop a local-only request into synced via the
    // store's add action. This is the same code path a form-data file
    // upload or Global Assets add takes — they all funnel through
    // `commitSynced`, which is what produces the bumped `meta.updatedAt`
    // and the new synced doc.
    const newRequestId = useWorkspaceStore.getState().addRequest(null, 'Mid-fetch addition');
    expect(useWorkspaceStore.getState().synced!.collections.requests[newRequestId]).toBeDefined();

    // Now let the workspace.json fetch resolve. The merge runs after
    // this point — with the fix, it sees the freshly-mutated synced doc
    // and keeps the local-only request.
    releaseFetch();
    const result = await refreshing;
    expect(result.status).toBe('merged');

    const afterMerge = useWorkspaceStore.getState().synced!;
    // The mid-fetch addition survives the auto-merge.
    expect(afterMerge.collections.requests[newRequestId]).toBeDefined();
    expect(afterMerge.collections.requests[newRequestId].name).toBe('Mid-fetch addition');
    // The remote-only addition is also pulled in (the merge does the
    // right thing in both directions).
    expect(afterMerge.collections.requests['remote-only']).toBeDefined();
  });

  // Provenance pass: after the merge, walk every Global File Asset and
  // verify its workingBranchRef + opportunistically probe the base branch.
  // When both probes return the SAME blob sha, the cleanup invariant
  // drops the workingBranchRef so the base ref is the single source of
  // truth (the "PR merged" detection path).
  it('runs the asset-ref verification + cleanup invariant after an up-to-date refresh', async () => {
    await setupConnectedBranch();
    const startSynced = useWorkspaceStore.getState().synced!;
    const assetId = 'asset-prov';
    const slotId = 'slot-prov';
    const initialSynced: WorkspaceSynced = {
      ...startSynced,
      globalAssets: {
        ...startSynced.globalAssets,
        files: {
          [assetId]: {
            id: assetId,
            name: 'Reusable payload',
            slotId,
            filename: 'payload.bin',
            size: 4,
            mimeType: 'application/octet-stream',
            sha256: 'sha-x',
            createdAt: '2026-06-06T00:00:00.000Z',
            updatedAt: '2026-06-06T00:00:00.000Z',
            workingBranchRef: {
              branchName: 'apicircle/wb-aaa',
              blobSha: 'blob-shared',
              commitSha: 'commit-w',
              verifiedAt: '2026-06-06T00:00:00.000Z',
            },
          },
        },
      },
    };
    useWorkspaceStore.setState({
      synced: initialSynced,
      local: {
        ...useWorkspaceStore.getState().local!,
        sync: {
          ...useWorkspaceStore.getState().local!.sync,
          lastPulledSnapshot: initialSynced,
          lastPulledSha: 'sha-base',
          lastPulledAt: '2026-06-06T00:00:00.000Z',
        },
      },
    });

    // Remote matches local exactly → up-to-date path → verifyAssetRefs runs.
    function attachmentResponse(): ResponseSpec {
      return {
        body: {
          type: 'file',
          path: `.apicircle/workspace-${useWorkspaceStore.getState().synced!.workspaceId}/attachments/${slotId}`,
          sha: 'blob-shared',
          size: 4,
          content: btoa('xxxx'),
          encoding: 'base64',
        },
      };
    }
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        branchHeadOk(),
        // Up-to-date workspace.json
        fileContents(initialSynced, 'sha-up-to-date'),
        // verifyAssetRefs — working branch probe (same blob sha)
        attachmentResponse(),
        // verifyAssetRefs — opportunistic base branch probe (same blob sha)
        attachmentResponse(),
      ]),
    );

    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('up-to-date');

    const assetAfter = useWorkspaceStore.getState().synced!.globalAssets.files![assetId];
    // Cleanup invariant fired: both refs held the same blob sha, so the
    // working ref is dropped and base is the single source of truth.
    expect(assetAfter.workingBranchRef).toBeNull();
    expect(assetAfter.baseBranchRef).toEqual({
      branchName: 'main',
      blobSha: 'blob-shared',
      verifiedAt: expect.any(String),
    });
  });

  it('verifyAssetRefs drops a workingBranchRef when its blob 404s', async () => {
    // PR merged on GitHub → branch deleted → bytes no longer reachable
    // via the working ref. The probe returns 404; the ref is dropped.
    // Base ref stays whatever it was (here: untouched / unset).
    await setupConnectedBranch();
    const startSynced = useWorkspaceStore.getState().synced!;
    const assetId = 'asset-gone';
    const slotId = 'slot-gone';
    const initialSynced: WorkspaceSynced = {
      ...startSynced,
      globalAssets: {
        ...startSynced.globalAssets,
        files: {
          [assetId]: {
            id: assetId,
            name: 'Orphan',
            slotId,
            filename: 'orphan.bin',
            size: 1,
            mimeType: 'application/octet-stream',
            sha256: 'sha-y',
            createdAt: '2026-06-06T00:00:00.000Z',
            updatedAt: '2026-06-06T00:00:00.000Z',
            workingBranchRef: {
              branchName: 'apicircle/wb-aaa',
              blobSha: 'blob-old',
              commitSha: 'commit-w',
              verifiedAt: '2026-06-06T00:00:00.000Z',
            },
          },
        },
      },
    };
    useWorkspaceStore.setState({
      synced: initialSynced,
      local: {
        ...useWorkspaceStore.getState().local!,
        sync: {
          ...useWorkspaceStore.getState().local!.sync,
          lastPulledSnapshot: initialSynced,
          lastPulledSha: 'sha-base',
          lastPulledAt: '2026-06-06T00:00:00.000Z',
        },
      },
    });

    vi.stubGlobal(
      'fetch',
      queuedFetch([
        branchHeadOk(),
        fileContents(initialSynced, 'sha-up-to-date'),
        // working-branch probe → 404
        { body: { message: 'Not Found' }, status: 404 },
        // opportunistic base probe → 404
        { body: { message: 'Not Found' }, status: 404 },
      ]),
    );

    await useWorkspaceStore.getState().refreshWorkspace();

    const assetAfter = useWorkspaceStore.getState().synced!.globalAssets.files![assetId];
    expect(assetAfter.workingBranchRef).toBeNull();
    expect(assetAfter.baseBranchRef ?? null).toBeNull();
  });

  // Regression: a workingBranchRef stamped within the last 60 seconds is
  // trusted as-is — verifyAssetRefs does NOT probe it. This is what stops
  // the post-push "Missing" flicker the user reported: the push commit
  // lands via the Git Data API (strongly consistent), but GitHub's
  // Contents API has a propagation window of several seconds during
  // which it returns 404 for the same path. Before the grace window,
  // the cold-launch refresh that fires right after `pushWorkspace`
  // would null the workingBranchRef the push had just stamped.
  it('trusts a freshly-stamped workingBranchRef without probing (Contents-API propagation grace)', async () => {
    await setupConnectedBranch();
    const startSynced = useWorkspaceStore.getState().synced!;
    const assetId = 'asset-fresh';
    const slotId = 'slot-fresh';
    // verifiedAt = NOW so the grace window is active.
    const justNow = new Date().toISOString();
    const initialSynced: WorkspaceSynced = {
      ...startSynced,
      globalAssets: {
        ...startSynced.globalAssets,
        files: {
          [assetId]: {
            id: assetId,
            name: 'Just pushed',
            slotId,
            filename: 'fresh.bin',
            size: 1,
            mimeType: 'application/octet-stream',
            sha256: 'sha-fresh',
            createdAt: '2026-06-06T00:00:00.000Z',
            updatedAt: justNow,
            workingBranchRef: {
              branchName: 'apicircle/wb-aaa',
              blobSha: 'blob-fresh',
              commitSha: 'commit-fresh',
              verifiedAt: justNow,
            },
          },
        },
      },
    };
    useWorkspaceStore.setState({
      synced: initialSynced,
      local: {
        ...useWorkspaceStore.getState().local!,
        sync: {
          ...useWorkspaceStore.getState().local!.sync,
          lastPulledSnapshot: initialSynced,
          lastPulledSha: 'sha-base',
          lastPulledAt: '2026-06-06T00:00:00.000Z',
        },
      },
    });
    // Queue: branchHeadOk, workspace.json (up-to-date), opportunistic base
    // probe (404 — file isn't on main yet, no PR merged). NO working-branch
    // probe — the grace window MUST skip it. If a fourth fetch fires the
    // mock will throw "unexpected fetch call #4", failing the test loudly.
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        branchHeadOk(),
        fileContents(initialSynced, 'sha-up-to-date'),
        { body: { message: 'Not Found' }, status: 404 }, // base probe (opportunistic)
      ]),
    );
    await useWorkspaceStore.getState().refreshWorkspace();
    const assetAfter = useWorkspaceStore.getState().synced!.globalAssets.files![assetId];
    expect(assetAfter.workingBranchRef).toMatchObject({
      branchName: 'apicircle/wb-aaa',
      blobSha: 'blob-fresh',
    });
    expect(assetAfter.baseBranchRef ?? null).toBeNull();
  });

  // Regression: when workingBranchRef is null AND a working branch is
  // connected, verifyAssetRefs opportunistically probes the working
  // branch and re-stamps if the blob is there. Recovers from a previous
  // probe that mistakenly nulled the ref (e.g. a Contents-API 404 that
  // landed after the grace window expired but before propagation).
  it('opportunistically re-discovers a missing workingBranchRef when the blob is reachable', async () => {
    await setupConnectedBranch();
    const startSynced = useWorkspaceStore.getState().synced!;
    const assetId = 'asset-rediscover';
    const slotId = 'slot-rediscover';
    const initialSynced: WorkspaceSynced = {
      ...startSynced,
      globalAssets: {
        ...startSynced.globalAssets,
        files: {
          [assetId]: {
            id: assetId,
            name: 'Recoverable',
            slotId,
            filename: 'r.bin',
            size: 1,
            mimeType: 'application/octet-stream',
            sha256: 'sha-r',
            createdAt: '2026-06-06T00:00:00.000Z',
            updatedAt: '2026-06-06T00:00:00.000Z',
            workingBranchRef: null,
            baseBranchRef: null,
          },
        },
      },
    };
    useWorkspaceStore.setState({
      synced: initialSynced,
      local: {
        ...useWorkspaceStore.getState().local!,
        sync: {
          ...useWorkspaceStore.getState().local!.sync,
          lastPulledSnapshot: initialSynced,
          lastPulledSha: 'sha-base',
          lastPulledAt: '2026-06-06T00:00:00.000Z',
        },
      },
    });
    function attachmentResponse(): ResponseSpec {
      return {
        body: {
          type: 'file',
          path: `.apicircle/workspace-${useWorkspaceStore.getState().synced!.workspaceId}/attachments/${slotId}`,
          sha: 'blob-recovered',
          size: 1,
          content: btoa('x'),
          encoding: 'base64',
        },
      };
    }
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        branchHeadOk(),
        fileContents(initialSynced, 'sha-up-to-date'),
        attachmentResponse(), // opportunistic working-branch probe → found
        { body: { message: 'Not Found' }, status: 404 }, // base probe (opportunistic)
      ]),
    );
    await useWorkspaceStore.getState().refreshWorkspace();
    const assetAfter = useWorkspaceStore.getState().synced!.globalAssets.files![assetId];
    expect(assetAfter.workingBranchRef).toMatchObject({
      branchName: 'apicircle/wb-aaa',
      blobSha: 'blob-recovered',
    });
    expect(assetAfter.baseBranchRef ?? null).toBeNull();
  });

  it('stashes the diff for the resolver when conflicts exist; commitRefresh applies the picks', async () => {
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    // Local picks one active env; remote picks a different one. With no
    // base snapshot (first refresh), this is a conflict on the
    // `environmentsActive` singleton.
    useWorkspaceStore.setState({
      synced: {
        ...localSynced,
        environments: { ...localSynced.environments, activeName: 'mine' },
      },
    });
    const remote: WorkspaceSynced = {
      ...localSynced,
      environments: { ...localSynced.environments, activeName: 'theirs' },
    };
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(remote, 'sha-r2')]));

    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('conflicts');
    expect(useWorkspaceStore.getState().pendingRefresh).not.toBeNull();
    // Synced doc is NOT mutated until commitRefresh.
    expect(useWorkspaceStore.getState().synced!.environments.activeName).toBe('mine');

    await useWorkspaceStore.getState().commitRefresh({ 'environmentsActive:': 'theirs' });
    expect(useWorkspaceStore.getState().synced!.environments.activeName).toBe('theirs');
    expect(useWorkspaceStore.getState().pendingRefresh).toBeNull();
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBe('sha-r2');
  });

  // Regression: conflict resolved as "mine" must leave the snapshot
  // baseline pointing at the remote, so the user's picked-as-mine
  // values still register as unpushed. Pre-fix the snapshot was the
  // merged doc — synced == snapshot, strip blank, user silently misses
  // that their picks still need to be pushed.
  it('after commitRefresh picks "mine", the strip still reports the picked value as unpushed', async () => {
    const { summarizeUnpushedChanges } = await import('@apicircle/core');
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...localSynced,
        environments: { ...localSynced.environments, activeName: 'mine' },
      },
    });
    const remote: WorkspaceSynced = {
      ...localSynced,
      environments: { ...localSynced.environments, activeName: 'theirs' },
    };
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(remote, 'sha-pick-mine')]));

    await useWorkspaceStore.getState().refreshWorkspace();
    await useWorkspaceStore.getState().commitRefresh({ 'environmentsActive:': 'mine' });

    const { local: localAfter, synced: syncedAfter } = useWorkspaceStore.getState();
    // Local picked "mine" → synced retains 'mine'.
    expect(syncedAfter!.environments.activeName).toBe('mine');
    // Snapshot baseline is the REMOTE ('theirs'), not the merged result ('mine').
    expect(localAfter!.sync.lastPulledSnapshot?.environments.activeName).toBe('theirs');
    // So the strip surfaces 'mine' as still-unpushed.
    const summary = summarizeUnpushedChanges(localAfter!.sync.lastPulledSnapshot, syncedAfter!);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.changes.find((c) => c.bucket === 'environmentsActive')).toBeDefined();
  });

  it('cancelRefresh drops the pending diff without writing anything', async () => {
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...localSynced,
        environments: { ...localSynced.environments, activeName: 'mine' },
      },
    });
    const remote: WorkspaceSynced = {
      ...localSynced,
      environments: { ...localSynced.environments, activeName: 'theirs' },
    };
    vi.stubGlobal('fetch', queuedFetch([branchHeadOk(), fileContents(remote)]));

    await useWorkspaceStore.getState().refreshWorkspace();
    useWorkspaceStore.getState().cancelRefresh();
    expect(useWorkspaceStore.getState().pendingRefresh).toBeNull();
    expect(useWorkspaceStore.getState().synced!.environments.activeName).toBe('mine');
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBeNull();
  });

  it('returns history-rewritten when the remote HEAD is not a descendant of lastPushedSha (force-push)', async () => {
    await setupConnectedBranch();
    const localSynced = useWorkspaceStore.getState().synced!;
    // Stamp a baseline `lastPushedSha` so the ancestry pre-flight kicks in.
    const localBefore = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...localBefore,
        workingBranch: { ...localBefore.workingBranch!, lastPushedSha: 'sha-mine-pushed' },
      },
    });
    const remote: WorkspaceSynced = {
      ...localSynced,
      environments: { ...localSynced.environments, activeName: 'rewritten' },
    };

    vi.stubGlobal(
      'fetch',
      queuedFetch([
        // probeBranchRetirement now returns the head SHA — must differ
        // from lastPushedSha to trigger the ancestry check below.
        { body: { name: 'apicircle/wb-aaa', commit: { sha: 'sha-remote-rewrite' } } },
        fileContents(remote, 'sha-blob'),
        // compareCommits → diverged (force-push case)
        { body: { status: 'diverged', ahead_by: 1, behind_by: 1 } },
      ]),
    );

    const result = await useWorkspaceStore.getState().refreshWorkspace();
    expect(result.status).toBe('history-rewritten');
    const pending = useWorkspaceStore.getState().pendingRefresh!;
    expect(pending.historyRewritten).toBe(true);
    // synced doc untouched until user picks a side via the modal.
    expect(useWorkspaceStore.getState().synced!.environments.activeName).toBe(
      localSynced.environments.activeName,
    );
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
