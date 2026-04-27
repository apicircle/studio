// Tiny GitHub REST client. We avoid pulling in @octokit/* because we only
// need a handful of endpoints and the typed errors are more important than
// the breadth of coverage.
//
// Token-handling rule: the caller passes the PAT per call. The client never
// logs it, never stores it, never includes it in error messages. The host
// (ui-components) is responsible for token storage (Secret Vault).

import { GitHubError, MissingScopeError, RateLimitedError, UnauthorizedError } from './errors';

const API_BASE = 'https://api.github.com';

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

export interface GitHubClientOptions {
  /** Override the API base URL (e.g. GitHub Enterprise). */
  baseUrl?: string;
  /** Inject a custom fetch — used by tests to mock without msw. */
  fetchImpl?: typeof fetch;
  /** Hard timeout per call. Defaults to 15s. */
  timeoutMs?: number;
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
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: GitHubClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? API_BASE;
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

  // --- low-level call ----------------------------------------------------

  private async call<T>(
    token: string,
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
    try {
      response = await this.fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${token}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
      if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
    }

    if (response.ok) {
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
      return new RateLimitedError(
        `GitHub rate limit reached. Resets at ${new Date(resetAtMs).toISOString()}.`,
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
