import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './api';
import {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  TimeoutError,
  UnauthorizedError,
} from './errors';

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

  it('forwards Bearer token, accept header, api version, and cache bypass mode', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ login: 'u', id: 1 }));
    const client = new GitHubClient({ fetchImpl });
    await client.getViewer('tok-secret');
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    const [, init] = calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-secret');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['Cache-Control']).toBeUndefined();
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect((init as RequestInit).cache).toBe('no-store');
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

  // ─── User-story coverage (live-suite mirror) ─────────────────────────
  //
  // The two cases below pin the user stories that the live-GitHub suite
  // can't directly drive against a classic PAT (`live/session-edges.spec.ts`
  // references these by file path + line). They credit:
  //   * TC-GT-0023 — OAuth scope downgrade after linking
  //   * TC-GT-0035 — OAuth token revoked on github.com mid-session

  it('TC-GT-0023 — scope downgrade after linking surfaces MissingScopeError on next authed call', async () => {
    // Call sequence: connect with full scopes (200), then GitHub returns
    // 403 with downgraded scope headers because the user revoked
    // `pull_request` mid-session. The client must classify the second
    // response as a MissingScopeError so the UI can prompt re-auth.
    let call = 0;
    const fetchImpl: typeof fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse(
          { login: 'u', id: 1 },
          { headers: { 'x-oauth-scopes': 'repo, pull_request' } },
        );
      }
      return jsonResponse(
        { message: 'Resource not accessible by personal access token' },
        {
          status: 403,
          headers: {
            'x-oauth-scopes': 'repo',
            'x-accepted-oauth-scopes': 'repo, pull_request',
          },
        },
      );
    });
    const client = new GitHubClient({ fetchImpl });
    const first = await client.getViewer('tok');
    expect(first.scopes.granted).toEqual(['repo', 'pull_request']);
    await expect(client.getViewer('tok')).rejects.toBeInstanceOf(MissingScopeError);
  });

  it('TC-GT-0035 — token revoked on github.com mid-session: subsequent authed calls throw UnauthorizedError', async () => {
    // Call sequence: viewer succeeds initially, then GitHub revokes the
    // token (user clicked Revoke on github.com), so every subsequent
    // authed call returns 401 Bad credentials.
    let call = 0;
    const fetchImpl: typeof fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({ login: 'u', id: 1 }, { headers: { 'x-oauth-scopes': 'repo' } });
      }
      return jsonResponse(
        { message: 'Bad credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );
    });
    const client = new GitHubClient({ fetchImpl });
    const first = await client.getViewer('tok-good');
    expect(first.viewer.login).toBe('u');
    await expect(client.getViewer('tok-revoked')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws RateLimitedError when remaining=0 on 403, with humanised wait', async () => {
    const reset = Math.floor(Date.now() / 1000) + 90; // ~2 min away
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
      // Humanised wait should appear, not a raw ISO string alone.
      expect((err as Error).message).toMatch(/Resets in \d+\s*(s|min|h)/);
    }
  });

  it('throws TimeoutError when the request exceeds the configured timeout', async () => {
    // fetchImpl that respects abort and rejects with an AbortError.
    const fetchImpl: typeof fetch = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = new GitHubClient({ fetchImpl, timeoutMs: 10 });
    await expect(client.getViewer('tok')).rejects.toBeInstanceOf(TimeoutError);
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

describe('GitHubClient.listBranches', () => {
  it('returns every branch normalized to { name, commitSha } and caps at per_page=100', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse([
        { name: 'main', commit: { sha: 'aaa' } },
        { name: 'develop', commit: { sha: 'bbb' } },
        { name: 'feature/x', commit: { sha: 'ccc' } },
      ]),
    );
    const client = new GitHubClient({ fetchImpl });
    const branches = await client.listBranches('tok', 'me', 'api');
    expect(branches).toEqual([
      { name: 'main', commitSha: 'aaa' },
      { name: 'develop', commitSha: 'bbb' },
      { name: 'feature/x', commitSha: 'ccc' },
    ]);
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/repos/me/api/branches?per_page=100');
  });

  it('encodes owner / repo containing slashes or special chars', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse([]));
    const client = new GitHubClient({ fetchImpl });
    await client.listBranches('tok', 'my org', 'api/v2');
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/repos/my%20org/api%2Fv2/branches?per_page=100');
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
        { path: '.apicircle/workspace-ws1/workspace.json', content: '{"x":1}' },
        { path: '.apicircle/workspace-ws1/attachments/abc', sha: 'blob-abc' },
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
        {
          path: '.apicircle/workspace-ws1/workspace.json',
          mode: '100644',
          type: 'blob',
          content: '{"x":1}',
        },
        {
          path: '.apicircle/workspace-ws1/attachments/abc',
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

describe('GitHubClient.searchMarketplaceRepos', () => {
  it('appends `topic:apicircle` to the user query', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new GitHubClient({ fetchImpl });
    await client.searchMarketplaceRepos('tok', 'payments');
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(
      'https://api.github.com/search/repositories?q=payments%20topic%3Aapicircle&per_page=30',
    );
  });

  it('searches only the `apicircle` topic when the user query is empty', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new GitHubClient({ fetchImpl });
    await client.searchMarketplaceRepos('tok', '   ');
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('https://api.github.com/search/repositories?q=topic%3Aapicircle&per_page=30');
  });

  it('normalizes the results into MarketplaceRepo[] with safe defaults', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            full_name: 'org/payments-api',
            name: 'payments-api',
            owner: { login: 'org' },
            description: 'Payments REST collection',
            topics: ['apicircle-marketplace', 'payments'],
            stargazers_count: 42,
            default_branch: 'main',
          },
          {
            full_name: 'me/widgets',
            name: 'widgets',
            owner: { login: 'me' },
            // description, topics, stargazers omitted intentionally.
          },
        ],
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const repos = await client.searchMarketplaceRepos('tok', 'payments');
    expect(repos).toEqual([
      {
        fullName: 'org/payments-api',
        owner: 'org',
        name: 'payments-api',
        description: 'Payments REST collection',
        topics: ['apicircle-marketplace', 'payments'],
        stargazers: 42,
        defaultBranch: 'main',
      },
      {
        fullName: 'me/widgets',
        owner: 'me',
        name: 'widgets',
        description: '',
        topics: [],
        stargazers: 0,
        defaultBranch: 'main',
      },
    ]);
  });

  it('returns [] when GitHub omits the items array', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({}));
    const client = new GitHubClient({ fetchImpl });
    const repos = await client.searchMarketplaceRepos('tok', 'x');
    expect(repos).toEqual([]);
  });

  it('omits the Authorization header when called anonymously (token = null)', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new GitHubClient({ fetchImpl });
    await client.searchMarketplaceRepos(null, 'payments');
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe('application/vnd.github+json');
  });

  it('still sends the Bearer header when a token is supplied', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new GitHubClient({ fetchImpl });
    await client.searchMarketplaceRepos('tok-secret', 'payments');
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-secret');
  });

  it('appends sort and order params when sort is specified', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new GitHubClient({ fetchImpl });
    await client.searchMarketplaceRepos('tok', 'payments', { sort: 'stars' });
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(
      'https://api.github.com/search/repositories?q=payments%20topic%3Aapicircle&per_page=30&sort=stars&order=desc',
    );
  });

  it('omits sort params when sort is undefined (best-match default)', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new GitHubClient({ fetchImpl });
    await client.searchMarketplaceRepos('tok', 'payments');
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).not.toContain('sort=');
    expect(url).not.toContain('order=');
  });
});

