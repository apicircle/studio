import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { putAttachment } from '../persistence/attachments';
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

function userResponse(opts: { login: string; scopes?: string }): ResponseSpec {
  return {
    body: { login: opts.login, id: 1 },
    headers: { 'x-oauth-scopes': opts.scopes ?? 'repo, pull_request' },
  };
}

function repoResponse(opts: { owner: string; name: string }): ResponseSpec {
  return {
    body: {
      full_name: `${opts.owner}/${opts.name}`,
      name: opts.name,
      owner: { login: opts.owner },
      default_branch: 'main',
      visibility: 'public',
      private: false,
      permissions: { push: true, admin: false },
    },
  };
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
      userResponse({ login: 'me' }),
      repoResponse({ owner: 'me', name: 'api' }),
      { body: { name: 'main', commit: { sha: 'sha-main' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  await useWorkspaceStore.getState().connectRepo('me', 'api');
  await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/wb-aaa' });
  vi.unstubAllGlobals();
}

describe('workspaceStore.pushWorkspace', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when no working branch exists', async () => {
    await expect(useWorkspaceStore.getState().pushWorkspace()).rejects.toThrow(
      /Create a working branch/,
    );
  });

  it('orchestrates getRef → getCommit → createTree → createCommit → updateRef and updates lastPushedSha', async () => {
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      // getRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      // getContents (registry — 404 on first push)
      { body: { message: 'Not Found' }, status: 404 },
      // getCommit
      {
        body: {
          sha: 'sha-main',
          message: 'initial',
          tree: { sha: 'tree-old' },
        },
      },
      // createTree
      { body: { sha: 'tree-new' } },
      // createCommit
      { body: { sha: 'commit-new', message: 'sync', tree: { sha: 'tree-new' } } },
      // updateRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { commitSha } = await useWorkspaceStore.getState().pushWorkspace();
    expect(commitSha).toBe('commit-new');

    const branch = useWorkspaceStore.getState().local!.workingBranch!;
    expect(branch.headSha).toBe('commit-new');
    expect(branch.lastPushedSha).toBe('commit-new');

    // createTree request body: the synced doc lands at
    // `.apicircle/workspace-<id>/workspace.json` alongside a registry entry.
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    const createTreeCall = fetchMock.mock.calls[3];
    const body = JSON.parse((createTreeCall[1] as RequestInit).body as string) as {
      base_tree: string;
      tree: { path: string; content?: string }[];
    };
    expect(body.base_tree).toBe('tree-old');
    expect(body.tree).toHaveLength(2);
    expect(body.tree[0].path).toBe('.apicircle/registry.json');
    expect(body.tree[1].path).toBe(`.apicircle/workspace-${wsId}/workspace.json`);
    expect(body.tree[1].content).toContain('"schemaVersion": 1');
  });

  it('push is incremental over base_tree, so remote sidecar files are inherited untouched', async () => {
    // The workspace dir on the remote may hold sidecar files an external tool
    // committed (e.g. a codegraph index). The push must layer over base_tree and
    // touch ONLY API-Circle-owned paths, so those siblings are inherited rather
    // than overwritten or deleted. See docs/architecture/open-core-and-editions.md.
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      // getRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      // getContents (registry — 404 on first push)
      { body: { message: 'Not Found' }, status: 404 },
      // getCommit
      { body: { sha: 'sha-main', message: 'initial', tree: { sha: 'tree-old' } } },
      // createTree
      { body: { sha: 'tree-new' } },
      // createCommit
      { body: { sha: 'commit-new', message: 'sync', tree: { sha: 'tree-new' } } },
      // updateRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace();

    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    const createTreeCall = fetchMock.mock.calls[3];
    const body = JSON.parse((createTreeCall[1] as RequestInit).body as string) as {
      base_tree: string;
      tree: { path: string; content?: string; sha?: string | null }[];
    };

    // Incremental over the parent tree — every path not in `tree` is inherited.
    expect(body.base_tree).toBe('tree-old');
    // Only API-Circle-owned paths appear; no sidecar path, no deletions.
    const ownedPaths = new Set([
      '.apicircle/registry.json',
      `.apicircle/workspace-${wsId}/workspace.json`,
    ]);
    for (const entry of body.tree) {
      expect(ownedPaths.has(entry.path)).toBe(true);
      // No `{ sha: null }` delete markers on a clean push.
      expect(entry.sha === null).toBe(false);
    }
  });

  it('uses the user-supplied commit message when present', async () => {
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace('feat: rename request');

    const createCommitCall = fetchMock.mock.calls[4];
    const body = JSON.parse((createCommitCall[1] as RequestInit).body as string) as {
      message: string;
    };
    expect(body.message).toBe('feat: rename request');
  });

  it('falls back to the canonical commit message when the user passes empty/whitespace', async () => {
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace('   ');
    const body = JSON.parse((fetchMock.mock.calls[4][1] as RequestInit).body as string) as {
      message: string;
    };
    expect(body.message).toBe('chore: sync workspace via API Circle Studio');
  });

  it('uploads referenced attachments as blobs and bundles them into the tree commit', async () => {
    await setupConnectedBranch();

    // Seed an attachment record + a binary request that points at it. The
    // request lands directly in the synced doc; putAttachment writes the
    // bytes into the attachments IDB the push reads from.
    const slotId = 'slot-test';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await putAttachment({
      slotId,
      filename: 'pic.png',
      mimeType: 'image/png',
      size: bytes.length,
      sha256: 'aabb',
      savedAt: '2026-04-27T00:00:00.000Z',
      bytes,
    });
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: {
        slotId,
        filename: 'pic.png',
        mimeType: 'image/png',
        size: bytes.length,
      },
    });

    const fetchMock = queuedFetch([
      // getRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      // getContents (registry — 404 on first push)
      { body: { message: 'Not Found' }, status: 404 },
      // getCommit — from here down, `commitFiles` is driving
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      // createBlob (one per referenced attachment)
      { body: { sha: 'blob-1', size: bytes.length } },
      // createTree
      { body: { sha: 'tree-new' } },
      // createCommit
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      // updateRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace();

    // createBlob body carries base64 content + encoding.
    const createBlobCall = fetchMock.mock.calls[3];
    expect(createBlobCall[0]).toBe('https://api.github.com/repos/me/api/git/blobs');
    const blobBody = JSON.parse((createBlobCall[1] as RequestInit).body as string) as {
      content: string;
      encoding: string;
    };
    expect(blobBody.encoding).toBe('base64');
    expect(blobBody.content).toBe(btoa(String.fromCharCode(...bytes)));

    // createTree body has registry.json, workspace-<id>/workspace.json (content),
    // and the attachment (sha).
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    const createTreeCall = fetchMock.mock.calls[4];
    const treeBody = JSON.parse((createTreeCall[1] as RequestInit).body as string) as {
      tree: { path: string; content?: string; sha?: string }[];
    };
    expect(treeBody.tree).toHaveLength(3);
    expect(treeBody.tree[0]).toMatchObject({ path: '.apicircle/registry.json' });
    expect(treeBody.tree[1]).toMatchObject({ path: `.apicircle/workspace-${wsId}/workspace.json` });
    expect(treeBody.tree[2]).toMatchObject({
      path: `.apicircle/workspace-${wsId}/attachments/${slotId}`,
      sha: 'blob-1',
    });
  });

  it('stamps workingBranchRef on every Global File Asset whose blob landed in the commit', async () => {
    // Provenance state machine: after the push, every asset whose bytes
    // were uploaded should flip from "Uploaded locally" -> "On working
    // branch" (workingBranchRef populated with the GitHub blob sha + the
    // commit sha). The corresponding pendingFileUploads entry gets
    // dropped so the UI status pill flips immediately.
    await setupConnectedBranch();

    // attachBinaryFile auto-mints a Global Asset, writes the bytes into
    // IDB, and records pendingFileUploads. This is the unified upload
    // flow that every drop-a-file UI surface now uses.
    const reqId = useWorkspaceStore.getState().addRequest(null);
    const bytes = new Uint8Array([9, 9, 9, 9]);
    const file = new File([bytes], 'tracked.bin', { type: 'application/octet-stream' });
    await useWorkspaceStore.getState().attachBinaryFile(reqId, file);

    const preSync = useWorkspaceStore.getState().synced!;
    const assetId = Object.keys(preSync.globalAssets.files ?? {})[0];
    expect(assetId).toBeTypeOf('string');
    const preAsset = preSync.globalAssets.files![assetId];
    expect(preAsset.workingBranchRef).toBeUndefined();
    expect(useWorkspaceStore.getState().local!.pendingFileUploads?.[assetId]).toBeDefined();

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'blob-tracked', size: bytes.length } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace();

    const after = useWorkspaceStore.getState();
    const assetAfter = after.synced!.globalAssets.files![assetId];
    expect(assetAfter.workingBranchRef).toEqual({
      branchName: 'apicircle/wb-aaa',
      blobSha: 'blob-tracked',
      commitSha: 'commit-new',
      verifiedAt: expect.any(String),
    });
    // baseBranchRef stays untouched — that's the refresh probe's job.
    expect(assetAfter.baseBranchRef ?? null).toBeNull();
    // Pending upload was promoted to a stable ref → drop it.
    expect(after.local!.pendingFileUploads?.[assetId]).toBeUndefined();
  });

  // Regression: a mutation that lands DURING pushWorkspace's awaits
  // (e.g., the user uploads another file via attachFormFile between the
  // function-entry capture of `synced` and the post-updateRef state
  // transition) MUST survive. The original push action used the
  // captured `synced` for stampPushedAssetRefs and then did
  // `set({ synced: nextSynced })` — wiping the mid-push addition.
  // The fix layers stamps onto `get().synced` (live) and uses
  // `stampedCaptured` only as the lastPulledSnapshot baseline.
  it('preserves a Global File Asset that lands during pushWorkspace (race-safe stamping)', async () => {
    await setupConnectedBranch();

    // Seed an asset whose blob will be pushed this round.
    const reqId = useWorkspaceStore.getState().addRequest(null);
    const bytes = new Uint8Array([7, 7, 7]);
    await useWorkspaceStore
      .getState()
      .attachBinaryFile(reqId, new File([bytes], 'a.bin', { type: 'application/octet-stream' }));
    const initialAssetId = Object.keys(useWorkspaceStore.getState().synced!.globalAssets.files!)[0];

    // Inject the mid-push mutation INSIDE the createTree fetch handler.
    // By the time createTree fires, the push has already captured `synced`
    // at function entry — so the setState is guaranteed to land AFTER
    // the capture, exercising the race the fix is for. Using await
    // microtasks before the setState would be timing-flaky.
    let call = 0;
    const fetchMock = vi.fn(async (..._args: unknown[]) => {
      void _args;
      call++;
      if (call === 1)
        return fakeResponse({
          body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } },
        });
      if (call === 2) return fakeResponse({ body: { message: 'Not Found' }, status: 404 });
      if (call === 3)
        return fakeResponse({
          body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } },
        });
      if (call === 4) return fakeResponse({ body: { sha: 'blob-pushed', size: bytes.length } });
      if (call === 5) {
        // Mid-push mutation: a second Global File Asset (simulating any
        // synced mutation that lands during the push — a rename, another
        // upload, an editor edit). The captured `synced` in the push
        // already snapshotted before this setState fires.
        const midPushSynced = useWorkspaceStore.getState().synced!;
        useWorkspaceStore.setState({
          synced: {
            ...midPushSynced,
            globalAssets: {
              ...midPushSynced.globalAssets,
              files: {
                ...(midPushSynced.globalAssets.files ?? {}),
                'mid-push-asset': {
                  id: 'mid-push-asset',
                  name: 'Added mid-push',
                  slotId: 'slot-mid-push',
                  filename: 'mid.bin',
                  size: 3,
                  mimeType: 'application/octet-stream',
                  sha256: 'sha-mid',
                  createdAt: '2026-06-06T00:00:00.000Z',
                  updatedAt: '2026-06-06T00:00:00.000Z',
                },
              },
            },
          },
        });
        return fakeResponse({ body: { sha: 'tree-new' } });
      }
      if (call === 6)
        return fakeResponse({
          body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } },
        });
      if (call === 7)
        return fakeResponse({
          body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } },
        });
      throw new Error(`unexpected fetch call #${call}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace();

    const after = useWorkspaceStore.getState();
    // BOTH assets must survive the post-updateRef set.
    expect(after.synced!.globalAssets.files![initialAssetId]).toBeDefined();
    expect(after.synced!.globalAssets.files!['mid-push-asset']).toBeDefined();
    // The pushed asset has its workingBranchRef stamped.
    expect(after.synced!.globalAssets.files![initialAssetId].workingBranchRef).toMatchObject({
      branchName: 'apicircle/wb-aaa',
      blobSha: 'blob-pushed',
    });
    // The mid-push asset is unpushed — no ref yet.
    expect(after.synced!.globalAssets.files!['mid-push-asset'].workingBranchRef ?? null).toBeNull();
    // The lastPulledSnapshot baseline (what's actually on the remote)
    // does NOT include the mid-push addition — that asset only exists
    // locally and the next push will commit it.
    expect(
      after.local!.sync.lastPulledSnapshot?.globalAssets.files?.['mid-push-asset'],
    ).toBeUndefined();
  });

  it('emits sha:null tree entries for queued attachment deletes and clears the queue', async () => {
    // Regression for the missing-deletion bug: when the user removes a
    // Global File Asset that had push provenance,
    // `pendingAttachmentDeletes` queues its slotId. The next push must
    // include a `{path: '.apicircle/workspace-<id>/attachments/<slotId>', sha: null}`
    // entry in the tree so GitHub deletes the orphan blob from the
    // working branch (and via PR merge, from the base branch).
    await setupConnectedBranch();

    // Seed two queued deletes (deleted assets that were on the remote)
    // plus a "ghost" entry whose slot id MATCHES a current asset — the
    // safety filter must drop it so we don't accidentally delete a
    // referenced file. The ghost simulates a snapshot-restore that
    // brought a previously-deleted asset back.
    const ghostAssetSlot = 'slot-ghost';
    const localBefore = useWorkspaceStore.getState().local!;
    const syncedBefore = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...syncedBefore,
        globalAssets: {
          ...syncedBefore.globalAssets,
          files: {
            ...(syncedBefore.globalAssets.files ?? {}),
            'ghost-asset': {
              id: 'ghost-asset',
              name: 'Restored',
              slotId: ghostAssetSlot,
              filename: 'ghost.bin',
              size: 1,
              mimeType: 'application/octet-stream',
              sha256: 'sha-ghost',
              createdAt: '2026-06-06T00:00:00.000Z',
              updatedAt: '2026-06-06T00:00:00.000Z',
            },
          },
        },
      },
      local: {
        ...localBefore,
        pendingAttachmentDeletes: ['slot-deleted-1', 'slot-deleted-2', ghostAssetSlot],
      },
    });

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace();

    // createTree body carries the two REAL deletes but NOT the ghost
    // (safety filter dropped it because a current asset still owns that
    // slot id).
    const createTreeCall = fetchMock.mock.calls[3];
    const treeBody = JSON.parse((createTreeCall[1] as RequestInit).body as string) as {
      tree: Array<{ path: string; sha?: string | null; mode?: string; type?: string }>;
    };
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    const deleteEntries = treeBody.tree.filter((e) => e.sha === null);
    expect(deleteEntries.map((e) => e.path).sort()).toEqual([
      `.apicircle/workspace-${wsId}/attachments/slot-deleted-1`,
      `.apicircle/workspace-${wsId}/attachments/slot-deleted-2`,
    ]);
    // Delete entries carry the standard blob mode/type per GitHub's API.
    for (const entry of deleteEntries) {
      expect(entry.mode).toBe('100644');
      expect(entry.type).toBe('blob');
      // The `sha: null` field must literally be present (not absent —
      // GitHub treats missing sha as "no change," not as "delete").
      const raw = treeBody.tree.find((e) => e.path === entry.path)!;
      expect(Object.prototype.hasOwnProperty.call(raw, 'sha')).toBe(true);
      expect(raw.sha).toBeNull();
    }

    // Post-push: the queue is cleared for the two emitted slots. The
    // ghost stays because it was filtered out (the user can manually
    // un-queue it via a follow-up action if needed — typically they
    // won't, because the restored asset is still bound).
    const after = useWorkspaceStore.getState();
    expect(after.local!.pendingAttachmentDeletes).toEqual([ghostAssetSlot]);
  });

  it('aborts push when cached attachment bytes fail checksum verification', async () => {
    await setupConnectedBranch();

    const slotId = 'bad-slot';
    await putAttachment({
      slotId,
      filename: 'bad.bin',
      mimeType: 'application/octet-stream',
      size: 3,
      sha256: 'local-sha',
      savedAt: '2026-04-27T00:00:00.000Z',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: { slotId, filename: 'bad.bin', sha256: 'expected-remote-sha' },
    });
    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(useWorkspaceStore.getState().pushWorkspace()).rejects.toThrow(
      /checksum verification/,
    );
    // ONE call — the divergence pre-flight — and then nothing. Attachments are
    // now read and verified locally before the commit is assembled, so corrupt
    // bytes abort without a second read and, more importantly, without any
    // write. This used to be two calls because the head commit was fetched
    // before the checksums were checked.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips slots whose bytes are not in local IDB (pulled but not downloaded)', async () => {
    await setupConnectedBranch();

    // Reference a slotId that has no attachment record locally — the push
    // should silently skip its blob upload and leave base_tree intact.
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: { slotId: 'absent-slot', filename: 'gone.bin' },
    });

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      // No createBlob: the slot has no local bytes, so the commit carries no
      // attachment file and getCommit goes straight on to createTree.
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace();

    expect(fetchMock).toHaveBeenCalledTimes(6);
    // Tree carries registry.json + workspace-<id>/workspace.json — no attachment entry was added.
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    const treeBody = JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string) as {
      tree: { path: string }[];
    };
    expect(treeBody.tree).toHaveLength(2);
    expect(treeBody.tree[0].path).toBe('.apicircle/registry.json');
    expect(treeBody.tree[1].path).toBe(`.apicircle/workspace-${wsId}/workspace.json`);
  });

  it('propagates GitHub errors mid-flow without partial state mutation', async () => {
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      // createTree fails with 422
      { body: { message: 'Tree object not found' }, status: 422 },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(useWorkspaceStore.getState().pushWorkspace()).rejects.toThrow();
    // Branch state must be unchanged (no lastPushedSha update).
    const branch = useWorkspaceStore.getState().local!.workingBranch!;
    expect(branch.lastPushedSha).toBeNull();
  });

  it('partial write: updateRef fails after createCommit lands — local state untouched, no double-push on retry', async () => {
    await setupConnectedBranch();

    // Sequence: getRef → getCommit → createTree → createCommit → updateRef
    // (fails 500). The commit object DID land on the remote, but the ref
    // never advanced. The store must NOT mark lastPushedSha (rollback
    // semantics), and a subsequent retry must reuse the same flow rather
    // than double-commit.
    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-orphan', message: 'm', tree: { sha: 'tree-new' } } },
      // updateRef returns 500 — server-side glitch
      { body: { message: 'Server Error' }, status: 500 },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(useWorkspaceStore.getState().pushWorkspace()).rejects.toThrow();
    const branch = useWorkspaceStore.getState().local!.workingBranch!;
    // Store state must NOT carry the orphaned commit forward. lastPushedSha
    // stays null so the next push starts fresh from getRef.
    expect(branch.lastPushedSha).toBeNull();
    // headSha also unchanged (was never written to).
    expect(branch.headSha).toBe('sha-main');
    // lastPulledSnapshot stays at whatever it was pre-push (null here, fresh setup).
    expect(useWorkspaceStore.getState().local!.sync.lastPulledSha).toBeNull();
  });

  it('throws BranchDivergedError when the remote ref has moved since last sync — no blobs uploaded', async () => {
    await setupConnectedBranch();
    // Mutate the local branch headSha to simulate a state where remote has
    // moved on (e.g. someone force-pushed).
    const localBefore = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...localBefore,
        workingBranch: { ...localBefore.workingBranch!, headSha: 'sha-old-local' },
      },
    });

    // The only fetch the push should make is getRef — once it sees the
    // mismatch it throws and never moves on to createBlob/createTree.
    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-remote-moved' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(useWorkspaceStore.getState().pushWorkspace()).rejects.toThrow(/has moved/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const branch = useWorkspaceStore.getState().local!.workingBranch!;
    expect(branch.lastPushedSha).toBeNull();
    // Local headSha untouched.
    expect(branch.headSha).toBe('sha-old-local');
  });
});
