import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeError } from '@apicircle/git';
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

async function setupConnectedBranchPushed(): Promise<void> {
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
      // createWorkingBranch's first-pull-prompt probe: GET .apicircle/workspace-<id>/workspace.json
      // on the new branch. 404 = no remote content yet (expected for a freshly
      // created branch), so the probe is a no-op.
      { status: 404, body: { message: 'Not Found' } },
      // push flow: getRef, getCommit, createTree, createCommit, updateRef
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'sha-main' } } },
      { body: { sha: 'sha-main', message: 'i', tree: { sha: 'tree-old' } } },
      { body: { sha: 'tree-new' } },
      { body: { sha: 'commit-new', message: 'm', tree: { sha: 'tree-new' } } },
      { body: { ref: 'refs/heads/apicircle/wb-aaa', object: { sha: 'commit-new' } } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  await useWorkspaceStore.getState().connectRepo('me', 'api');
  await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/wb-aaa' });
  await useWorkspaceStore.getState().pushWorkspace();
  vi.unstubAllGlobals();
}

describe('workspaceStore.createPullRequest', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when no working branch exists', async () => {
    await expect(useWorkspaceStore.getState().createPullRequest()).rejects.toThrow(
      /Create a working branch first/,
    );
  });

  it('throws when nothing has been pushed yet', async () => {
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
        // first-pull-prompt probe: 404 = empty branch
        { status: 404, body: { message: 'Not Found' } },
      ]),
    );
    await useWorkspaceStore.getState().connectGitHubSession('tok');
    await useWorkspaceStore.getState().connectRepo('me', 'api');
    await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/wb-aaa' });
    vi.unstubAllGlobals();

    await expect(useWorkspaceStore.getState().createPullRequest()).rejects.toThrow(
      /Push to save before opening a PR/,
    );
  });

  it('POSTs the PR with title/body/head/base and persists openPrUrl on success', async () => {
    await setupConnectedBranchPushed();

    const fetchMock = queuedFetch([
      {
        body: {
          number: 42,
          html_url: 'https://github.com/me/api/pull/42',
          state: 'open',
          title: 'Custom title',
        },
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { number, htmlUrl } = await useWorkspaceStore.getState().createPullRequest({
      title: 'Custom title',
      body: 'changelog goes here',
    });
    expect(number).toBe(42);
    expect(htmlUrl).toBe('https://github.com/me/api/pull/42');

    const branch = useWorkspaceStore.getState().local!.workingBranch!;
    expect(branch.openPrUrl).toBe('https://github.com/me/api/pull/42');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/pulls');
    const body = JSON.parse((init as RequestInit).body as string) as {
      title: string;
      body: string;
      head: string;
      base: string;
      draft: boolean;
    };
    expect(body).toEqual({
      title: 'Custom title',
      body: 'changelog goes here',
      head: 'apicircle/wb-aaa',
      base: 'main',
      draft: false,
    });
  });

  it('falls back to the default title when caller passes empty/whitespace', async () => {
    await setupConnectedBranchPushed();

    const fetchMock = queuedFetch([
      { body: { number: 1, html_url: 'u', state: 'open', title: 'API Circle workspace updates' } },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    await useWorkspaceStore.getState().createPullRequest({ title: '   ' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      title: string;
    };
    expect(body.title).toBe('API Circle workspace updates');
  });

  it('throws when a PR is already open for this branch and includes the PR URL', async () => {
    await setupConnectedBranchPushed();
    // First open populates openPrUrl.
    const prUrl = 'https://github.com/o/r/pull/42';
    vi.stubGlobal(
      'fetch',
      queuedFetch([{ body: { number: 42, html_url: prUrl, state: 'open', title: 't' } }]),
    );
    await useWorkspaceStore.getState().createPullRequest();
    vi.unstubAllGlobals();

    await expect(useWorkspaceStore.getState().createPullRequest()).rejects.toThrow(
      new RegExp(`already open.*${prUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });

  it('surfaces MissingScopeError from a 403 with `pull_request` missing', async () => {
    await setupConnectedBranchPushed();

    vi.stubGlobal(
      'fetch',
      queuedFetch([
        {
          body: { message: 'Resource not accessible by personal access token' },
          status: 403,
          headers: { 'x-oauth-scopes': 'repo' },
        },
      ]),
    );
    await expect(useWorkspaceStore.getState().createPullRequest()).rejects.toBeInstanceOf(
      MissingScopeError,
    );
    // openPrUrl must remain null after a failed attempt.
    expect(useWorkspaceStore.getState().local!.workingBranch!.openPrUrl).toBeNull();
  });
});
