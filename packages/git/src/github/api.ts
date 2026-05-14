// Tiny GitHub REST client. We avoid pulling in @octokit/* because we only
// need a handful of endpoints and the typed errors are more important than
// the breadth of coverage.
//
// Token-handling rule: the caller passes the PAT per call. The client never
// logs it, never stores it, never includes it in error messages. The host
// (ui-components) is responsible for token storage (Secret Vault).

import {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  TimeoutError,
  UnauthorizedError,
} from './errors';

const API_BASE = 'https://api.github.com';
const LOGIN_BASE = 'https://github.com';

export interface GitHubViewer {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string | null;
}

export interface ScopeInfo {
  granted: string[];
  acceptedRequired?: string[];
}

export interface GitHubRepo {
  /** owner/name, the canonical workspace identifier on GitHub. */
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  isPrivate: boolean;
  pushable: boolean;
}

export interface GitHubBranch {
  name: string;
  commitSha: string;
}

export interface GitHubClientOptions {
  /** Override the API base URL (e.g. GitHub Enterprise). */
  baseUrl?: string;
  /**
   * Override the base for `github.com/login/*` OAuth endpoints. Defaults to
   * `https://github.com`. The browser path sets this to a same-origin
   * proxy (e.g. `/_gh-oauth`) because GitHub doesn't send CORS headers on
   * the device-flow endpoints.
   */
  loginBaseUrl?: string;
  /** Inject a custom fetch — used by tests to mock without msw. */
  fetchImpl?: typeof fetch;
  /** Hard timeout per call. Defaults to 15s. */
  timeoutMs?: number;
}

export interface GitRef {
  ref: string; // e.g. "refs/heads/apicircle/payments-a3f9c2"
  sha: string;
}

export interface GitCommitSummary {
  sha: string;
  treeSha: string;
  message: string;
}

export interface TreeEntryInput {
  path: string;
  mode?: '100644' | '100755' | '040000' | '160000' | '120000';
  type?: 'blob' | 'tree' | 'commit';
  /** Inline content — used for text files we don't need to base64. */
  content?: string;
  /** Pre-uploaded blob sha — used for binary attachments. */
  sha?: string | null;
}

export interface CreatedTree {
  sha: string;
}

export interface CreatedCommit {
  sha: string;
  treeSha: string;
}

export interface CreatedBlob {
  sha: string;
  size: number;
}

export interface PullRequestSummary {
  number: number;
  /** GitHub UI URL (e.g. https://github.com/me/api/pull/12) — what we link to. */
  htmlUrl: string;
  state: 'open' | 'closed';
  title: string;
}

export interface MarketplaceRepo {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  topics: string[];
  stargazers: number;
  defaultBranch: string;
}

export interface FileContents {
  /** Raw file bytes decoded from GitHub's base64 transport. */
  content: string;
  /** Git blob SHA — used for fast equality checks across pulls. */
  sha: string;
  /** Path returned by GitHub (matches what we requested). */
  path: string;
  size: number;
}

export interface BinaryFileContents {
  /** Raw file bytes — used for binary attachments where UTF-8 decoding would corrupt the data. */
  bytes: Uint8Array;
  sha: string;
  path: string;
  size: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Scopes the caller wants verified — surfaced into MissingScopeError. */
  requiredScopes?: string[];
}

export class GitHubClient {
  private readonly baseUrl: string;
  private readonly loginBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: GitHubClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? API_BASE;
    this.loginBaseUrl = (opts.loginBaseUrl ?? LOGIN_BASE).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Fetch the authenticated user. Doubles as a "verify token" probe — used
   * by the Secret Vault Sessions tab to refresh the granted-scopes list.
   */
  async getViewer(
    token: string,
    opts: CallOptions = {},
  ): Promise<{
    viewer: GitHubViewer;
    scopes: ScopeInfo;
  }> {
    const { json, response } = await this.call<RawUser>(token, '/user', opts);
    return {
      viewer: {
        login: json.login,
        id: json.id,
        name: json.name ?? null,
        avatarUrl: json.avatar_url ?? null,
      },
      scopes: parseScopes(response.headers),
    };
  }

