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

    // Verify the createTree request body carried `workspace.json` inline.
    const createTreeCall = fetchMock.mock.calls[2];
    const body = JSON.parse((createTreeCall[1] as RequestInit).body as string) as {
      base_tree: string;
      tree: { path: string; content?: string }[];
    };
    expect(body.base_tree).toBe('tree-old');
    expect(body.tree[0].path).toBe('workspace.json');
    expect(body.tree[0].content).toContain('"schemaVersion": 1');
  });

  it('uses the user-supplied commit message when present', async () => {
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace('feat: rename request');

    const createCommitCall = fetchMock.mock.calls[3];
    const body = JSON.parse((createCommitCall[1] as RequestInit).body as string) as {
      message: string;
    };
    expect(body.message).toBe('feat: rename request');
  });

  it('falls back to the canonical commit message when the user passes empty/whitespace', async () => {
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace('   ');
    const body = JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string) as {
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
        sha256: 'aabb',
      },
    });

    const fetchMock = queuedFetch([
      // getRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      // getCommit
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
    const createBlobCall = fetchMock.mock.calls[2];
    expect(createBlobCall[0]).toBe('https://api.github.com/repos/me/api/git/blobs');
    const blobBody = JSON.parse((createBlobCall[1] as RequestInit).body as string) as {
      content: string;
      encoding: string;
    };
    expect(blobBody.encoding).toBe('base64');
    expect(blobBody.content).toBe(btoa(String.fromCharCode(...bytes)));

    // createTree body has both workspace.json (content) and the attachment (sha).
    const createTreeCall = fetchMock.mock.calls[3];
    const treeBody = JSON.parse((createTreeCall[1] as RequestInit).body as string) as {
      tree: { path: string; content?: string; sha?: string }[];
    };
    expect(treeBody.tree).toHaveLength(2);
    expect(treeBody.tree[0]).toMatchObject({ path: 'workspace.json' });
    expect(treeBody.tree[1]).toMatchObject({
      path: `.apicircle/attachments/${slotId}`,
      sha: 'blob-1',
    });
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
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      // No createBlob — straight to createTree.
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().pushWorkspace();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    // Tree carries only workspace.json — no attachment entry was added.
    const treeBody = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string) as {
      tree: { path: string }[];
    };
    expect(treeBody.tree).toHaveLength(1);
    expect(treeBody.tree[0].path).toBe('workspace.json');
  });

  it('propagates GitHub errors mid-flow without partial state mutation', async () => {
    await setupConnectedBranch();

    const fetchMock = queuedFetch([
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
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
});
