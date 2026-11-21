// Canonical external URLs surfaced from the UI. Centralised so a host or
// release-channel change only touches this file. Every UI surface that
// opens GitHub (Settings → Community, banners, error toasts) imports from
// here — no inline `github.com/apicircle/studio` literals. The links that write
// to us instead (the Help footer's "Open an issue") are in `@apicircle/shared`
// (`contact.ts`), where the desktop shell can read them too.

/**
 * Plans and prices, on the website. Each plan there says how many workspaces it
 * keeps open, and its buttons lead on to the account site for whoever wants
 * one. Studio has no account of its own to sign in to, so this is as far as it
 * can take somebody.
 */
export const PRICING_URL = 'https://apicircle.dev/pricing';

/**
 * The website's page about Lens: the paid features of the API Circle desktop
 * app (the Code graph, PR Review drift, the Assistant, MCP and the CLI), what
 * each plan includes and how it is delivered. The standalone app's header links
 * here (`TopBar`'s `lensLink`).
 */
export const LENS_URL = 'https://apicircle.dev/lens';

/**
 * Where the desktop app is downloaded: the website's download page. It offers
 * the API Circle desktop app, which includes this free workspace, with each
 * system's own channel and install steps. Every "get the desktop app" link in
 * the UI and the Help Center points here.
 */
export const DESKTOP_DOWNLOAD_URL = 'https://apicircle.dev/download';

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
 * Legacy alias, kept because the package exports it (`DESKTOP_RELEASES_URL`
 * from `desktopDownload.tsx`). It used to name the latest GitHub release and
 * now names the download page. New code should reach for
 * `DESKTOP_DOWNLOAD_URL` directly.
 */
export const DESKTOP_RELEASES_URL = DESKTOP_DOWNLOAD_URL;