  /**
   * List repositories the authenticated user can access. Used by the repo
   * picker. Capped at 100 sorted by recent push; users with thousands of
   * repos can paginate later.
   */
  async listAccessibleRepos(token: string, opts: CallOptions = {}): Promise<GitHubRepo[]> {
    const { json } = await this.call<RawRepo[]>(
      token,
      '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      opts,
    );
    return json.map(normalizeRepo);
  }

  /**
   * Fetch a specific repo. Validates the user-supplied owner/name pair
   * exists + is accessible, and exposes the default branch.
   */
  async getRepo(
    token: string,
    owner: string,
    name: string,
    opts: CallOptions = {},
  ): Promise<GitHubRepo> {
    const { json } = await this.call<RawRepo>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      opts,
    );
    return normalizeRepo(json);
  }

  /**
   * Read the head SHA of a branch. Used to seed a new working branch from
   * main before any edits land.
   */
  async getBranchHead(
    token: string,
    owner: string,
    name: string,
    branch: string,
    opts: CallOptions = {},
  ): Promise<GitHubBranch> {
    const { json } = await this.call<RawBranch>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(branch)}`,
      opts,
    );
    return { name: json.name, commitSha: json.commit.sha };
  }

  /**
   * List branches on a repo. Used by the Link Workspace repo-browser to
   * populate the branch dropdown after the user picks a repo. Capped at
   * 100 (GitHub's max page size); repos with more branches paginate.
   */
  async listBranches(
    token: string,
    owner: string,
    name: string,
    opts: CallOptions = {},
  ): Promise<GitHubBranch[]> {
    const { json } = await this.call<RawBranch[]>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=100`,
      opts,
    );
    return json.map((b) => ({ name: b.name, commitSha: b.commit.sha }));
  }

  /**
   * Create a new branch ref pointing at `sha`. The auto-branch flow calls
   * this with the head SHA from `getBranchHead(main)`.
   *
   * GitHub returns 422 with "Reference already exists" when the branch
   * already exists; that surfaces as a GitHubError(422) so the UI can
   * prompt for a different name.
   */
  async createBranch(
    token: string,
    owner: string,
    name: string,
    branchName: string,
    sha: string,
    opts: CallOptions = {},
  ): Promise<GitHubBranch> {
    const { json } = await this.call<RawRefResponse>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`,
      {
        ...opts,
        method: 'POST',
        body: { ref: `refs/heads/${branchName}`, sha },
        requiredScopes: ['repo'],
      },
    );
    return { name: branchName, commitSha: json.object.sha };
  }

  /**
   * Read a branch ref's current commit SHA. Used at the start of push-to-
   * save to find the parent commit before building the new tree.
   */
  async getRef(
    token: string,
    owner: string,
    name: string,
    branch: string,
    opts: CallOptions = {},
  ): Promise<GitRef> {
    const { json } = await this.call<RawRefResponse>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs/heads/${encodeURIComponent(branch)}`,
      opts,
    );
    return { ref: json.ref, sha: json.object.sha };
  }

  /**
   * Read a commit's tree SHA. Used so the new tree can be built `base_tree`
   * — every path we don't override is inherited from the parent.
   */
  async getCommit(
    token: string,
    owner: string,
    name: string,
    sha: string,
    opts: CallOptions = {},
  ): Promise<GitCommitSummary> {
    const { json } = await this.call<RawCommit>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits/${encodeURIComponent(sha)}`,
      opts,
    );
    return {
      sha: json.sha,
      treeSha: json.tree.sha,
      message: json.message,
    };
  }

  /**
   * Upload a blob to the repo and return its SHA. Used by push-to-save
   * (P4.3b) for binary attachments — text files go straight into a tree
   * entry's `content`, but binary bytes have to go through a blob first.
   *
   * `content` is base64 when `encoding === 'base64'`. GitHub stores blobs
   * deduplicated by their git-sha1 (not our sha256), so re-uploading the
   * same bytes is cheap on their side; we save a roundtrip locally by
   * tracking lastPushedBlobSha per slot in a future revision.
   */
  async createBlob(
    token: string,
    owner: string,
    name: string,
    args: { content: string; encoding: 'utf-8' | 'base64' },
    opts: CallOptions = {},
  ): Promise<CreatedBlob> {
    const { json } = await this.call<{ sha: string; size?: number }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs`,
      {
        ...opts,
        method: 'POST',
        body: { content: args.content, encoding: args.encoding },
        requiredScopes: ['repo'],
      },
    );
    return { sha: json.sha, size: json.size ?? 0 };
  }

  /**
   * Build a new tree from `entries`, layered over `baseTreeSha`. Entries
   * with `content` are inlined (text path); entries with a pre-uploaded
   * `sha` reference an existing blob (binary path — used by attachments).
   */
  async createTree(
    token: string,
    owner: string,
    name: string,
    args: { baseTreeSha: string; entries: TreeEntryInput[] },
    opts: CallOptions = {},
  ): Promise<CreatedTree> {
    const tree = args.entries.map((e) => ({
      path: e.path,
      mode: e.mode ?? '100644',
      type: e.type ?? 'blob',
      ...(e.content !== undefined ? { content: e.content } : {}),
      ...(e.sha !== undefined ? { sha: e.sha } : {}),
    }));
    const { json } = await this.call<{ sha: string }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees`,
      {
        ...opts,
        method: 'POST',
        body: { base_tree: args.baseTreeSha, tree },
        requiredScopes: ['repo'],
      },
    );
    return { sha: json.sha };
  }

  /**
   * Create a new commit object pointing at the given tree, with the given
   * parents. Returns the new commit's SHA + the tree it points at.
   */
  async createCommit(
    token: string,
    owner: string,
    name: string,
    args: { message: string; treeSha: string; parents: string[] },
    opts: CallOptions = {},
  ): Promise<CreatedCommit> {
    const { json } = await this.call<RawCommit>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits`,
      {
        ...opts,
        method: 'POST',
        body: {
          message: args.message,
          tree: args.treeSha,
          parents: args.parents,
        },
        requiredScopes: ['repo'],
      },
    );
    return { sha: json.sha, treeSha: json.tree.sha };
  }

  /**
   * Fast-forward a branch ref to a new commit SHA. Pass `force: true` to
   * skip the FF check (we don't — push-to-save is always FF over the ref
   * we just read with getRef()).
   */
  async updateRef(
    token: string,
    owner: string,
    name: string,
    args: { branch: string; sha: string; force?: boolean },
    opts: CallOptions = {},
  ): Promise<GitRef> {
    const { json } = await this.call<RawRefResponse>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs/heads/${encodeURIComponent(args.branch)}`,
      {
        ...opts,
        method: 'PATCH',
        body: { sha: args.sha, force: args.force ?? false },
        requiredScopes: ['repo'],
      },
    );
    return { ref: json.ref, sha: json.object.sha };
  }

  /**
   * Search GitHub for repos in the public marketplace. Appends
   * `topic:apicircle-marketplace` to the user-supplied query so only
   * repos that opt into the topic surface in results. Top 30 by default
   * sort (best match). Token is optional — anonymous browsing is
   * supported (lower GitHub rate limits apply); pass a PAT when one is
   * available to lift them.
   */
  async searchMarketplaceRepos(
    token: string | null,
    query: string,
    opts: CallOptions = {},
  ): Promise<MarketplaceRepo[]> {
    const fullQuery = `${query.trim()} topic:apicircle-marketplace`.trim();
    const path = `/search/repositories?q=${encodeURIComponent(fullQuery)}&per_page=30`;
    const { json } = await this.call<{ items?: RawSearchRepo[] }>(token, path, opts);
    const items = json.items ?? [];
    return items.map(normalizeMarketplaceRepo);
  }

  /**
   * Start GitHub's OAuth Device Flow. Returns a user-facing code the
   * user types into github.com/login/device + a device_code the app
   * polls with. Pure browser-safe: no client_secret involved (device
   * flow is the only OAuth path GitHub supports for public clients).
   *
   * Requires the OAuth App to have "Enable Device Flow" turned on in
   * its GitHub settings — surface 400 with `not_supported` to the user
   * if the App owner hasn't done that yet.
   */
  async startDeviceFlow(
    clientId: string,
    scope: string,
    opts: CallOptions = {},
  ): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  }> {
    const url = `${this.loginBaseUrl}/login/device/code`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope }),
      signal: opts.signal,
    });
    if (!response.ok) {
      throw new GitHubError(
        `Device-flow start failed: HTTP ${response.status}`,
        response.status,
        {},
      );
    }
    const json = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
      error?: string;
      error_description?: string;
    };
    if (json.error) {
      throw new GitHubError(json.error_description ?? json.error, 400, json);
    }
    return {
      deviceCode: json.device_code,
      userCode: json.user_code,
      verificationUri: json.verification_uri,
      expiresIn: json.expires_in,
      interval: json.interval,
    };
  }

  /**
   * Poll for the access token after the user has authorized the device
   * code. GitHub returns `authorization_pending` until the user
   * completes the flow, `slow_down` if we polled too fast, then a real
   * token. Caller wraps this in a polling loop bounded by `expiresIn`.
   */
  async pollDeviceToken(
    clientId: string,
    deviceCode: string,
    opts: CallOptions = {},
  ): Promise<
    | { kind: 'pending'; slowDown: boolean }
    | { kind: 'denied'; reason: string }
    | { kind: 'expired' }
    | { kind: 'granted'; accessToken: string; tokenType: string; scope: string }
  > {
    const url = `${this.loginBaseUrl}/login/oauth/access_token`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      signal: opts.signal,
    });
    const json = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (json.access_token) {
      return {
        kind: 'granted',
        accessToken: json.access_token,
        tokenType: json.token_type ?? 'bearer',
        scope: json.scope ?? '',
      };
    }
    if (json.error === 'authorization_pending') return { kind: 'pending', slowDown: false };
    if (json.error === 'slow_down') return { kind: 'pending', slowDown: true };
    if (json.error === 'expired_token') return { kind: 'expired' };
    if (json.error === 'access_denied')
      return { kind: 'denied', reason: json.error_description ?? 'User denied authorization' };
    // Any other error: throw so the UI surfaces it.
    throw new GitHubError(
      json.error_description ?? json.error ?? 'Device-token poll failed',
      response.status,
      json,
    );
  }

  /**
   * Create a lightweight Git tag (a ref under `refs/tags/<name>`) on the
   * given commit SHA. Used by the publish-release flow when the user
   * opts in to "Create Git tag v<x.y.z>". Returns the resolved ref.
   *
   * GitHub returns 422 with "Reference already exists" when the tag is
   * a duplicate; that surfaces as a GitHubError(422) so the UI can warn
   * the user without ever overwriting an existing tag.
   */
  async createTag(
    token: string,
    owner: string,
    name: string,
    args: { tagName: string; sha: string },
    opts: CallOptions = {},
  ): Promise<GitRef> {
    const { json } = await this.call<RawRefResponse>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`,
      {
        ...opts,
        method: 'POST',
        body: { ref: `refs/tags/${args.tagName}`, sha: args.sha },
        requiredScopes: ['repo'],
      },
    );
    return { ref: json.ref, sha: json.object.sha };
  }

  /**
   * Compare two commits. Returns the relationship classification GitHub
   * gives us: `ahead` (head is descendant of base), `behind` (base is
   * descendant of head), `identical`, or `diverged` (the two histories
   * share a base but neither contains the other — typical of a force-push
   * that rewrote history under us).
   *
   * Used by the refresh path so we never silently 3-way-merge across a
   * history rewrite — divergence steers the user through an explicit
   * "history rewritten" modal instead of corrupting local state.
   */
  async compareCommits(
    token: string,
    owner: string,
    name: string,
    base: string,
    head: string,
    opts: CallOptions = {},
  ): Promise<{
    status: 'ahead' | 'behind' | 'identical' | 'diverged';
    aheadBy: number;
    behindBy: number;
  }> {
    const { json } = await this.call<{
      status: 'ahead' | 'behind' | 'identical' | 'diverged';
      ahead_by: number;
      behind_by: number;
    }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${encodeURIComponent(
        base,
      )}...${encodeURIComponent(head)}`,
      { ...opts, requiredScopes: ['repo'] },
    );
    return {
      status: json.status,
      aheadBy: json.ahead_by,
      behindBy: json.behind_by,
    };
  }

  /**
   * Is `ancestor` reachable from `descendant`? Thin wrapper around
   * `compareCommits` — "ahead" or "identical" means yes; "behind" or
   * "diverged" means the histories don't fit, so the answer is no.
   */
  async isAncestor(
    token: string,
    owner: string,
    name: string,
    ancestor: string,
    descendant: string,
    opts: CallOptions = {},
  ): Promise<boolean> {
    if (ancestor === descendant) return true;
    const cmp = await this.compareCommits(token, owner, name, ancestor, descendant, opts);
    return cmp.status === 'ahead' || cmp.status === 'identical';
  }

  /**
   * Create a GitHub Release pointing at an existing tag. Used by the
   * publish-release flow when the user opts in to "Create GitHub
   * Release". Returns the release's HTML URL so the UI can show a
   * "Released — view on GitHub" link.
   *
   * Pass `prerelease: true` for semver pre-release identifiers (e.g.
   * `1.0.0-rc.1`); GitHub's Releases UI flags those distinctly.
   */
  async createRelease(
    token: string,
    owner: string,
    name: string,
    args: {
      tagName: string;
      releaseName?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
    },
    opts: CallOptions = {},
  ): Promise<{ id: number; htmlUrl: string; tagName: string }> {
    const { json } = await this.call<{
      id: number;
      html_url: string;
      tag_name: string;
    }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases`, {
      ...opts,
      method: 'POST',
      body: {
        tag_name: args.tagName,
        name: args.releaseName ?? args.tagName,
        body: args.body ?? '',
        draft: args.draft ?? false,
        prerelease: args.prerelease ?? false,
      },
      requiredScopes: ['repo'],
    });
    return { id: json.id, htmlUrl: json.html_url, tagName: json.tag_name };
  }

  /**
   * Read a tag ref's current commit SHA. Used by the Release & topics
   * modal to detect whether a tag with the chosen name already exists
   * (so the UI can surface an "Override existing tag" toggle instead of
   * silently 422'ing through createTag).
   *
   * Returns `null` when the tag doesn't exist (404). Other failures
   * surface as typed errors.
   */
  async getTagSha(
    token: string,
    owner: string,
    name: string,
    tagName: string,
    opts: CallOptions = {},
  ): Promise<string | null> {
    try {
      const { json } = await this.call<RawRefResponse>(
        token,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs/tags/${encodeURIComponent(tagName)}`,
        opts,
      );
      return json.object.sha;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Delete a ref. Used to support the "Override existing tag" path on
   * the Release & topics modal — we delete the existing tag ref, then
   * createTag against the new SHA. (GitHub doesn't have a single
   * "force-update tag" endpoint via the simple refs API.)
   *
   * `ref` is the bare suffix, e.g. `tags/v1.0.0` or `heads/feature-x`.
   */
  async deleteRef(
    token: string,
    owner: string,
    name: string,
    ref: string,
    opts: CallOptions = {},
  ): Promise<void> {
    await this.call<unknown>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs/${ref
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      {
        ...opts,
        method: 'DELETE',
        requiredScopes: ['repo'],
      },
    );
  }

  /**
   * Read the repo's current topic list. Topics drive marketplace
   * discoverability — public APICircle workspaces include `apicircle`
   * plus user-chosen category topics.
   *
   * Note: GitHub's topics API uses a custom Accept header, but we treat
   * that as transport detail; the `application/vnd.github.mercy-preview+json`
   * preview is now stable so the default Accept works.
   */
  async listRepoTopics(
    token: string,
    owner: string,
    name: string,
    opts: CallOptions = {},
  ): Promise<string[]> {
    const { json } = await this.call<{ names: string[] }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/topics`,
      opts,
    );
    return Array.isArray(json.names) ? json.names : [];
  }

  /**
   * Replace the repo's full topic list. GitHub's `PUT /topics` endpoint
   * is a full replace (not a merge), so the caller must pass the
   * complete desired list. Caps at 20 topics; each must match
   * `^[a-z0-9][a-z0-9-]*$` and be ≤ 50 chars (GitHub enforces this with
   * a 422). Returns the persisted list.
   */
  async setRepoTopics(
    token: string,
    owner: string,
    name: string,
    topics: string[],
    opts: CallOptions = {},
  ): Promise<string[]> {
    const { json } = await this.call<{ names: string[] }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/topics`,
      {
        ...opts,
        method: 'PUT',
        body: { names: topics },
        requiredScopes: ['repo'],
      },
    );
    return Array.isArray(json.names) ? json.names : [];
  }

  /**
   * Fetch a single file's contents from a branch / commit. Returns
   * `null` when GitHub answers 404 (file simply doesn't exist on that
   * ref — the common case for the very first pull). Other failures
   * surface as the usual typed errors.
   *
   * Used by the refresh flow to read remote `workspace.json` so the
   * 3-way diff can compare it against the local doc.
   */
  async getContents(
    token: string,
    owner: string,
    name: string,
    path: string,
    ref: string,
    opts: CallOptions = {},
  ): Promise<FileContents | null> {
    const query = `?ref=${encodeURIComponent(ref)}`;
    try {
      const { json } = await this.call<RawFileContents>(
        token,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}${query}`,
        opts,
      );
      // GitHub may return an array for directories — we only care about files.
      if (Array.isArray(json) || json.type !== 'file') {
        throw new GitHubError(`Path ${path} is not a file`, 422, json);
      }
      // GitHub wraps base64 in lines of 60 chars + \n; strip them before decoding.
      const cleaned = json.content.replace(/\n/g, '');
      const decoded = decodeBase64Utf8(cleaned);
      return { content: decoded, sha: json.sha, path: json.path, size: json.size };
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Create or update a file via the Contents API. The killer feature here
   * vs. the git-data flow (createBlob → createTree → createCommit →
   * updateRef) is that this works on **truly empty repos**: GitHub's git
   * database isn't initialized until the first commit lands, so all the
   * `/git/*` endpoints reject with 409 "Git Repository is empty" — but
   * `PUT /contents/{path}` atomically initializes the database with a
   * single-file commit on the supplied branch (defaulting to the repo's
   * default branch).
   *
   * Used by the seed-initial-commit flow to bootstrap a freshly-created
   * empty repo with a scaffold `workspace.json`.
   *
   * `contentBase64` must already be base64-encoded — caller chooses the
   * encoder (TextEncoder for UTF-8 strings, raw bytes for binaries).
   */
  async putContents(
    token: string,
    owner: string,
    name: string,
    path: string,
    args: { message: string; contentBase64: string; branch?: string; sha?: string },
    opts: CallOptions = {},
  ): Promise<{ commitSha: string; contentSha: string }> {
    const body: Record<string, unknown> = {
      message: args.message,
      content: args.contentBase64,
    };
    if (args.branch) body.branch = args.branch;
    if (args.sha) body.sha = args.sha;
    const { json } = await this.call<{
      commit: { sha: string };
      content: { sha: string };
    }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      {
        ...opts,
        method: 'PUT',
        body,
        requiredScopes: ['repo'],
      },
    );
    return { commitSha: json.commit.sha, contentSha: json.content.sha };
  }

  /**
   * Same as `getContents` but returns the raw bytes instead of UTF-8
   * decoding the file. Used by the refresh flow to pull
   * `.apicircle/attachments/<slotId>` blobs into local IDB without
   * mangling binary data through TextDecoder.
   */
  async getBinaryContents(
    token: string,
    owner: string,
    name: string,
    path: string,
    ref: string,
    opts: CallOptions = {},
  ): Promise<BinaryFileContents | null> {
    const query = `?ref=${encodeURIComponent(ref)}`;
    try {
      const { json } = await this.call<RawFileContents>(
        token,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}${query}`,
        opts,
      );
      if (Array.isArray(json) || json.type !== 'file') {
        throw new GitHubError(`Path ${path} is not a file`, 422, json);
      }
      const cleaned = json.content.replace(/\n/g, '');
      const bytes = decodeBase64Bytes(cleaned);
      return { bytes, sha: json.sha, path: json.path, size: json.size };
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Open a pull request from `head` (the working branch) into `base` (the
   * repo's default branch). PR creation needs the `pull_request` scope on
   * top of `repo`; missing-scope errors flow through MissingScopeError so
   * the UI can prompt the user to update the token without losing branch
   * state (Plan §3.7).
   *
   * GitHub returns 422 when:
   *   - head/base are equal (nothing to merge)
   *   - a PR already exists between this head and base
   *   - the head branch doesn't exist
   * All three surface as a plain GitHubError(422); the UI message is
   * picked up from response.body.message.
   */
  /**
   * Fetch a single pull request by number. Used by the refresh flow to
   * detect whether a previously-opened PR has been merged on GitHub —
   * `merged: true` is what triggers the working-branch retirement path.
   *
   * Returns `null` on 404 (PR was deleted or never existed at this number);
   * other failures surface as the usual typed errors.
   */
  async getPullRequest(
    token: string,
    owner: string,
    name: string,
    number: number,
    opts: CallOptions = {},
  ): Promise<{
    number: number;
    htmlUrl: string;
    state: 'open' | 'closed';
    merged: boolean;
  } | null> {
    try {
      const { json } = await this.call<RawPullRequest & { merged?: boolean }>(
        token,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`,
        opts,
      );
      return {
        number: json.number,
        htmlUrl: json.html_url,
        state: json.state,
        merged: json.merged === true,
      };
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * List pull requests on a repo. The capability-probe path uses this with
   * `perPage: 1` to determine whether the token can read PRs (and, by
   * extension on classic PATs, whether it can also create them).
   *
   * Caller declares `requiredScopes` to surface a `MissingScopeError` on
   * 403, so the capability probe can recognise the missing-scope case
   * cleanly vs. transient 5xx/network failures.
   */
  async listPullRequests(
    token: string,
    owner: string,
    name: string,
    args: { perPage?: number; state?: 'open' | 'closed' | 'all' } = {},
    opts: CallOptions = {},
  ): Promise<PullRequestSummary[]> {
    const params = new URLSearchParams();
    params.set('per_page', String(args.perPage ?? 30));
    if (args.state) params.set('state', args.state);
    const { json } = await this.call<RawPullRequest[]>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${params.toString()}`,
      {
        ...opts,
        requiredScopes: ['repo', 'pull_request'],
      },
    );
    return json.map((pr) => ({
      number: pr.number,
      htmlUrl: pr.html_url,
      state: pr.state,
      title: pr.title,
    }));
  }

  async createPullRequest(
    token: string,
    owner: string,
    name: string,
    args: { title: string; body: string; head: string; base: string; draft?: boolean },
    opts: CallOptions = {},
  ): Promise<PullRequestSummary> {
    const { json } = await this.call<RawPullRequest>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`,
      {
        ...opts,
        method: 'POST',
        body: {
          title: args.title,
          body: args.body,
          head: args.head,
          base: args.base,
          draft: args.draft ?? false,
        },
        requiredScopes: ['repo', 'pull_request'],
      },
    );
    return {
      number: json.number,
      htmlUrl: json.html_url,
      state: json.state,
      title: json.title,
    };
  }

  // --- low-level call ----------------------------------------------------

  private async call<T>(
    token: string | null,
    path: string,
    opts: CallOptions = {},
  ): Promise<{ json: T; response: Response }> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(opts.signal!.reason);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort(opts.signal.reason);
      else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timeoutHandle = setTimeout(
      () => controller.abort(new Error(`GitHub request timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );

    let response: Response;
    let timedOut = false;
    try {
      response = await this.fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // Distinguish *our* timeout from a network error or a caller-aborted
      // request. AbortError + a non-aborted external signal === our timeout.
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const callerAborted = opts.signal?.aborted ?? false;
      if (isAbort && !callerAborted) {
        timedOut = true;
        throw new TimeoutError(
          `GitHub request timed out after ${this.timeoutMs}ms. The write may have partially landed — refresh before retrying.`,
          this.timeoutMs,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
      if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
      // Silence unused-let warning under strict ts; `timedOut` is a marker
      // for callers reading the catch block to follow the flow.
      void timedOut;
    }

    if (response.ok) {
      // 204 No Content (and 205 Reset Content) carry an empty body —
      // calling .json() on those throws "Unexpected end of JSON input".
      // The caller types the response as `T` so an empty object is the
      // safe sentinel; DELETE-style endpoints either ignore the value
      // or care only about `response.status`.
      if (response.status === 204 || response.status === 205) {
        return { json: {} as T, response };
      }
      const json = (await response.json()) as T;
      return { json, response };
    }

    const errBody = await safeReadJson(response);
    throw classifyError(response, errBody, opts.requiredScopes ?? []);
  }
}

// --- helpers ---------------------------------------------------------------

interface RawUser {
  login: string;
  id: number;
  name?: string | null;
  avatar_url?: string;
}

interface RawRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  visibility?: 'public' | 'private' | 'internal';
  private?: boolean;
  permissions?: { push?: boolean; admin?: boolean };
}

interface RawBranch {
  name: string;
  commit: { sha: string };
}

interface RawRefResponse {
  ref: string;
  object: { sha: string };
}

interface RawCommit {
  sha: string;
  message: string;
  tree: { sha: string };
  parents?: { sha: string }[];
}

interface RawPullRequest {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  title: string;
}

interface RawSearchRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  description?: string | null;
  topics?: string[];
  stargazers_count?: number;
  default_branch?: string;
}

function normalizeMarketplaceRepo(raw: RawSearchRepo): MarketplaceRepo {
  return {
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    description: raw.description ?? '',
    topics: raw.topics ?? [],
    stargazers: raw.stargazers_count ?? 0,
    defaultBranch: raw.default_branch ?? 'main',
  };
}

interface RawFileContents {
  type: string;
  content: string;
  sha: string;
  path: string;
  size: number;
  encoding: string;
}

/**
 * Decode GitHub's base64 file content as UTF-8. Pure — doesn't depend on
 * `Buffer` (we run in browsers + jsdom).
 */
function decodeBase64Utf8(b64: string): string {
  return new TextDecoder('utf-8').decode(decodeBase64Bytes(b64));
}

/**
 * Decode GitHub's base64 file content into raw bytes. Used for binary
 * attachments where UTF-8 decoding would corrupt the data.
 */
function decodeBase64Bytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeRepo(raw: RawRepo): GitHubRepo {
  const visibility: GitHubRepo['visibility'] =
    raw.visibility ?? (raw.private === true ? 'private' : 'public');
  const isPrivate = raw.private ?? visibility !== 'public';
  // `permissions` is only included when the caller is authenticated; absence
  // means we can't push (e.g. listing a public repo through an app token).
  const pushable = raw.permissions?.push === true || raw.permissions?.admin === true;
  return {
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    defaultBranch: raw.default_branch,
    visibility,
    isPrivate,
    pushable,
  };
}

function parseScopes(headers: Headers): ScopeInfo {
  const raw = headers.get('x-oauth-scopes') ?? '';
  const granted = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const acceptedHeader = headers.get('x-accepted-oauth-scopes') ?? '';
  const acceptedRequired = acceptedHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return acceptedRequired.length > 0 ? { granted, acceptedRequired } : { granted };
}

function classifyError(
  response: Response,
  body: unknown,
  callerRequiredScopes: string[],
): GitHubError {
  const message = extractMessage(body) ?? response.statusText;
  const status = response.status;

  if (status === 401) {
    return new UnauthorizedError(message || 'Unauthorized — token rejected', status);
  }

  if (status === 403) {
    // Rate-limited?
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (remaining === '0' && reset) {
      const resetAtMs = Number(reset) * 1000;
      const deltaMs = Math.max(0, resetAtMs - Date.now());
      const totalSeconds = Math.ceil(deltaMs / 1000);
      const human =
        totalSeconds < 60
          ? `${totalSeconds}s`
          : totalSeconds < 3600
            ? `${Math.ceil(totalSeconds / 60)} min`
            : `${Math.ceil(totalSeconds / 3600)} h`;
      return new RateLimitedError(
        `GitHub rate limit reached. Resets in ${human} (at ${new Date(resetAtMs).toISOString()}).`,
        status,
        resetAtMs,
      );
    }
    // Scope-missing?
    const accepted = (response.headers.get('x-accepted-oauth-scopes') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const granted = (response.headers.get('x-oauth-scopes') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const missing =
      accepted.length > 0
        ? accepted.filter((s) => !granted.includes(s))
        : callerRequiredScopes.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      return new MissingScopeError(
        `GitHub denied this action: missing scopes ${missing.join(', ')}.`,
        status,
        missing,
        granted,
      );
    }
  }

  return new GitHubError(message || 'GitHub API call failed', status, body);
}

function extractMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const m = body.message;
    if (typeof m === 'string') return m;
  }
  return null;
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