describe('GitHubClient.startDeviceFlow (B.5 OAuth)', () => {
  it('POSTs to login/device/code with client_id + scope and returns the user-facing payload', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        device_code: 'dc-abc',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const result = await client.startDeviceFlow('cid', 'repo,pull_request');
    expect(result).toEqual({
      deviceCode: 'dc-abc',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://github.com/login/device/code');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      client_id: 'cid',
      scope: 'repo,pull_request',
    });
  });

  it('throws GitHubError when GitHub returns an error payload', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ error: 'unsupported_grant_type', error_description: 'Device flow disabled' }),
    );
    const client = new GitHubClient({ fetchImpl });
    await expect(client.startDeviceFlow('cid', 'repo')).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('GitHubClient.pollDeviceToken (B.5 OAuth)', () => {
  it('returns kind=granted with the access token on success', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        access_token: 'gho_real',
        token_type: 'bearer',
        scope: 'repo,pull_request',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const result = await client.pollDeviceToken('cid', 'dc-abc');
    expect(result).toEqual({
      kind: 'granted',
      accessToken: 'gho_real',
      tokenType: 'bearer',
      scope: 'repo,pull_request',
    });
  });

  it('returns kind=pending when GitHub responds with authorization_pending', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ error: 'authorization_pending', error_description: '...' }),
    );
    const client = new GitHubClient({ fetchImpl });
    const result = await client.pollDeviceToken('cid', 'dc-abc');
    expect(result).toEqual({ kind: 'pending', slowDown: false });
  });

  it('returns kind=pending with slowDown=true on slow_down', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ error: 'slow_down' }));
    const client = new GitHubClient({ fetchImpl });
    const result = await client.pollDeviceToken('cid', 'dc-abc');
    expect(result).toEqual({ kind: 'pending', slowDown: true });
  });

  it('returns kind=expired when the device code TTL elapsed', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ error: 'expired_token' }));
    const client = new GitHubClient({ fetchImpl });
    const result = await client.pollDeviceToken('cid', 'dc-abc');
    expect(result).toEqual({ kind: 'expired' });
  });

  it('returns kind=denied when the user denied authorization', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ error: 'access_denied', error_description: 'No.' }),
    );
    const client = new GitHubClient({ fetchImpl });
    const result = await client.pollDeviceToken('cid', 'dc-abc');
    expect(result).toEqual({ kind: 'denied', reason: 'No.' });
  });
});

