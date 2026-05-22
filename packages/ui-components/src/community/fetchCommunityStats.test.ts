import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCommunityStats, parseLastPageFromLinkHeader } from './fetchCommunityStats';

// Build a Response-shaped object covering the bits the fetcher reads.
function jsonResponse(body: unknown, init: ResponseInit & { linkHeader?: string } = {}): Response {
  const headers = new Headers(init.headers);
  if (init.linkHeader !== undefined) headers.set('Link', init.linkHeader);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function rateLimitedResponse(): Response {
  return new Response('{"message":"rate limited"}', {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0' },
  });
}

function notFoundResponse(): Response {
  return new Response('{"message":"Not Found"}', { status: 404 });
}

interface MockRoutes {
  repo?: Response | Error;
  release?: Response | Error;
  prs?: Response | Error;
  contributors?: Response | Error;
}

function installFetchMock(routes: MockRoutes): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const route = url.includes('/releases/latest')
        ? 'release'
        : url.includes('/contributors')
          ? 'contributors'
          : url.includes('/search/issues')
            ? 'prs'
            : 'repo';
      const value = routes[route as keyof MockRoutes];
      if (value === undefined) {
        throw new Error(`unexpected fetch route: ${url}`);
      }
      if (value instanceof Error) throw value;
      return value;
    }),
  );
}

describe('parseLastPageFromLinkHeader', () => {
  it('returns null on missing header', () => {
    expect(parseLastPageFromLinkHeader(null)).toBeNull();
    expect(parseLastPageFromLinkHeader('')).toBeNull();
  });

  it('extracts the page number from a rel="last" entry', () => {
    const header =
      '<https://api.github.com/repos/foo/bar/contributors?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repos/foo/bar/contributors?per_page=1&page=42>; rel="last"';
    expect(parseLastPageFromLinkHeader(header)).toBe(42);
  });

  it('ignores entries without rel="last"', () => {
    const header = '<https://api.github.com/x?page=7>; rel="next"';
    expect(parseLastPageFromLinkHeader(header)).toBeNull();
  });
});

describe('fetchCommunityStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('normalises a full happy-path response', async () => {
    installFetchMock({
      repo: jsonResponse({ stargazers_count: 142, open_issues_count: 19 }),
      release: jsonResponse({
        tag_name: 'v1.0.3',
        html_url: 'https://github.com/apicircle/studio/releases/tag/v1.0.3',
      }),
      prs: jsonResponse({ total_count: 7 }),
      contributors: jsonResponse([{ login: 'one' }], {
        linkHeader:
          '<https://api.github.com/repos/apicircle/studio/contributors?per_page=1&page=5>; rel="last"',
      }),
    });

    const result = await fetchCommunityStats();

    expect(result.stars).toBe(142);
    expect(result.openIssues).toBe(12);
    expect(result.latestVersion).toBe('v1.0.3');
    expect(result.latestReleaseUrl).toBe('https://github.com/apicircle/studio/releases/tag/v1.0.3');
    expect(result.contributors).toBe(5);
    expect(result.error).toBeNull();
    expect(result.fetchedAt).toBe(Date.parse('2026-05-22T00:00:00Z'));
  });

  it('treats a 404 on /releases/latest as benign (no releases yet)', async () => {
    installFetchMock({
      repo: jsonResponse({ stargazers_count: 0, open_issues_count: 0 }),
      release: notFoundResponse(),
      prs: jsonResponse({ total_count: 0 }),
      contributors: jsonResponse([], { linkHeader: undefined }),
    });

    const result = await fetchCommunityStats();
    expect(result.latestVersion).toBeNull();
    expect(result.latestReleaseUrl).toBeNull();
    expect(result.error).toBeNull();
  });

  it('classifies a 403 + zero ratelimit-remaining as rate-limit', async () => {
    installFetchMock({
      repo: rateLimitedResponse(),
      release: rateLimitedResponse(),
      prs: rateLimitedResponse(),
      contributors: rateLimitedResponse(),
    });
    const result = await fetchCommunityStats();
    expect(result.error).toBe('rate-limit');
    expect(result.fetchedAt).toBeNull();
  });

  it('classifies a network throw as offline', async () => {
    installFetchMock({
      repo: new TypeError('Failed to fetch'),
      release: new TypeError('Failed to fetch'),
      prs: new TypeError('Failed to fetch'),
      contributors: new TypeError('Failed to fetch'),
    });
    const result = await fetchCommunityStats();
    expect(result.error).toBe('offline');
  });

  it('stamps fetchedAt when at least one endpoint succeeds', async () => {
    installFetchMock({
      repo: jsonResponse({ stargazers_count: 12, open_issues_count: 3 }),
      release: rateLimitedResponse(),
      prs: rateLimitedResponse(),
      contributors: rateLimitedResponse(),
    });
    const result = await fetchCommunityStats();
    expect(result.stars).toBe(12);
    expect(result.error).toBe('rate-limit');
    expect(result.fetchedAt).not.toBeNull();
  });

  it('subtracts open PR count from issue count', async () => {
    installFetchMock({
      repo: jsonResponse({ stargazers_count: 1, open_issues_count: 25 }),
      release: notFoundResponse(),
      prs: jsonResponse({ total_count: 10 }),
      contributors: jsonResponse([]),
    });
    const result = await fetchCommunityStats();
    expect(result.openIssues).toBe(15);
  });

  it('clamps the issue subtraction at zero when PRs exceed issues', async () => {
    installFetchMock({
      repo: jsonResponse({ stargazers_count: 1, open_issues_count: 3 }),
      release: notFoundResponse(),
      prs: jsonResponse({ total_count: 10 }),
      contributors: jsonResponse([]),
    });
    const result = await fetchCommunityStats();
    expect(result.openIssues).toBe(0);
  });

  it('falls back to raw issue count when the PR count fetch fails', async () => {
    installFetchMock({
      repo: jsonResponse({ stargazers_count: 1, open_issues_count: 8 }),
      release: notFoundResponse(),
      prs: rateLimitedResponse(),
      contributors: jsonResponse([]),
    });
    const result = await fetchCommunityStats();
    expect(result.openIssues).toBe(8);
    expect(result.error).toBe('rate-limit');
  });

  it('returns zero contributors when the body is empty and no Link header is present', async () => {
    installFetchMock({
      repo: jsonResponse({ stargazers_count: 0, open_issues_count: 0 }),
      release: notFoundResponse(),
      prs: jsonResponse({ total_count: 0 }),
      contributors: jsonResponse([]),
    });
    const result = await fetchCommunityStats();
    expect(result.contributors).toBe(0);
  });
});
