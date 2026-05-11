import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError, RateLimitedError, UnauthorizedError } from '@apicircle/git';
import {
  checkPrCapabilityFromScopes,
  probePrCapability,
  resolvePrCapability,
} from './githubPrCapability';

describe('checkPrCapabilityFromScopes', () => {
  it('returns true when `repo` is granted (classic PAT path)', () => {
    expect(checkPrCapabilityFromScopes(['repo'])).toBe(true);
  });

  it('returns true when `pull_request` is granted (fine-grained path)', () => {
    expect(checkPrCapabilityFromScopes(['pull_request'])).toBe(true);
  });

  it('returns true when both are granted', () => {
    expect(checkPrCapabilityFromScopes(['repo', 'pull_request'])).toBe(true);
  });

  it('ignores unrelated scopes and returns null when neither match', () => {
    expect(checkPrCapabilityFromScopes(['gist', 'workflow'])).toBeNull();
  });

  it('returns null on an empty scope list', () => {
    expect(checkPrCapabilityFromScopes([])).toBeNull();
  });
});

/**
 * Build a `GitHubClient` whose only mocked dependency is `fetch`. We feed
 * each test a single canned response so the real `listPullRequests` →
 * `call()` path runs end-to-end (URL building, header parsing, error
 * mapping). The probe under test sits on top of that.
 */
function clientWith(response: Response): GitHubClient {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  return new GitHubClient({ fetchImpl });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('probePrCapability', () => {
  it('returns true on a 200 list-pulls response', async () => {
    const client = clientWith(jsonResponse([]));
    await expect(probePrCapability(client, 'tok', 'me', 'api')).resolves.toBe(true);
  });

  it('returns false on a 403 with missing-scope hint (MissingScopeError)', async () => {
    // GitHub's 403 carries `x-accepted-oauth-scopes`; the client surfaces it
    // as a MissingScopeError. The probe interprets that as "no PR access".
    const response = new Response(JSON.stringify({ message: 'Resource not accessible' }), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'x-oauth-scopes': '',
        'x-accepted-oauth-scopes': 'repo, pull_request',
      },
    });
    const client = clientWith(response);
    await expect(probePrCapability(client, 'tok', 'me', 'api')).resolves.toBe(false);
  });

  it('returns false on a plain 403 without scope hint', async () => {
    // Some 403s (e.g. permissions, secondary rate limits) don't include
    // accepted-oauth-scopes. We still treat them as "PR creation will fail"
    // — the call would 403 the same way.
    const response = new Response(JSON.stringify({ message: 'Forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    const client = clientWith(response);
    await expect(probePrCapability(client, 'tok', 'me', 'api')).resolves.toBe(false);
  });

  it('throws on 401 (unauthorized) so caller can surface a proper auth error', async () => {
    const response = new Response(JSON.stringify({ message: 'Bad credentials' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    const client = clientWith(response);
    await expect(probePrCapability(client, 'tok', 'me', 'api')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('throws on 429 rate-limit so caller can retry / surface a transient error', async () => {
    const response = new Response(JSON.stringify({ message: 'Rate limited' }), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
      },
    });
    const client = clientWith(response);
    await expect(probePrCapability(client, 'tok', 'me', 'api')).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('throws on 5xx so the caller leaves the prior capability intact', async () => {
    const response = new Response(JSON.stringify({ message: 'Server' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    const client = clientWith(response);
    await expect(probePrCapability(client, 'tok', 'me', 'api')).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('resolvePrCapability', () => {
  it('short-circuits on a positive scope match — never calls the probe', async () => {
    const probe = vi.fn();
    const result = await resolvePrCapability({ grantedScopes: ['repo'], probe });
    expect(result).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it('falls back to the probe when scopes are inconclusive', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const result = await resolvePrCapability({ grantedScopes: [], probe });
    expect(result).toBe(true);
    expect(probe).toHaveBeenCalledOnce();
  });

  it('returns false when the probe reports missing capability', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const result = await resolvePrCapability({ grantedScopes: [], probe });
    expect(result).toBe(false);
  });

  it('returns null (capability undetermined) when the probe throws', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('network blip'));
    const result = await resolvePrCapability({ grantedScopes: [], probe });
    // Don't flip the persisted flag on a flake — leave it at the prior value.
    expect(result).toBeNull();
  });

  it('returns null when scopes inconclusive and no probe supplied', async () => {
    const result = await resolvePrCapability({ grantedScopes: [] });
    expect(result).toBeNull();
  });
});
