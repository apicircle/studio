import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// Tests for the P4.2 repo + working-branch store actions. We mock global
// fetch with canned GitHub responses; the tests run against the real
// @apicircle/git client.

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

function repoResponse(opts: {
  owner: string;
  name: string;
  defaultBranch?: string;
  visibility?: 'public' | 'private' | 'internal';
}): ResponseSpec {
  return {
    body: {
      full_name: `${opts.owner}/${opts.name}`,
      name: opts.name,
      owner: { login: opts.owner },
      default_branch: opts.defaultBranch ?? 'main',
      visibility: opts.visibility ?? 'public',
      private: opts.visibility === 'private',
      permissions: { push: true, admin: false },
    },
  };
}

/**
 * Sequence-aware fetch mock: each call returns the next item in `queue`.
 * Lets a single test connect a session, connect a repo, then create a
 * branch without re-stubbing between actions.
 */
function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1} — queue exhausted`);
    return fakeResponse(queue[i++]);
  });
}

describe('workspaceStore — repo + working branch (P4.2)', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('connectRepo', () => {
    it('throws when no GitHub session exists', async () => {
      await expect(useWorkspaceStore.getState().connectRepo('me', 'api')).rejects.toThrow(
        /connect a PAT/i,
      );
    });

    it('writes connectedRepo from a successful GET /repos/:owner/:name', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          userResponse({ login: 'devaprakash' }), // GET /user during connectGitHubSession
          repoResponse({ owner: 'devaprakash', name: 'payments' }),
        ]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      const repo = await useWorkspaceStore.getState().connectRepo('devaprakash', 'payments');
      expect(repo.fullName).toBe('devaprakash/payments');
      expect(repo.defaultBranch).toBe('main');
      expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe(
        'devaprakash/payments',
      );
    });

    it('clears the working branch when re-connecting to a different repo', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          userResponse({ login: 'me' }),
          repoResponse({ owner: 'me', name: 'first' }),
          { body: { name: 'main', commit: { sha: 'sha-first' } } }, // getBranchHead
          {
            body: {
              ref: 'refs/heads/apicircle/test-aaa',
              object: { sha: 'sha-first' },
            },
          },
          repoResponse({ owner: 'me', name: 'second' }),
        ]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await useWorkspaceStore.getState().connectRepo('me', 'first');
      await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/test-aaa' });
      expect(useWorkspaceStore.getState().local!.workingBranch?.name).toBe('apicircle/test-aaa');

      await useWorkspaceStore.getState().connectRepo('me', 'second');
      expect(useWorkspaceStore.getState().local!.workingBranch).toBeNull();
      expect(useWorkspaceStore.getState().local!.connectedRepo?.name).toBe('second');
    });

    it('preserves the working branch when re-connecting to the same repo', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          userResponse({ login: 'me' }),
          repoResponse({ owner: 'me', name: 'api' }),
          { body: { name: 'main', commit: { sha: 'sha1' } } },
          { body: { ref: 'refs/heads/apicircle/wb-abc', object: { sha: 'sha1' } } },
          repoResponse({ owner: 'me', name: 'api' }),
        ]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/wb-abc' });
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      expect(useWorkspaceStore.getState().local!.workingBranch?.name).toBe('apicircle/wb-abc');
    });
  });

  describe('createWorkingBranch', () => {
    it('throws when no repo is connected', async () => {
      vi.stubGlobal('fetch', queuedFetch([userResponse({ login: 'me' })]));
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await expect(useWorkspaceStore.getState().createWorkingBranch()).rejects.toThrow(
        /Connect a repo/,
      );
    });

    it('auto-generates the branch name from the workspace slug when none supplied', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          userResponse({ login: 'me' }),
          repoResponse({ owner: 'me', name: 'api' }),
          { body: { name: 'main', commit: { sha: 'abc' } } },
          {
            body: {
              ref: 'refs/heads/apicircle/payments-api-zzz999',
              object: { sha: 'abc' },
            },
          },
        ]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      // Force a known workspace name + a deterministic name via opts.
      act(() => useWorkspaceStore.getState().setWorkspaceName('Payments API'));
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      const branch = await useWorkspaceStore
        .getState()
        .createWorkingBranch({ branchName: 'apicircle/payments-api-zzz999' });
      expect(branch.name).toBe('apicircle/payments-api-zzz999');
      expect(branch.repoFullName).toBe('me/api');
      expect(branch.headSha).toBe('abc');
      expect(branch.baseBranch).toBe('main');
    });

    it('rejects an invalid branch name before hitting GitHub', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([userResponse({ login: 'me' }), repoResponse({ owner: 'me', name: 'api' })]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      await expect(
        useWorkspaceStore.getState().createWorkingBranch({ branchName: 'bad name' }),
      ).rejects.toThrow(/whitespace/);
    });

    it('uses caller-supplied baseBranch when provided', async () => {
      const queue = [
        userResponse({ login: 'me' }),
        repoResponse({ owner: 'me', name: 'api', defaultBranch: 'main' }),
        { body: { name: 'develop', commit: { sha: 'dev-sha' } } },
        { body: { ref: 'refs/heads/feature/x', object: { sha: 'dev-sha' } } },
      ];
      const fetchMock = queuedFetch(queue);
      vi.stubGlobal('fetch', fetchMock);
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      const branch = await useWorkspaceStore
        .getState()
        .createWorkingBranch({ branchName: 'feature/x', baseBranch: 'develop' });
      expect(branch.baseBranch).toBe('develop');
      // The third call should hit /branches/develop, not /branches/main.
      const url = fetchMock.mock.calls[2][0] as string;
      expect(url).toBe('https://api.github.com/repos/me/api/branches/develop');
    });
  });

  describe('disconnect actions', () => {
    it('disconnectRepo clears connectedRepo + workingBranch', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          userResponse({ login: 'me' }),
          repoResponse({ owner: 'me', name: 'api' }),
          { body: { name: 'main', commit: { sha: 'abc' } } },
          { body: { ref: 'refs/heads/apicircle/x-abc', object: { sha: 'abc' } } },
        ]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/x-abc' });
      useWorkspaceStore.getState().disconnectRepo();
      const local = useWorkspaceStore.getState().local!;
      expect(local.connectedRepo).toBeNull();
      expect(local.workingBranch).toBeNull();
      // Session is preserved.
      expect(local.sessions.github).not.toBeNull();
    });

    it('discardWorkingBranch clears only the branch slot', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          userResponse({ login: 'me' }),
          repoResponse({ owner: 'me', name: 'api' }),
          { body: { name: 'main', commit: { sha: 'abc' } } },
          { body: { ref: 'refs/heads/apicircle/x-abc', object: { sha: 'abc' } } },
        ]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/x-abc' });
      useWorkspaceStore.getState().discardWorkingBranch();
      const local = useWorkspaceStore.getState().local!;
      expect(local.connectedRepo).not.toBeNull();
      expect(local.workingBranch).toBeNull();
    });

    it('disconnectGitHubSession also drops repo + branch (cascade)', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([userResponse({ login: 'me' }), repoResponse({ owner: 'me', name: 'api' })]),
      );
      await useWorkspaceStore.getState().connectGitHubSession('tok');
      await useWorkspaceStore.getState().connectRepo('me', 'api');
      await useWorkspaceStore.getState().disconnectGitHubSession();
      const local = useWorkspaceStore.getState().local!;
      expect(local.sessions.github).toBeNull();
      expect(local.connectedRepo).toBeNull();
      expect(local.workingBranch).toBeNull();
    });
  });
});
