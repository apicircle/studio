// Lazy GitHub REST fetcher for the Settings → Community section. Pulls
// four unauthenticated endpoints in parallel and normalises the result
// into the same shape the localStorage cache uses.
//
// Why unauthenticated:
//   - The endpoints are all public and the rate limit (60 req/hr/IP) is
//     comfortably above what we need (4 calls per 6h per device).
//   - Sending a token would mean prompting the user for one — a creepy
//     ask for a tiny UX win, and it leaks the user's GitHub identity to
//     us.
//
// Error classification:
//   - Network error (fetch throws TypeError) → 'offline'
//   - HTTP 403 with `x-ratelimit-remaining: 0` → 'rate-limit'
//   - Anything else (5xx, malformed JSON, partial parse) → 'unknown'
//
// Partial failure handling: each endpoint is fetched independently; a
// failure on one doesn't poison the others. The returned record carries
// `null` for missing fields and `error` set to the worst classification
// observed.

import { GITHUB_API_REPO_URL } from '../primitives/externalLinks';
import type { CommunityFetchError, CommunityStatsCache } from './communityStorage';

interface RepoPayload {
  stargazers_count: number;
  open_issues_count: number;
}

interface ReleasePayload {
  tag_name: string;
  html_url: string;
}

/**
 * Fetch all four signals. Always resolves — never throws — so the UI can
 * render the result without a try/catch. Inspect `result.error` to know
 * whether to dim the chips.
 */
export async function fetchCommunityStats(now: number = Date.now()): Promise<CommunityStatsCache> {
  const [repo, release, openPrCount, contributors] = await Promise.all([
    fetchRepo(),
    fetchLatestRelease(),
    fetchOpenPrCount(),
    fetchContributorCount(),
  ]);

  const errors: Array<CommunityFetchError | null> = [
    repo.error,
    release.error,
    openPrCount.error,
    contributors.error,
  ];
  const worst = pickWorstError(errors);

  // Subtract open PR count from open_issues_count because GitHub conflates
  // the two. If either is unknown, fall back to the raw issue count.
  const openIssues =
    repo.data !== null
      ? openPrCount.data !== null
        ? Math.max(0, repo.data.open_issues_count - openPrCount.data)
        : repo.data.open_issues_count
      : null;

  const anySuccess = repo.data !== null || release.data !== null || contributors.data !== null;

  return {
    fetchedAt: anySuccess ? now : null,
    stars: repo.data?.stargazers_count ?? null,
    openIssues,
    latestVersion: release.data?.tag_name ?? null,
    latestReleaseUrl: release.data?.html_url ?? null,
    contributors: contributors.data,
    error: worst,
  };
}

interface FetchOutcome<T> {
  data: T | null;
  error: CommunityFetchError | null;
}

async function fetchRepo(): Promise<FetchOutcome<RepoPayload>> {
  return fetchJson<RepoPayload>(GITHUB_API_REPO_URL);
}

async function fetchLatestRelease(): Promise<FetchOutcome<ReleasePayload>> {
  // Returns 404 when the repo has no published releases — treat as a
  // benign "no data" rather than an error so the chip just hides.
  const url = `${GITHUB_API_REPO_URL}/releases/latest`;
  const out = await fetchJson<ReleasePayload>(url, { allowNotFound: true });
  return out;
}

async function fetchOpenPrCount(): Promise<FetchOutcome<number>> {
  // Use the Search API's `total_count` field — `/pulls?state=open` only
  // gives a page of PRs, not a count. Search is rate-limited separately
  // (30 req/min) and still well above our needs.
  const url = `https://api.github.com/search/issues?q=repo:apicircle/studio+is:pr+is:open&per_page=1`;
  try {
    const res = await fetch(url, { headers: GITHUB_HEADERS });
    const classified = classifyResponse(res);
    if (classified !== null) return { data: null, error: classified };
    const json = (await res.json()) as { total_count?: number };
    return {
      data: typeof json.total_count === 'number' ? json.total_count : null,
      error: typeof json.total_count === 'number' ? null : 'unknown',
    };
  } catch (e) {
    return { data: null, error: classifyThrown(e) };
  }
}

async function fetchContributorCount(): Promise<FetchOutcome<number>> {
  // Pagination trick: ask for one contributor per page and read the
  // `Link: <…?page=N>; rel="last"` header — N is the total count.
  // `anon=true` includes commit-only contributors who never linked an
  // account.
  const url = `${GITHUB_API_REPO_URL}/contributors?per_page=1&anon=true`;
  try {
    const res = await fetch(url, { headers: GITHUB_HEADERS });
    const classified = classifyResponse(res);
    if (classified !== null) return { data: null, error: classified };
    const linkHeader = res.headers.get('Link');
    const fromLink = parseLastPageFromLinkHeader(linkHeader);
    if (fromLink !== null) return { data: fromLink, error: null };
    // No Link header → either zero or one contributor. Count the body.
    const body = (await res.json()) as unknown[];
    return { data: Array.isArray(body) ? body.length : 0, error: null };
  } catch (e) {
    return { data: null, error: classifyThrown(e) };
  }
}

interface FetchJsonOptions {
  allowNotFound?: boolean;
}

async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<FetchOutcome<T>> {
  try {
    const res = await fetch(url, { headers: GITHUB_HEADERS });
    if (options.allowNotFound === true && res.status === 404) {
      return { data: null, error: null };
    }
    const classified = classifyResponse(res);
    if (classified !== null) return { data: null, error: classified };
    const json = (await res.json()) as T;
    return { data: json, error: null };
  } catch (e) {
    return { data: null, error: classifyThrown(e) };
  }
}

const GITHUB_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

function classifyResponse(res: Response): CommunityFetchError | null {
  if (res.ok) return null;
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    return 'rate-limit';
  }
  if (res.status === 429) return 'rate-limit';
  return 'unknown';
}

function classifyThrown(error: unknown): CommunityFetchError {
  // `fetch` throws TypeError on network failure (DNS, offline, blocked
  // by CSP). Anything else is bucketed as 'unknown' rather than masking
  // as offline.
  if (error instanceof TypeError) return 'offline';
  return 'unknown';
}

/** Pick the worst classification across all four sub-fetches so a single
 *  rate-limited endpoint surfaces to the user rather than getting masked
 *  by a no-op success on another. */
function pickWorstError(errors: Array<CommunityFetchError | null>): CommunityFetchError | null {
  if (errors.includes('rate-limit')) return 'rate-limit';
  if (errors.includes('offline')) return 'offline';
  if (errors.includes('unknown')) return 'unknown';
  return null;
}

/**
 * Parse `Link: <https://…?page=42>; rel="last", <…>; rel="first"` and
 * return the `page` query param value from the `rel="last"` entry.
 * Returns null if the header is missing or has no `last` rel.
 * Exported for unit testing.
 */
export function parseLastPageFromLinkHeader(header: string | null): number | null {
  if (header === null || header.length === 0) return null;
  // Split on commas not inside angle brackets. The header is a comma-
  // separated list of `<url>; rel="..."` entries; URLs don't contain
  // commas, so a naive split is safe enough for GitHub's well-formed
  // headers.
  for (const entry of header.split(',')) {
    const trimmed = entry.trim();
    if (!/\brel="last"/.test(trimmed)) continue;
    const urlMatch = /<([^>]+)>/.exec(trimmed);
    if (urlMatch === null) continue;
    const pageMatch = /[?&]page=(\d+)/.exec(urlMatch[1]);
    if (pageMatch === null) continue;
    const n = Number.parseInt(pageMatch[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
