// Settings → Community section. Surfaces a small set of useful GitHub
// signals (stars, open issues, latest release, contributors) alongside a
// curated set of repo links and a soft "★ helps others find it" ask.
//
// Lazy-fetched: stats only load the first time the user opens the
// Settings popover, then cached in IndexedDB (same persistence store as
// the rest of the app) with a 6h TTL. A manual refresh chip invalidates
// the cache.
//
// Empty / error states are first-class — see the matrix in the
// implementation comments below. We never render `★ 0` to early visitors:
// when stars are sparse, the chip flips to a "Be the first to star"
// invitation instead.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bug,
  ExternalLink,
  Github,
  MessagesSquare,
  Package,
  RotateCw,
  Star,
  Users,
} from 'lucide-react';
import { cn } from '../primitives/cn';
import {
  GITHUB_CONTRIBUTORS_URL,
  GITHUB_ISSUES_NEW_URL,
  GITHUB_ISSUES_URL,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL,
  GITHUB_STARGAZERS_URL,
} from '../primitives/externalLinks';
import { fetchCommunityStats } from './fetchCommunityStats';
import {
  EMPTY_COMMUNITY_STATS,
  readCommunityStats,
  writeCommunityStats,
  type CommunityFetchError,
  type CommunityStatsCache,
} from './communityStorage';

type HydrationStatus = 'pending' | 'ready';

// Cache TTL — the section re-fetches on open after this window. Six
// hours is enough that an engaged user opening Settings a few times in
// a day doesn't burn a request each time, and short enough that the
// numbers don't feel stale.
const PRIMARY_TTL_MS = 6 * 60 * 60 * 1000;
// Threshold below which the stars chip flips to a "Be the first to star"
// invitation. Pre-launch, "★ 3" reads as a negative signal — the flip
// turns the same fact into an ask.
const SPARSE_STAR_THRESHOLD = 10;

export function CommunitySection() {
  const [cache, setCache] = useState<CommunityStatsCache>(EMPTY_COMMUNITY_STATS);
  const [hydration, setHydration] = useState<HydrationStatus>('pending');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await fetchCommunityStats();
    // If the network call itself errored but we already had cached
    // values, keep showing the cached numbers and just stamp the error
    // — this gives users "Updated 2 days ago" rather than blanks after a
    // failed refresh.
    let merged: CommunityStatsCache | null = null;
    setCache((prev) => {
      merged =
        next.error !== null && prev.fetchedAt !== null ? { ...prev, error: next.error } : next;
      return merged;
    });
    if (merged !== null) await writeCommunityStats(merged);
    setLoading(false);
  }, []);

  // Lazy first fetch. IndexedDB reads are async, so the section mounts
  // with the empty record and a `pending` hydration flag — the effect
  // hydrates from disk first, then triggers a network refresh if the
  // cached value is missing or stale. Running once per section mount
  // means we don't burn a fetch on every app launch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await readCommunityStats();
      if (cancelled) return;
      setCache(loaded);
      setHydration('ready');
      if (isStale(loaded)) void refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const showStats = hydration === 'ready' && cache.fetchedAt !== null;
  const stale = cache.fetchedAt !== null && isStale(cache);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-1.5">
        <span className="text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
          Community
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh community stats"
          title="Refresh"
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-sm border border-transparent text-text-dim transition-colors',
            'hover:border-border-subtle hover:text-text-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <RotateCw size={10} aria-hidden="true" className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      <p className="px-1.5 text-[0.6875rem] leading-snug text-text-dim">
        API Circle Studio is open source.
      </p>

      {/*
        When cache.error is non-null and there's no prior cache, we render
        nothing — skip the chips entirely and let the link rows carry the
        section's value.
      */}
      {showStats ? (
        <StatChips cache={cache} />
      ) : loading ? (
        <StatChipsSkeleton />
      ) : cache.error !== null ? null : (
        <StatChipsSkeleton />
      )}

      <div className="mt-1 flex flex-col gap-0.5">
        <LinkRow
          icon={<Star size={13} aria-hidden="true" />}
          label="Star on GitHub"
          href={GITHUB_STARGAZERS_URL}
          accent
        />
        <LinkRow
          icon={<Github size={13} aria-hidden="true" />}
          label="View repository"
          href={GITHUB_REPO_URL}
        />
        <LinkRow
          icon={<MessagesSquare size={13} aria-hidden="true" />}
          label="Browse issues"
          href={GITHUB_ISSUES_URL}
        />
        <LinkRow
          icon={<Bug size={13} aria-hidden="true" />}
          label="Report an issue"
          href={GITHUB_ISSUES_NEW_URL}
        />
        <LinkRow
          icon={<Package size={13} aria-hidden="true" />}
          label="Releases & changelog"
          href={GITHUB_RELEASES_URL}
        />
        {cache.contributors !== null && cache.contributors >= 2 && (
          <LinkRow
            icon={<Users size={13} aria-hidden="true" />}
            label={`Contributors (${cache.contributors})`}
            href={GITHUB_CONTRIBUTORS_URL}
          />
        )}
      </div>

      {cache.error !== null && (
        <p
          className="mt-1 flex items-start gap-1 px-1.5 text-[0.625rem] text-text-dim"
          role="status"
        >
          <AlertCircle size={10} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{formatError(cache.error, cache.fetchedAt)}</span>
        </p>
      )}

      {stale && cache.error === null && cache.fetchedAt !== null && (
        <p className="mt-1 px-1.5 text-[0.625rem] italic text-text-dim">
          Updated {formatRelative(cache.fetchedAt)}.
        </p>
      )}

      <p className="mt-1 px-1.5 text-[0.6875rem] leading-snug text-text-muted">
        Studio helping you ship?{' '}
        <a
          href={GITHUB_STARGAZERS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          ★ Star us on GitHub
        </a>{' '}
        — it&apos;s how other developers discover it.
      </p>
    </div>
  );
}

