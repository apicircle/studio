// Host-agnostic Git provider seam.
//
// Open core ships a single GitHub provider. The Enterprise edition adds
// GitLab / Bitbucket / Azure DevOps by registering additional factories
// behind the same `GitProvider` contract — it never forks this package.
//
// The contract is derived from `GitHubClient` (see `GitProvider` below) so it
// can't drift from the reference implementation, and `github` is resolved
// WITHOUT an import-time side effect: every `@apicircle/*` package sets
// `"sideEffects": false`, which would let a bundler drop a registration that
// ran at module load. So the built-in provider is handled directly and only
// *additional* hosts live in the mutable registry (populated by an explicit
// `registerGitProvider` call, which is never tree-shaken).

import { GitHubClient, type GitHubClientOptions } from './github/api';

/**
 * The `GitHubClient` methods that make up the provider contract. Listed
 * explicitly so `GitProvider` is a STRUCTURAL type (private members stripped):
 * any alternate host client that implements these methods satisfies it,
 * without having to extend `GitHubClient`.
 */
export type GitProviderMethod =
  | 'getViewer'
  | 'listAccessibleRepos'
  | 'getRepo'
  | 'getBranchHead'
  | 'listBranches'
  | 'createBranch'
  | 'getRef'
  | 'getCommit'
  | 'createBlob'
  | 'createTree'
  | 'createCommit'
  | 'updateRef'
  | 'searchMarketplaceRepos'
  | 'startDeviceFlow'
  | 'pollDeviceToken'
  | 'createTag'
  | 'compareCommits'
  | 'isAncestor'
  | 'createRelease'
  | 'getTagSha'
  | 'deleteRef'
  | 'listRepoTopics'
  | 'setRepoTopics'
  | 'getContents'
  | 'putContents'
  | 'getBinaryContents'
  | 'getPullRequest'
  | 'listPullRequests'
  | 'createPullRequest'
  | 'listIssueComments'
  | 'createIssueComment'
  | 'updateIssueComment';

/**
 * Host-agnostic Git provider contract — the surface the workspace
 * connect / refresh / push / release flows depend on. Derived from
 * `GitHubClient` so it stays in lock-step with the reference implementation.
 * Open core only ever resolves the GitHub provider; the Enterprise edition
 * registers additional hosts behind this same type via `registerGitProvider`.
 */
export type GitProvider = Pick<GitHubClient, GitProviderMethod>;

/** Construction options for a provider (base URLs, fetch impl, timeout). */
export type GitProviderOptions = GitHubClientOptions;

/** Builds a provider instance for a given host. */
export type GitProviderFactory = (opts?: GitProviderOptions) => GitProvider;

/** Known Git hosting kinds. Only `github` ships in open core. */
export type GitHostKind = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops';

const githubFactory: GitProviderFactory = (opts) => new GitHubClient(opts);
const extraProviders = new Map<GitHostKind, GitProviderFactory>();

/**
 * Register a non-GitHub provider factory. Called by the Enterprise edition to
 * add GitLab / Bitbucket / Azure DevOps. `github` is built in and cannot be
 * re-registered.
 */
export function registerGitProvider(kind: GitHostKind, factory: GitProviderFactory): void {
  if (kind === 'github') {
    throw new Error("The 'github' provider is built in and cannot be re-registered.");
  }
  extraProviders.set(kind, factory);
}

/**
 * Resolve a provider for `kind` (default `github`). Throws if no provider is
 * registered for a non-GitHub host — open core never reaches that path
 * because it only ever targets GitHub.
 */
export function getGitProvider(
  kind: GitHostKind = 'github',
  opts?: GitProviderOptions,
): GitProvider {
  if (kind === 'github') return githubFactory(opts);
  const factory = extraProviders.get(kind);
  if (!factory) {
    throw new Error(
      `No Git provider registered for host "${kind}". The open-core build supports GitHub only; additional hosts are an Enterprise feature.`,
    );
  }
  return factory(opts);
}

/** True when a provider is available for `kind`. */
export function hasGitProvider(kind: GitHostKind): boolean {
  return kind === 'github' || extraProviders.has(kind);
}

/** Test seam: drop every registered non-GitHub provider. */
export function resetGitProviderRegistry(): void {
  extraProviders.clear();
}

/**
 * Best-effort mapping from a repo origin / remote URL to a host kind.
 * Defaults to `github` (covers github.com and self-hosted GitHub Enterprise,
 * whose custom domains can't be sniffed). Callers that already know the host
 * should pass the kind to `getGitProvider` directly rather than rely on this.
 */
export function gitHostKindFromOrigin(origin: string | null | undefined): GitHostKind {
  if (!origin) return 'github';
  const lower = origin.toLowerCase();
  if (lower.includes('gitlab')) return 'gitlab';
  if (lower.includes('bitbucket')) return 'bitbucket';
  if (lower.includes('dev.azure.com') || lower.includes('visualstudio.com')) return 'azure-devops';
  return 'github';
}
