// Git conflict matrix (TC-GC-*) — 172 cells covering conflict-shape ×
// resolution-choice combinations. Each cell discriminates on:
//   - Entity kind (request, env var, mock, plan, etc.)
//   - Conflict shape (both modified, deleted vs modified, etc.)
//   - Resolution choice (take theirs, take ours, merge, abort)
//
// The mock GitHub server's data plane (apps/e2e-mock /_gh/*) supports
// the underlying push/pull, but the conflict-injection helper that
// produces deterministic conflicts in the mock state is a follow-up.
// Tracked as the second half of S4.

import { test } from './fixtures/gitFixture';
import { tc } from './fixtures/tcCoverage';
import { tcMapGC } from './fixtures/tcMapGC';

test.describe('Git conflict matrix', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const [key, tcId] of Object.entries(tcMapGC)) {
    test.fixme(tc(tcId, key), async () => {
      // Needs the conflict-injection helper: a control-plane endpoint
      // on apps/e2e-mock that mutates a path on the remote branch under
      // the test's feet, so the next push/pull surfaces a conflict.
      // Together with a per-bucket conflict-resolution UI walk, this
      // unblocks the full matrix.
    });
  }
});
