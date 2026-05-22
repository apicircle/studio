// IndexedDB-backed cache for the Settings → Community section. Install-
// scoped (per origin, not per workspace) — switching workspaces doesn't
// reset the user's relationship with the project, so the cache lives
// outside the per-workspace synced/local docs. Lives in the existing
// registry object store under a dedicated key (see `db.ts`) so we don't
// need a schema-version bump for ~200 bytes.

import {
  clearCommunityStatsRecord,
  readCommunityStatsRecord,
  writeCommunityStatsRecord,
} from '../persistence/db';

/** Reasons a stats fetch failed; surfaces as a dimmed badge in the UI. */
export type CommunityFetchError = 'rate-limit' | 'offline' | 'unknown';

export interface CommunityStatsCache {
  /** Epoch ms of the last successful fetch. `null` if never fetched. */
  fetchedAt: number | null;
  /** Stargazer count. Null when never fetched or when the last fetch failed. */
  stars: number | null;
  /** Open issues, with open PRs subtracted (GitHub counts PRs as issues). */
  openIssues: number | null;
  /** Latest release tag, e.g. `v1.0.3`. Null if the repo has no releases yet. */
  latestVersion: string | null;
  /** GitHub URL to the latest release notes. */
  latestReleaseUrl: string | null;
  /** Distinct contributor count. */
  contributors: number | null;
  /** Last error, if the most recent fetch was a failure. */
  error: CommunityFetchError | null;
}

export const EMPTY_COMMUNITY_STATS: CommunityStatsCache = {
  fetchedAt: null,
  stars: null,
  openIssues: null,
  latestVersion: null,
  latestReleaseUrl: null,
  contributors: null,
  error: null,
};

/** Read the cached stats from IndexedDB. Returns the empty record when
 *  nothing is stored or when the stored payload is malformed (we never
 *  let a bad cache crash the UI). */
export async function readCommunityStats(): Promise<CommunityStatsCache> {
  const raw = await readCommunityStatsRecord<Partial<CommunityStatsCache>>();
  if (raw === null) return EMPTY_COMMUNITY_STATS;
  return {
    fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
    stars: typeof raw.stars === 'number' ? raw.stars : null,
    openIssues: typeof raw.openIssues === 'number' ? raw.openIssues : null,
    latestVersion: typeof raw.latestVersion === 'string' ? raw.latestVersion : null,
    latestReleaseUrl: typeof raw.latestReleaseUrl === 'string' ? raw.latestReleaseUrl : null,
    contributors: typeof raw.contributors === 'number' ? raw.contributors : null,
    error: normalizeError(raw.error),
  };
}

/** Persist the stats cache. Best-effort — failures swallowed (see `db.ts`). */
export async function writeCommunityStats(next: CommunityStatsCache): Promise<void> {
  await writeCommunityStatsRecord(next);
}

/** Drop the cache. Exposed for tests; the UI never clears it manually. */
export async function clearCommunityStats(): Promise<void> {
  await clearCommunityStatsRecord();
}

function normalizeError(value: unknown): CommunityFetchError | null {
  return value === 'rate-limit' || value === 'offline' || value === 'unknown' ? value : null;
}
