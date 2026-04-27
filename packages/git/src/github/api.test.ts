import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './api';
import { GitHubError, MissingScopeError, RateLimitedError, UnauthorizedError } from './errors';

function jsonResponse(
  body: unknown,
  init: ResponseInit & { headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('GitHubClient.getViewer', () => {
  it('returns viewer + parsed scopes on 200', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { login: 'devaprakash', id: 42, name: 'Deva Prakash', avatar_url: 'https://x' },
        { headers: { 'x-oauth-scopes': 'repo, pull_request' } },
      ),
    );
    const client = new GitHubClient({ fetchImpl });
    const result = await client.getViewer('tok');
    expect(result.viewer).toEqual({
      login: 'devaprakash',
      id: 42,
      name: 'Deva Prakash',
      avatarUrl: 'https://x',
    });
    expect(result.scopes.granted).toEqual(['repo', 'pull_request']);
  });

  it('treats null name + missing avatar as null fields', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ login: 'u', id: 1 }));
    const client = new GitHubClient({ fetchImpl });
    const result = await client.getViewer('tok');
    expect(result.viewer).toEqual({ login: 'u', id: 1, name: null, avatarUrl: null });
  });

  it('forwards Bearer token, accept header, and api version', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ login: 'u', id: 1 }));
    const client = new GitHubClient({ fetchImpl });
    await client.getViewer('tok-secret');
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    const [, init] = calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-secret');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('throws UnauthorizedError on 401', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' }),
    );
    const client = new GitHubClient({ fetchImpl });
    await expect(client.getViewer('bad')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws MissingScopeError when accepted-scopes header is set on 403', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { message: 'Resource not accessible by personal access token' },
        {
          status: 403,
          headers: {
            'x-oauth-scopes': 'repo',
            'x-accepted-oauth-scopes': 'repo, pull_request',
          },
        },
      ),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.getViewer('tok');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingScopeError);
      const e = err as MissingScopeError;
      expect(e.missingScopes).toEqual(['pull_request']);
      expect(e.grantedScopes).toEqual(['repo']);
    }
  });

  it('falls back to caller-supplied requiredScopes when accepted header is empty', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { message: 'Forbidden' },
        { status: 403, headers: { 'x-oauth-scopes': 'repo' } },
      ),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.getViewer('tok', { requiredScopes: ['repo', 'pull_request'] });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingScopeError);
      expect((err as MissingScopeError).missingScopes).toEqual(['pull_request']);
    }
  });

  it('throws RateLimitedError when remaining=0 on 403', async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { message: 'rate limited' },
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
          },
        },
      ),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.getViewer('tok');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitedError);
      expect((err as RateLimitedError).resetAtMs).toBe(reset * 1000);
    }
  });

  it('throws plain GitHubError on other non-2xx (e.g. 500)', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'boom' }, { status: 500, statusText: 'Internal' }),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.getViewer('tok');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).status).toBe(500);
      expect((err as Error).message).toBe('boom');
    }
  });

  it('survives non-JSON error responses without crashing', async () => {
    const fetchImpl: typeof fetch = vi.fn(
      async () => new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.getViewer('tok');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).status).toBe(502);
    }
  });

  it('aborts on timeout', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        });
      });
    const client = new GitHubClient({ fetchImpl, timeoutMs: 30 });
    await expect(client.getViewer('tok')).rejects.toThrow(/timed out/);
  });
});