describe('GitHubClient.createTag', () => {
  it('POSTs `refs/tags/<name>` with the supplied commit SHA', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ ref: 'refs/tags/v1.0.0', object: { sha: 'abc123' } }),
    );
    const client = new GitHubClient({ fetchImpl });
    const ref = await client.createTag('tok', 'me', 'api', {
      tagName: 'v1.0.0',
      sha: 'abc123',
    });
    expect(ref).toEqual({ ref: 'refs/tags/v1.0.0', sha: 'abc123' });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/git/refs');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ref: 'refs/tags/v1.0.0', sha: 'abc123' });
  });

  it('surfaces GitHubError on 422 (tag already exists)', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'Reference already exists' }, { status: 422 }),
    );
    const client = new GitHubClient({ fetchImpl });
    await expect(
      client.createTag('tok', 'me', 'api', { tagName: 'v1.0.0', sha: 'a' }),
    ).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('GitHubClient.createRelease', () => {
  it('POSTs the GitHub Release payload and returns the html_url + id', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        id: 12345,
        html_url: 'https://github.com/me/api/releases/tag/v1.0.0',
        tag_name: 'v1.0.0',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const result = await client.createRelease('tok', 'me', 'api', {
      tagName: 'v1.0.0',
      releaseName: 'Initial release',
      body: 'first cut',
    });
    expect(result).toEqual({
      id: 12345,
      htmlUrl: 'https://github.com/me/api/releases/tag/v1.0.0',
      tagName: 'v1.0.0',
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/releases');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      tag_name: 'v1.0.0',
      name: 'Initial release',
      body: 'first cut',
      draft: false,
      prerelease: false,
    });
  });

  it('passes prerelease: true through to the request body', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ id: 1, html_url: 'https://x', tag_name: 'v1.0.0-rc.1' }),
    );
    const client = new GitHubClient({ fetchImpl });
    await client.createRelease('tok', 'me', 'api', {
      tagName: 'v1.0.0-rc.1',
      prerelease: true,
    });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.prerelease).toBe(true);
  });
});

describe('GitHubClient.getTagSha', () => {
  it('returns the resolved SHA when the tag exists', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ ref: 'refs/tags/v1.0.0', object: { sha: 'deadbeef' } }),
    );
    const client = new GitHubClient({ fetchImpl });
    const sha = await client.getTagSha('tok', 'me', 'api', 'v1.0.0');
    expect(sha).toBe('deadbeef');
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/git/refs/tags/v1.0.0');
  });

  it('returns null on 404 (tag missing) so callers can branch on existence', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'Not Found' }, { status: 404 }),
    );
    const client = new GitHubClient({ fetchImpl });
    const sha = await client.getTagSha('tok', 'me', 'api', 'v9.9.9');
    expect(sha).toBeNull();
  });
});

describe('GitHubClient.deleteRef', () => {
  it('issues a DELETE against the bare ref suffix', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new GitHubClient({ fetchImpl });
    await client.deleteRef('tok', 'me', 'api', 'tags/v1.0.0');
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/git/refs/tags/v1.0.0');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});

describe('GitHubClient.listRepoTopics', () => {
  it('returns the topic names array', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ names: ['apicircle', 'payments'] }),
    );
    const client = new GitHubClient({ fetchImpl });
    const topics = await client.listRepoTopics('tok', 'me', 'api');
    expect(topics).toEqual(['apicircle', 'payments']);
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/topics');
  });

  it('returns [] when the response shape is unexpected', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({ names: null }));
    const client = new GitHubClient({ fetchImpl });
    const topics = await client.listRepoTopics('tok', 'me', 'api');
    expect(topics).toEqual([]);
  });
});

