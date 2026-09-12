import { describe, expect, it } from 'vitest';
import { GitHubError } from '@apicircle/git';
import { NothingWrittenError, beforeAnyWrite } from './nothingWritten';

describe('beforeAnyWrite', () => {
  it('returns the read’s value untouched when it succeeds', async () => {
    await expect(beforeAnyWrite(async () => ({ sha: 'abc' }))).resolves.toEqual({ sha: 'abc' });
  });

  it('marks a failure as "nothing was written", keeping the original error reachable', async () => {
    const cause = new GitHubError('Server Error', 502);

    const err = await beforeAnyWrite(() => Promise.reject(cause)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NothingWrittenError);
    expect((err as NothingWrittenError).underlying).toBe(cause);
    // The message survives, so a caller that only logs still says something useful.
    expect((err as Error).message).toBe('Server Error');
  });

  it('does not re-wrap an already-marked failure', async () => {
    const inner = new NothingWrittenError(new GitHubError('Server Error', 502));

    const err = await beforeAnyWrite(() => Promise.reject(inner)).catch((e: unknown) => e);

    expect(err).toBe(inner);
    expect((err as NothingWrittenError).underlying).toBeInstanceOf(GitHubError);
  });

  it('carries a non-Error rejection through as its string form', async () => {
    // Rejecting with a non-Error is precisely the branch under test: a provider, or a stray
    // `throw 'x'`, can reject with anything, and the wrapper must still carry a readable message
    // rather than "[object Object]" or an empty one.
    const rejectWith = (value: unknown) =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject(value);
    const err = await beforeAnyWrite(() => rejectWith('boom')).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NothingWrittenError);
    expect((err as Error).message).toBe('boom');
    expect((err as NothingWrittenError).underlying).toBe('boom');
  });
});