describe('GitHubClient.listAccessibleRepos', () => {
  it('normalizes the raw payload into GitHubRepo[] with derived flags', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse([
        {
          full_name: 'me/payments-api',
          name: 'payments-api',
          owner: { login: 'me' },
          default_branch: 'main',
          private: false,
          visibility: 'public',
          permissions: { push: true, admin: true },
        },
        {
          full_name: 'org/secret-stuff',
          name: 'secret-stuff',
          owner: { login: 'org' },
          default_branch: 'develop',
          private: true,
          visibility: 'private',
          permissions: { push: false, admin: false },
        },
      ]),
    );
    const client = new GitHubClient({ fetchImpl });
    const repos = await client.listAccessibleRepos('tok');
    expect(repos).toEqual([
      {
        fullName: 'me/payments-api',
        owner: 'me',
        name: 'payments-api',
        defaultBranch: 'main',
        visibility: 'public',
        isPrivate: false,
        pushable: true,
      },
      {
        fullName: 'org/secret-stuff',
        owner: 'org',
        name: 'secret-stuff',
        defaultBranch: 'develop',
        visibility: 'private',
        isPrivate: true,
        pushable: false,
      },
    ]);
  });

  it('infers visibility/isPrivate when only the legacy `private` flag is present', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse([
        {
          full_name: 'me/x',
          name: 'x',
          owner: { login: 'me' },
          default_branch: 'main',
          private: true,
        },
      ]),
    );
    const client = new GitHubClient({ fetchImpl });
    const [repo] = await client.listAccessibleRepos('tok');
    expect(repo.visibility).toBe('private');
    expect(repo.isPrivate).toBe(true);
    expect(repo.pushable).toBe(false);
  });
});

describe('GitHubClient.getRepo', () => {
  it('hits /repos/:owner/:name and returns the normalized shape', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        full_name: 'me/api',
        name: 'api',
        owner: { login: 'me' },
        default_branch: 'main',
        visibility: 'public',
        permissions: { push: true, admin: false },
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const repo = await client.getRepo('tok', 'me', 'api');
    expect(repo.fullName).toBe('me/api');
    expect(repo.defaultBranch).toBe('main');
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/repos/me/api');
  });

  it('URL-encodes owner + name', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        full_name: 'org%2Fweird/repo with space',
        name: 'repo with space',
        owner: { login: 'org/weird' },
        default_branch: 'main',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    await client.getRepo('tok', 'org/weird', 'repo with space');
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/repos/org%2Fweird/repo%20with%20space');
  });

  it('throws GitHubError(404) when the repo is not accessible', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'Not Found' }, { status: 404 }),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.getRepo('tok', 'me', 'missing');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).status).toBe(404);
    }
  });
});

describe('GitHubClient.getBranchHead', () => {
  it('returns the head SHA for the named branch', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ name: 'main', commit: { sha: 'abc123' } }),
    );
    const client = new GitHubClient({ fetchImpl });
    const branch = await client.getBranchHead('tok', 'me', 'api', 'main');
    expect(branch).toEqual({ name: 'main', commitSha: 'abc123' });
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/repos/me/api/branches/main');
  });
});

describe('GitHubClient.createBranch', () => {
  it('POSTs the ref body with the supplied SHA + repo path', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        ref: 'refs/heads/apicircle/payments-a3f9c2',
        object: { sha: 'abc123' },
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const branch = await client.createBranch(
      'tok',
      'me',
      'api',
      'apicircle/payments-a3f9c2',
      'abc123',
    );
    expect(branch).toEqual({ name: 'apicircle/payments-a3f9c2', commitSha: 'abc123' });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/git/refs');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(((init as RequestInit).body as string) ?? '')).toEqual({
      ref: 'refs/heads/apicircle/payments-a3f9c2',
      sha: 'abc123',
    });
  });

  it('surfaces 422 "Reference already exists" as a plain GitHubError', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'Reference already exists' }, { status: 422 }),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.createBranch('tok', 'me', 'api', 'existing', 'abc123');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).status).toBe(422);
      expect((err as Error).message).toMatch(/already exists/);
    }
  });

  it('surfaces missing scope on 403 even though caller declared requiredScopes', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { message: 'Resource not accessible by personal access token' },
        { status: 403, headers: { 'x-oauth-scopes': 'public_repo' } },
      ),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.createBranch('tok', 'me', 'api', 'wb', 'sha');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingScopeError);
      expect((err as MissingScopeError).missingScopes).toEqual(['repo']);
    }
  });
});

describe('GitHubClient.getRef', () => {
  it('returns the head SHA for a branch ref', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ ref: 'refs/heads/main', object: { sha: 'abc123' } }),
    );
    const client = new GitHubClient({ fetchImpl });
    const ref = await client.getRef('tok', 'me', 'api', 'main');
    expect(ref).toEqual({ ref: 'refs/heads/main', sha: 'abc123' });
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/repos/me/api/git/refs/heads/main');
  });
});