describe('GitHubClient.setRepoTopics', () => {
  it('PUTs the full topic list and returns the persisted result', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ names: ['apicircle', 'payments', 'graphql'] }),
    );
    const client = new GitHubClient({ fetchImpl });
    const persisted = await client.setRepoTopics('tok', 'me', 'api', [
      'apicircle',
      'payments',
      'graphql',
    ]);
    expect(persisted).toEqual(['apicircle', 'payments', 'graphql']);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/topics');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ names: ['apicircle', 'payments', 'graphql'] });
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
        path: '.apicircle/workspace-ws1/attachments/slot a',
        sha: 'b',
        size: 0,
        content: '',
        encoding: 'base64',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    await client.getContents(
      'tok',
      'me',
      'api',
      '.apicircle/workspace-ws1/attachments/slot a',
      'main',
    );
    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(
      'https://api.github.com/repos/me/api/contents/.apicircle/workspace-ws1/attachments/slot%20a?ref=main',
    );
  });
});

describe('GitHubClient.getBinaryContents', () => {
  it('returns the raw bytes (not UTF-8 decoded)', async () => {
    // Mix of bytes that would be invalid UTF-8 (0xff 0xfe is the start of a
    // BOM sequence; bytes >0x7f without a leading multibyte marker are
    // invalid as UTF-8). Round-trip through base64.
    const raw = new Uint8Array([0xff, 0xfe, 0x00, 0x42]);
    const b64 = Buffer.from(raw).toString('base64');
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        type: 'file',
        path: '.apicircle/workspace-ws1/attachments/slot-1',
        sha: 'blob-sha',
        size: raw.length,
        content: b64,
        encoding: 'base64',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const file = await client.getBinaryContents(
      'tok',
      'me',
      'api',
      '.apicircle/workspace-ws1/attachments/slot-1',
      'wb',
    );
    expect(file).not.toBeNull();
    expect(file!.bytes).toEqual(raw);
    expect(file!.sha).toBe('blob-sha');
  });

  it('returns null on 404', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: 'Not Found' }, { status: 404 }),
    );
    const client = new GitHubClient({ fetchImpl });
    const file = await client.getBinaryContents(
      'tok',
      'me',
      'api',
      '.apicircle/workspace-ws1/attachments/missing',
      'wb',
    );
    expect(file).toBeNull();
  });
});

describe('GitHubClient — issue/PR comments', () => {
  it('listIssueComments GETs the comments and returns normalized summaries', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse([
        {
          id: 1,
          html_url: 'https://github.com/me/api/pull/12#issuecomment-1',
          body: '<!-- m -->hello',
        },
        { id: 2, html_url: 'https://github.com/me/api/pull/12#issuecomment-2', body: 'other' },
      ]),
    );
    const client = new GitHubClient({ fetchImpl });
    const comments = await client.listIssueComments('tok', 'me', 'api', 12);
    expect(comments).toEqual([
      {
        id: 1,
        htmlUrl: 'https://github.com/me/api/pull/12#issuecomment-1',
        body: '<!-- m -->hello',
      },
      { id: 2, htmlUrl: 'https://github.com/me/api/pull/12#issuecomment-2', body: 'other' },
    ]);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/issues/12/comments?per_page=100');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('createIssueComment POSTs the body and returns the created comment', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        id: 5,
        html_url: 'https://github.com/me/api/pull/12#issuecomment-5',
        body: 'the review',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const c = await client.createIssueComment('tok', 'me', 'api', 12, 'the review');
    expect(c).toEqual({
      id: 5,
      htmlUrl: 'https://github.com/me/api/pull/12#issuecomment-5',
      body: 'the review',
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/issues/12/comments');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(((init as RequestInit).body as string) ?? '')).toEqual({
      body: 'the review',
    });
  });

  it('updateIssueComment PATCHes an existing comment by id', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        id: 5,
        html_url: 'https://github.com/me/api/pull/12#issuecomment-5',
        body: 'updated',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const c = await client.updateIssueComment('tok', 'me', 'api', 5, 'updated');
    expect(c).toEqual({
      id: 5,
      htmlUrl: 'https://github.com/me/api/pull/12#issuecomment-5',
      body: 'updated',
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/issues/comments/5');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse(((init as RequestInit).body as string) ?? '')).toEqual({ body: 'updated' });
  });
});

describe('GitHubClient.createPullRequest', () => {
  it('POSTs title/body/head/base and returns the normalized PR summary', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({
        number: 12,
        html_url: 'https://github.com/me/api/pull/12',
        state: 'open',
        title: 'API Circle workspace updates',
      }),
    );
    const client = new GitHubClient({ fetchImpl });
    const pr = await client.createPullRequest('tok', 'me', 'api', {
      title: 'API Circle workspace updates',
      body: 'auto',
      head: 'apicircle/wb',
      base: 'main',
    });
    expect(pr).toEqual({
      number: 12,
      htmlUrl: 'https://github.com/me/api/pull/12',
      state: 'open',
      title: 'API Circle workspace updates',
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/api/pulls');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '');
    expect(body).toEqual({
      title: 'API Circle workspace updates',
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
