// Typed git-error → human-readable message + recovery action. Used by
// every push / pull / sync / PR handler in WorkspacePanel so the user
// sees a consistent CTA per error kind. Returning a structured result
// (not just a string) lets the panel render typed CTAs — e.g. "Refresh
// first" link for BranchDivergedError, "Reconnect token" for 401.

import {
  BranchDivergedError,
  GIT_HOST_LABELS,
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  TimeoutError,
  UnauthorizedError,
  type GitHostKind,
} from '@apicircle/git';
import { NothingWrittenError } from '../../store/nothingWritten';

export type GitErrorAction =
  | { kind: 'none' }
  | { kind: 'refresh-first' }
  | { kind: 'reconnect-token' }
  | { kind: 'wait-and-retry'; resetAtMs: number }
  | { kind: 'request-scopes'; missingScopes: string[] };

export interface GitErrorView {
  /** One-line message shown to the user. */
  message: string;
  /** What the UI should let the user do about it. */
  action: GitErrorAction;
  /** When true, the failure may have left server-side artifacts (orphan commits) — recommend refresh before retry. */
  partialWrite: boolean;
}

/**
 * `host` is the host the failed call went to. Every host's client throws these
 * same error classes (`GitHubError` is only named after the first of them), so
 * the error cannot say whose answer it was and the caller, which knows the
 * repo's host, has to. It defaults to GitHub, the one host Studio registers.
 */
export function formatGitError(
  err: unknown,
  opName: string,
  host: GitHostKind = 'github',
): GitErrorView {
  const hostLabel = GIT_HOST_LABELS[host];
  if (err instanceof NothingWrittenError) {
    // The call site proved the operation had not written anything yet, so the
    // partial-write warning would be false however bad the underlying error is
    // -- and it would send the user to Refresh when a retry is the safe act.
    // Everything else about the failure still holds: a 401 still asks for a
    // reconnect, a rate limit still says when to come back.
    return { ...formatGitError(err.underlying, opName, host), partialWrite: false };
  }
  if (err instanceof BranchDivergedError) {
    return {
      message:
        `Remote branch has moved since your last sync. ` +
        `Refresh first to see what changed, then ${opName.toLowerCase()} again.`,
      action: { kind: 'refresh-first' },
      partialWrite: false, // pre-flight catches it before any write
    };
  }
  if (err instanceof TimeoutError) {
    return {
      message:
        `${opName} timed out after ${err.timeoutMs}ms. ` +
        `Your network may be slow, or the write partially landed — refresh to check before retrying.`,
      action: { kind: 'none' },
      partialWrite: true,
    };
  }
  if (err instanceof MissingScopeError) {
    return {
      message: err.message,
      action: { kind: 'request-scopes', missingScopes: err.missingScopes },
      partialWrite: false,
    };
  }
  if (err instanceof UnauthorizedError) {
    return {
      message:
        `${hostLabel} rejected the token. It may have been revoked, expired, or had its scopes changed. ` +
        'Reconnect your session to continue.',
      action: { kind: 'reconnect-token' },
      partialWrite: false,
    };
  }
  if (err instanceof RateLimitedError) {
    return {
      message: err.message,
      action: { kind: 'wait-and-retry', resetAtMs: err.resetAtMs },
      partialWrite: false,
    };
  }
  if (err instanceof GitHubError) {
    return {
      message: `${hostLabel} ${err.status}: ${err.message}`,
      action: { kind: 'none' },
      // 5xx writes might have partially landed; 4xx writes other than 401 are usually rejection upfront.
      partialWrite: err.status >= 500,
    };
  }
  if (err instanceof Error) {
    return { message: err.message, action: { kind: 'none' }, partialWrite: false };
  }
  return {
    message: `${opName} failed — unknown error`,
    action: { kind: 'none' },
    partialWrite: false,
  };
}