describe('GitHubClient.getCommit', () => {
  it('returns commit summary with tree sha + message', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        sha: 'commit-sha',
        message: 'previous push',
        tree: { sha: 'tree-sha' },
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const commit = await client.getCommit('tok', 'me', 'api', 'commit-sha');
    expect(commit).toEqual({
      sha: 'commit-sha',
      treeSha: 'tree-sha',
      message: 'previous push',
    });
  });
});

describe('GitHubClient.createBlob', () => {
  it('POSTs base64 content + encoding and returns the new blob SHA', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ sha: 'blob-sha', size: 12 }));
    const client = new GitHubClient({ fetchImpl });
    const blob = await client.createBlob('tok', 'me', 'api', {
      content: 'aGVsbG8=', // "hello" in base64
      encoding: 'base64',
    });
    expect(blob).toEqual({ sha: 'blob-sha', size: 12 });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/git/blobs');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body).toEqual({ content: 'aGVsbG8=', encoding: 'base64' });
  });

  it('falls back to size=0 when GitHub omits the size field', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ sha: 'blob-sha' }));
    const client = new GitHubClient({ fetchImpl });
    const blob = await client.createBlob('tok', 'me', 'api', { content: 'x', encoding: 'utf-8' });
    expect(blob).toEqual({ sha: 'blob-sha', size: 0 });
  });
});

describe('GitHubClient.createTree', () => {
  it('POSTs base_tree + entries with default mode/type filled in', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ sha: 'new-tree' }));
    const client = new GitHubClient({ fetchImpl });
    const result = await client.createTree('tok', 'me', 'api', {
      baseTreeSha: 'base-tree',
      entries: [
        { path: 'workspace.json', content: '{"x":1}' },
        { path: '.apicircle/attachments/abc', sha: 'blob-abc' },
      ],
    });
    expect(result).toEqual({ sha: 'new-tree' });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/git/trees');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body).toEqual({
      base_tree: 'base-tree',
      tree: [
        { path: 'workspace.json', mode: '100644', type: 'blob', content: '{"x":1}' },
        {
          path: '.apicircle/attachments/abc',
          mode: '100644',
          type: 'blob',
          sha: 'blob-abc',
        },
      ],
    });
  });
});

describe('GitHubClient.createCommit', () => {
  it('POSTs message + tree + parents', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ sha: 'new-commit', message: 'sync', tree: { sha: 'new-tree' } }),
    );
    const client = new GitHubClient({ fetchImpl });
    const commit = await client.createCommit('tok', 'me', 'api', {
      message: 'sync workspace via API Circle Studio',
      treeSha: 'new-tree',
      parents: ['parent-sha'],
    });
    expect(commit).toEqual({ sha: 'new-commit', treeSha: 'new-tree' });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body).toEqual({
      message: 'sync workspace via API Circle Studio',
      tree: 'new-tree',
      parents: ['parent-sha'],
    });
  });
});

describe('GitHubClient.getContents', () => {
  it('decodes base64 content as UTF-8 and returns the path/sha/size', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        type: 'file',
        path: 'workspace.json',
        sha: 'blob-sha-1',
        size: 5,
        content: 'aGVsbG8=', // "hello"
        encoding: 'base64',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const file = await client.getContents('tok', 'me', 'api', 'workspace.json', 'apicircle/wb');
    expect(file).toEqual({
      content: 'hello',
      sha: 'blob-sha-1',
      path: 'workspace.json',
      size: 5,
    });
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(
      'https://api.github.com/repos/me/api/contents/workspace.json?ref=apicircle%2Fwb',
    );
  });

  it('handles GitHub line-wrapped base64 content', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        type: 'file',
        path: 'workspace.json',
        sha: 'b',
        size: 5,
        content: 'aGVs\nbG8=',
        encoding: 'base64',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const file = await client.getContents('tok', 'me', 'api', 'workspace.json', 'main');
    expect(file?.content).toBe('hello');
  });

  it('returns null on 404 (file does not exist on this ref)', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'Not Found' }, { status: 404 }),
    );
    const client = new GitHubClient({ fetchImpl });
    const file = await client.getContents('tok', 'me', 'api', 'workspace.json', 'apicircle/wb');
    expect(file).toBeNull();
  });

  it('throws when the path resolves to a directory', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse([{ type: 'dir', path: 'p' }]));
    const client = new GitHubClient({ fetchImpl });
    await expect(client.getContents('tok', 'me', 'api', 'p', 'main')).rejects.toThrow(/not a file/);
  });

  it('encodes nested paths segment-by-segment', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        type: 'file',
        path: '.apicircle/attachments/slot a',
        sha: 'b',
        size: 0,
        content: '',
        encoding: 'base64',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    await client.getContents('tok', 'me', 'api', '.apicircle/attachments/slot a', 'main');
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(
      'https://api.github.com/repos/me/api/contents/.apicircle/attachments/slot%20a?ref=main',
    );
  });
});

