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
