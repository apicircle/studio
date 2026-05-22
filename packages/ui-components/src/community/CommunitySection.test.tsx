import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { CommunitySection } from './CommunitySection';
import { clearCommunityStats, writeCommunityStats } from './communityStorage';

// Tests run against the fake-indexeddb instance set up in test/setup.ts.
// The setup file re-installs a fresh IDBFactory per test, so every spec
// starts from an empty community-stats cache without manual cleanup.

// Build the four fetch responses the component needs in one shot. Any
// route not overridden falls back to a benign empty success.
interface MockResponses {
  repo?: Response | Error;
  release?: Response | Error;
  prs?: Response | Error;
  contributors?: Response | Error;
}

function jsonResponse(body: unknown, init: ResponseInit & { linkHeader?: string } = {}): Response {
  const headers = new Headers(init.headers);
  if (init.linkHeader !== undefined) headers.set('Link', init.linkHeader);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function installFetch(responses: MockResponses = {}) {
  const defaults: Required<MockResponses> = {
    repo: jsonResponse({ stargazers_count: 0, open_issues_count: 0 }),
    release: new Response('{"message":"Not Found"}', { status: 404 }),
    prs: jsonResponse({ total_count: 0 }),
    contributors: jsonResponse([]),
  };
  const merged = { ...defaults, ...responses };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const key = url.includes('/releases/latest')
        ? 'release'
        : url.includes('/contributors')
          ? 'contributors'
          : url.includes('/search/issues')
            ? 'prs'
            : 'repo';
      const value = merged[key];
      if (value instanceof Error) throw value;
      return value;
    }),
  );
}

describe('CommunitySection', () => {
  beforeEach(async () => {
    await clearCommunityStats();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearCommunityStats();
  });

  it('renders the curated link rows and the soft ask copy', async () => {
    installFetch();
    await act(async () => {
      render(<CommunitySection />);
    });
    expect(screen.getByRole('link', { name: /Star on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/apicircle/studio/stargazers',
    );
    expect(screen.getByRole('link', { name: /View repository/ })).toHaveAttribute(
      'href',
      'https://github.com/apicircle/studio',
    );
    expect(screen.getByRole('link', { name: /Report an issue/ })).toHaveAttribute(
      'href',
      'https://github.com/apicircle/studio/issues/new/choose',
    );
    expect(screen.getByText(/Studio helping you ship/)).toBeInTheDocument();
    // The highlighted CTA renders as an accent-styled anchor inline.
    const ctaLink = screen.getByRole('link', { name: /★ Star us on GitHub/ });
    expect(ctaLink).toHaveAttribute('href', 'https://github.com/apicircle/studio/stargazers');
    expect(ctaLink).toHaveClass('text-accent');
  });

  it('replaces the stars chip with a "Be the first" CTA when stars < 10', async () => {
    installFetch({
      repo: jsonResponse({ stargazers_count: 3, open_issues_count: 2 }),
    });
    await act(async () => {
      render(<CommunitySection />);
    });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Be the first to star/ })).toBeInTheDocument();
    });
    expect(screen.queryByText('3 stars')).toBeNull();
  });

  it('shows the live stars chip once the count is ≥ threshold', async () => {
    installFetch({
      repo: jsonResponse({ stargazers_count: 142, open_issues_count: 19 }),
      release: jsonResponse({
        tag_name: 'v1.0.3',
        html_url: 'https://github.com/apicircle/studio/releases/tag/v1.0.3',
      }),
      prs: jsonResponse({ total_count: 7 }),
    });
    await act(async () => {
      render(<CommunitySection />);
    });
    await waitFor(() => {
      expect(screen.getByText('142 stars')).toBeInTheDocument();
    });
    expect(screen.getByText('12 open issues')).toBeInTheDocument();
    expect(screen.getByText('Latest v1.0.3')).toBeInTheDocument();
  });

  it('hides the Contributors link row when the count is < 2', async () => {
    installFetch({
      contributors: jsonResponse([{ login: 'solo' }]),
    });
    await act(async () => {
      render(<CommunitySection />);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Contributors/)).toBeNull();
    });
  });

  it('renders the Contributors link with the count when ≥ 2', async () => {
    installFetch({
      contributors: jsonResponse([{ login: 'a' }], {
        linkHeader:
          '<https://api.github.com/repos/apicircle/studio/contributors?per_page=1&page=5>; rel="last"',
      }),
    });
    await act(async () => {
      render(<CommunitySection />);
    });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Contributors \(5\)/ })).toBeInTheDocument();
    });
  });

  it('skips the network call when a fresh cache is already present', async () => {
    await writeCommunityStats({
      fetchedAt: Date.now(),
      stars: 50,
      openIssues: 3,
      latestVersion: 'v1.0.3',
      latestReleaseUrl: 'https://github.com/apicircle/studio/releases/tag/v1.0.3',
      contributors: 4,
      error: null,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await act(async () => {
      render(<CommunitySection />);
    });
    await waitFor(() => {
      expect(screen.getByText('50 stars')).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the rate-limit message when GitHub throttles us', async () => {
    installFetch({
      repo: new Response('{}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
      release: new Response('{}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
      prs: new Response('{}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
      contributors: new Response('{}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
    });
    await act(async () => {
      render(<CommunitySection />);
    });
    await waitFor(() => {
      expect(screen.getByText(/rate limit reached/)).toBeInTheDocument();
    });
  });

  it('keeps prior cached values when a refresh errors', async () => {
    await writeCommunityStats({
      fetchedAt: Date.now() - 1000 * 60 * 60 * 12, // 12h ago — stale
      stars: 50,
      openIssues: 3,
      latestVersion: 'v1.0.3',
      latestReleaseUrl: 'https://github.com/apicircle/studio/releases/tag/v1.0.3',
      contributors: 4,
      error: null,
    });
    installFetch({
      repo: new TypeError('Failed to fetch'),
      release: new TypeError('Failed to fetch'),
      prs: new TypeError('Failed to fetch'),
      contributors: new TypeError('Failed to fetch'),
    });
    await act(async () => {
      render(<CommunitySection />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Offline — showing cached values/)).toBeInTheDocument();
    });
    expect(screen.getByText('50 stars')).toBeInTheDocument();
  });
});