interface StatChipsProps {
  cache: CommunityStatsCache;
}

function StatChips({ cache }: StatChipsProps) {
  const showSparseStarsCta = cache.stars !== null && cache.stars < SPARSE_STAR_THRESHOLD;
  return (
    <div className="flex flex-wrap gap-1 px-1.5">
      {showSparseStarsCta ? (
        <a
          href={GITHUB_STARGAZERS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 text-[0.6875rem] text-accent hover:bg-accent/20"
        >
          <Star size={10} aria-hidden="true" />
          Be the first to star
        </a>
      ) : cache.stars !== null ? (
        <Chip label={`${formatCount(cache.stars)} stars`} icon={<Star size={10} />} />
      ) : null}
      {cache.openIssues !== null && (
        <Chip
          label={`${formatCount(cache.openIssues)} open ${
            cache.openIssues === 1 ? 'issue' : 'issues'
          }`}
        />
      )}
      {cache.latestVersion !== null && <Chip label={`Latest ${cache.latestVersion}`} />}
    </div>
  );
}

function StatChipsSkeleton() {
  // Three placeholder chips matching the live layout. `aria-hidden` so
  // screen readers don't announce them — the live region on the section
  // header handles the loading state for assistive tech.
  return (
    <div className="flex flex-wrap gap-1 px-1.5" aria-hidden="true">
      <SkeletonChip width="w-16" />
      <SkeletonChip width="w-20" />
      <SkeletonChip width="w-24" />
    </div>
  );
}

function SkeletonChip({ width }: { width: string }) {
  return (
    <span
      className={cn('inline-block h-[1.125rem] animate-pulse rounded-sm bg-surface/60', width)}
    />
  );
}

interface ChipProps {
  label: string;
  icon?: React.ReactNode;
}

function Chip({ label, icon }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-0.5 text-[0.6875rem] text-text-muted">
      {icon !== undefined && <span aria-hidden="true">{icon}</span>}
      {label}
    </span>
  );
}

interface LinkRowProps {
  icon: React.ReactNode;
  label: string;
  href: string;
  /** Apply accent styling. Reserved for the primary "Star" CTA so it
   *  doesn't drown in a list of equally-weighted siblings. */
  accent?: boolean;
}

function LinkRow({ icon, label, href, accent = false }: LinkRowProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-center justify-between gap-2 rounded-sm border border-transparent px-1.5 py-1 text-left transition-colors',
        'hover:border-border-subtle hover:bg-surface',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-2 text-xs',
          accent ? 'text-accent' : 'text-text-primary',
        )}
      >
        <span className={accent ? 'text-accent' : 'text-text-dim'} aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <ExternalLink size={10} aria-hidden="true" className="text-text-faint" />
    </a>
  );
}

/** Format an integer count compactly: 1240 → "1.2k". Keeps the chip
 *  width predictable. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

function formatError(error: CommunityFetchError, fetchedAt: number | null): string {
  if (error === 'rate-limit') {
    return 'GitHub rate limit reached — try again later.';
  }
  if (error === 'offline') {
    return fetchedAt === null
      ? "Couldn't reach GitHub. Check your connection."
      : 'Offline — showing cached values.';
  }
  return "Couldn't load community stats.";
}

function isStale(cache: CommunityStatsCache): boolean {
  if (cache.fetchedAt === null) return true;
  return Date.now() - cache.fetchedAt > PRIMARY_TTL_MS;
}

function formatRelative(epoch: number): string {
  const diffMs = Date.now() - epoch;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Re-export so tests can reset to a known state without importing the
// storage helper directly.
export { EMPTY_COMMUNITY_STATS, PRIMARY_TTL_MS };