describe('GitHubClient.createPullRequest', () => {
  it('POSTs title/body/head/base and returns the normalized PR summary', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        number: 12,
        html_url: 'https://github.com/me/api/pull/12',
        state: 'open',
        title: 'APICircle workspace updates',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const pr = await client.createPullRequest('tok', 'me', 'api', {
      title: 'APICircle workspace updates',
      body: 'auto',
      head: 'apicircle/wb',
      base: 'main',
    });
    expect(pr).toEqual({
      number: 12,
      htmlUrl: 'https://github.com/me/api/pull/12',
      state: 'open',
      title: 'APICircle workspace updates',
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/pulls');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body).toEqual({
      title: 'APICircle workspace updates',
      body: 'auto',
      head: 'apicircle/wb',
      base: 'main',
      draft: false,
    });
  });

  it('passes through draft: true when requested', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ number: 1, html_url: 'u', state: 'open', title: 't' }),
    );
    const client = new GitHubClient({ fetchImpl });
    await client.createPullRequest('tok', 'me', 'api', {
      title: 't',
      body: 'b',
      head: 'h',
      base: 'main',
      draft: true,
    });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body.draft).toBe(true);
  });

  it('surfaces 422 (PR already exists / head==base) as a plain GitHubError', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { message: 'A pull request already exists for me:apicircle/wb.' },
        { status: 422 },
      ),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.createPullRequest('tok', 'me', 'api', {
        title: 't',
        body: 'b',
        head: 'apicircle/wb',
        base: 'main',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).status).toBe(422);
      expect((err as Error).message).toMatch(/already exists/);
    }
  });

  it('surfaces missing pull_request scope on 403', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse(
        { message: 'Resource not accessible by personal access token' },
        { status: 403, headers: { 'x-oauth-scopes': 'repo' } },
      ),
    );
    const client = new GitHubClient({ fetchImpl });
    try {
      await client.createPullRequest('tok', 'me', 'api', {
        title: 't',
        body: 'b',
        head: 'h',
        base: 'main',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingScopeError);
      expect((err as MissingScopeError).missingScopes).toEqual(['pull_request']);
    }
  });
});

describe('GitHubClient.updateRef', () => {
  it('PATCHes the branch ref with the new SHA, force=false by default', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ ref: 'refs/heads/wb', object: { sha: 'new-commit' } }),
    );
    const client = new GitHubClient({ fetchImpl });
    const updated = await client.updateRef('tok', 'me', 'api', {
      branch: 'wb',
      sha: 'new-commit',
    });
    expect(updated).toEqual({ ref: 'refs/heads/wb', sha: 'new-commit' });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/git/refs/heads/wb');
    expect((init as RequestInit).method).toBe('PATCH');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body).toEqual({ sha: 'new-commit', force: false });
  });

  it('passes through force: true when requested', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ ref: 'refs/heads/wb', object: { sha: 'new-commit' } }),
    );
    const client = new GitHubClient({ fetchImpl });
    await client.updateRef('tok', 'me', 'api', {
      branch: 'wb',
      sha: 'new-commit',
      force: true,
    });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body.force).toBe(true);
  });
});
