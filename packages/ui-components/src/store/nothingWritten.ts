// A failure that happened BEFORE the operation wrote anything.
//
// `formatGitError` decides the "the write may have partially landed — refresh
// before retrying" warning from the error alone, and for a 5xx it has to assume
// the worst: a 502 out of `createCommit` really might have left an orphan commit
// on the remote. But the SAME 502 out of a pre-flight read means nothing was
// written at all, and telling the user to refresh-before-retry there is worse
// than unhelpful — it steers them away from the one action that is actually
// safe, which is simply pushing again.
//
// A status code cannot tell those apart. The call site can: it knows whether the
// operation had written anything yet. So the reads that provably precede the
// first write say so, and the formatter believes them instead of guessing.

/** Wraps the real failure, asserting the operation had not written anything yet. */
export class NothingWrittenError extends Error {
  constructor(readonly underlying: unknown) {
    super(underlying instanceof Error ? underlying.message : String(underlying));
    this.name = 'NothingWrittenError';
  }
}

/**
 * Run a read that happens before the operation's first write; on failure, mark
 * it as such. An already-marked failure passes through unchanged, so nesting
 * these cannot turn one assertion into a different one.
 */
export async function beforeAnyWrite<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    throw err instanceof NothingWrittenError ? err : new NothingWrittenError(err);
  }
}
