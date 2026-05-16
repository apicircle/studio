// Workspace restore (TC-WR-*) — 29 cells covering clone-replay-restore
// round trips. Each cell asserts that a specific entity kind survives
// push → clone → pull intact.
//
// Exercises the GitHub-mock data plane (apps/e2e-mock /_gh/*) for the
// happy-path round-trip; deeper bucket-by-bucket assertions are a
// follow-up.

import { test, expect } from './fixtures/gitFixture';
import { tc } from './fixtures/tcCoverage';
import { tcMapWR } from './fixtures/tcMapWR';

test.describe('Workspace restore', () => {
  test.describe.configure({ mode: 'serial' });

  test(
    tc(tcMapWR['Empty repo init'], 'empty repo init through link → push'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `wr-empty-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await appWithGithubMock.evaluate(
        async ({ o, n }) => {
          interface S {
            connectGitHubSession: (t: string) => Promise<unknown>;
            connectRepo: (o: string, n: string) => Promise<unknown>;
            createWorkingBranch: () => Promise<unknown>;
            pushWorkspace: () => Promise<{ commitSha: string }>;
          }
          const w = window as unknown as { __apicircleStore?: { getState: () => S } };
          const s = w.__apicircleStore!.getState();
          await s.connectGitHubSession('ghp_mock_test_token');
          await s.connectRepo(o, n);
          await s.createWorkingBranch();
          await s.pushWorkspace();
        },
        { o: owner, n: name },
      );
      const inspected = await mockGithub.inspectRepo(owner, name);
      expect(inspected?.refs).toBeTruthy();
    },
  );

  for (const [key, tcId] of Object.entries(tcMapWR)) {
    if (key === 'Empty repo init') continue;
    test.fixme(tc(tcId, key), async () => {
      // Each round-trip cell needs:
      //   1. Seed a workspace with the entity kind under test.
      //   2. Push to mock repo.
      //   3. Clone-replay into a second context via the workspaceStore's
      //      "Restore from repo" flow.
      //   4. Assert the entity round-trips with the same shape.
      // The mock data plane is in place; the per-entity seed + post-
      // restore inspection is the follow-up work.
    });
  }
});
