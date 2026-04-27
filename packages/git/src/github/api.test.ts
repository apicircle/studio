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
