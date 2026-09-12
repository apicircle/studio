import { describe, expect, it } from 'vitest';
import {
  BranchDivergedError,
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  TimeoutError,
  UnauthorizedError,
} from '@apicircle/git';
import { NothingWrittenError } from '../../store/nothingWritten';
import { formatGitError } from './gitErrorMessage';

describe('formatGitError', () => {
  it('routes a diverged branch to Refresh first, and claims no partial write', () => {
    const view = formatGitError(new BranchDivergedError('moved', 'sha-a', 'sha-b'), 'Push');

    expect(view.action).toEqual({ kind: 'refresh-first' });
    expect(view.partialWrite).toBe(false);
  });

  it('warns about a partial write on a timeout, which can fire mid-write', () => {
    const view = formatGitError(new TimeoutError('timed out', 15000), 'Push');

    expect(view.message).toContain('15000ms');
    expect(view.partialWrite).toBe(true);
  });

  it('asks for the missing scopes by name', () => {
    const view = formatGitError(
      new MissingScopeError('needs more', 403, ['pull_request'], ['repo']),
      'Push',
    );

    expect(view.action).toEqual({ kind: 'request-scopes', missingScopes: ['pull_request'] });
    expect(view.partialWrite).toBe(false);
  });

  it('routes a rejected token to reconnect', () => {
    const view = formatGitError(new UnauthorizedError('bad token', 401), 'Push');

    expect(view.action).toEqual({ kind: 'reconnect-token' });
  });

  it('carries the rate-limit reset time through', () => {
    const view = formatGitError(new RateLimitedError('slow down', 403, 1_700_000_000_000), 'Push');

    expect(view.action).toEqual({ kind: 'wait-and-retry', resetAtMs: 1_700_000_000_000 });
  });

  it('assumes a 5xx MIGHT have landed, because from the error alone it might have', () => {
    const view = formatGitError(new GitHubError('Server Error', 502), 'Push');

    expect(view.message).toBe('GitHub 502: Server Error');
    expect(view.partialWrite).toBe(true);
  });

  it('does not warn about a partial write on a 4xx', () => {
    const view = formatGitError(new GitHubError('Not Found', 404), 'Push');

    expect(view.partialWrite).toBe(false);
  });

  it('falls back to the message of a plain Error, then to a generic line', () => {
    expect(formatGitError(new Error('something broke'), 'Push').message).toBe('something broke');
    expect(formatGitError('not an error at all', 'Push').message).toBe(
      'Push failed — unknown error',
    );
  });

  // The pair that matters: the SAME underlying 5xx, with and without the
  // call site's assertion that nothing had been written yet.
  it('drops the partial-write warning when the call site proved nothing was written', () => {
    const cause = new GitHubError('Server Error', 502);

    const guessed = formatGitError(cause, 'Push');
    const known = formatGitError(new NothingWrittenError(cause), 'Push');

    expect(guessed.partialWrite).toBe(true);
    expect(known.partialWrite).toBe(false);
    // Everything else about the failure survives the unwrapping.
    expect(known.message).toBe(guessed.message);
    expect(known.action).toEqual(guessed.action);
  });

  it('keeps the underlying error’s own CTA when nothing was written', () => {
    const view = formatGitError(
      new NothingWrittenError(new UnauthorizedError('bad token', 401)),
      'Push',
    );

    expect(view.action).toEqual({ kind: 'reconnect-token' });
    expect(view.partialWrite).toBe(false);
  });
});
