// Canonical external URLs surfaced from the UI. Centralised so a host or
// release-channel change only touches this file. Every UI surface that
// opens GitHub (Help footer, Settings → Community, banners, error toasts)
// imports from here — no inline `github.com/apicircle/studio` literals.

const GITHUB_REPO_BASE = 'https://github.com/apicircle/studio';

/** Canonical owner/repo slug. Used by the GitHub REST client + tests. */
export const GITHUB_REPO_SLUG = 'apicircle/studio';

/** Repo home — README, code, top-level nav. */
export const GITHUB_REPO_URL = GITHUB_REPO_BASE;

/** Stargazers list. Linked from the "Star on GitHub" affordance so the
 *  user lands on the star action with context, not on the README root. */
export const GITHUB_STARGAZERS_URL = `${GITHUB_REPO_BASE}/stargazers`;

/** Issues index. */
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_BASE}/issues`;

/** New-issue chooser. Newer than the bare `/issues/new` (lets GitHub route
 *  to a bug/feature template when the repo defines them). */
export const GITHUB_ISSUES_NEW_URL = `${GITHUB_REPO_BASE}/issues/new/choose`;

/** Releases index — full changelog history. */
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_BASE}/releases`;

/** Most-recent release. Desktop downloads land here. */
export const GITHUB_RELEASES_LATEST_URL = `${GITHUB_REPO_BASE}/releases/latest`;

/** Contributors graph. */
export const GITHUB_CONTRIBUTORS_URL = `${GITHUB_REPO_BASE}/graphs/contributors`;

/** Pull requests index. Not exposed in v1; reserved for future surfaces. */
export const GITHUB_PULLS_URL = `${GITHUB_REPO_BASE}/pulls`;

/** Discussions. Conditional — only render when the repo actually enables
 *  the Discussions tab. */
export const GITHUB_DISCUSSIONS_URL = `${GITHUB_REPO_BASE}/discussions`;

/** GitHub REST API root for the repo. Used by the lazy community-stats
 *  fetcher; all GET, no auth, all cached. */
export const GITHUB_API_REPO_URL = `https://api.github.com/repos/${GITHUB_REPO_SLUG}`;

/**
 * Legacy alias — many call sites still import `DESKTOP_RELEASES_URL` from
 * `desktopDownload.tsx`. That file now re-exports this constant. New code
 * should reach for `GITHUB_RELEASES_LATEST_URL` directly.
 */
export const DESKTOP_RELEASES_URL = GITHUB_RELEASES_LATEST_URL;
