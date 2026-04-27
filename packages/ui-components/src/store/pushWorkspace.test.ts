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
