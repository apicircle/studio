// Typed errors for the GitHub REST client. Catching these in the UI lets us
// drive the right recovery path: scope-missing → "Update token now?" modal,
// rate-limited → "wait N seconds" copy, network → "check your connection,"
// unknown 5xx → generic.

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class MissingScopeError extends GitHubError {
  /** Scope strings the API said are missing, e.g. ['pull_request']. */
  readonly missingScopes: string[];
  /** Scope strings the token currently grants, parsed from x-oauth-scopes. */
  readonly grantedScopes: string[];

  constructor(message: string, status: number, missingScopes: string[], grantedScopes: string[]) {
    super(message, status);
    this.name = 'MissingScopeError';
    this.missingScopes = missingScopes;
    this.grantedScopes = grantedScopes;
  }
}

export class RateLimitedError extends GitHubError {
  /** Unix timestamp (ms) when the rate-limit window resets. */
  readonly resetAtMs: number;
  constructor(message: string, status: number, resetAtMs: number) {
    super(message, status);
    this.name = 'RateLimitedError';
    this.resetAtMs = resetAtMs;
  }
}

export class UnauthorizedError extends GitHubError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = 'UnauthorizedError';
  }
}

/**
 * The fetch was aborted by our own timeout (default 15 s). Surfaced with
 * status 0 because there was no HTTP response. Distinct from a generic
 * `GitHubError(0)` so the UI can render retry-able copy and warn the user
 * that a write may have partially landed on the server.
 */
export class TimeoutError extends GitHubError {
  /** Timeout that fired, in ms. Useful for the UI message. */
  readonly timeoutMs: number;
  constructor(message: string, timeoutMs: number) {
    super(message, 0);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Remote ref moved since we last synced — e.g. someone force-pushed the
 * branch. Thrown by `pushWorkspace` *before* uploading blobs, so the user
 * is steered to refresh first rather than discovering the divergence
 * inside a failed `updateRef`.
 */
export class BranchDivergedError extends GitHubError {
  readonly expectedSha: string;
  readonly actualSha: string;
  constructor(message: string, expectedSha: string, actualSha: string) {
    super(message, 0);
    this.name = 'BranchDivergedError';
    this.expectedSha = expectedSha;
    this.actualSha = actualSha;
  }
}
