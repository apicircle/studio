// Live GitHub — empty-repo bootstrap coverage.
//
// Workflow expectation: an APICircle user (or a CI pipeline) can point
// the workspace at a freshly-created, completely-empty GitHub repository
// and start working — no out-of-band UI clicks to commit an initial
// README, no manual workspace.json seed. The suite owns that bootstrap
// via the helpers in `./_helpers.ts`. The tests below pin the bootstrap
// behavior in place so a future regression to those helpers (or to the
// GitHub Contents API surface they depend on) gets caught here, not by
// a confusing "Branch not found" failure four specs later.
//
// Coverage:
//   * Detect an empty repo (default branch resolvable, but no HEAD SHA).
//   * Seed README → default branch now has a HEAD.
//   * Seeding is idempotent on a non-empty repo.
//   * Seed workspace.json → linkPrivateWorkspace precondition met.
//   * Seeding workspace.json is idempotent.
//   * Connect-and-branch succeeds on the now-seeded sandbox without
//     any prior manual setup — proves the end-to-end bootstrap path.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapGT } from '../fixtures/tcMapGT';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  deleteBranch,
  disconnect,
  ensureWorkspaceJsonOnMain,
  getDefaultBranchHead,
  getLiveConfig,
  liveSkipReason,
  makeBranchName,
  seedRepoIfEmpty,
} from './_helpers';

function gt(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

test.describe('Live GitHub — empty-repo bootstrap @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  test.beforeAll(() => {
    const c = getLiveConfig();
    if (!c) throw new Error('live config missing after skip checks');
    cfg = c;
    // Intentionally NO seed here — the tests below exercise the seeder
    // explicitly. The other specs' beforeAll hooks call `seedRepoIfEmpty`
    // for their own setup; running this spec first or last doesn't matter
    // because the helper is idempotent.
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Link to private repo with personal token'),
      'getDefaultBranchHead resolves the default branch name on any accessible sandbox repo',
    ),
    async () => {
      const head = await getDefaultBranchHead(cfg);
      expect(head.name.length).toBeGreaterThan(0);
      // sha is either a 40-hex string (already seeded) or null (empty).
      if (head.sha !== null) {
        expect(head.sha).toMatch(/^[a-f0-9]{40}$/);
      }
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Link to private repo with personal token'),
      'seedRepoIfEmpty creates the first commit on an empty repo and is a no-op afterwards',
    ),
    async () => {
      // First call: seeds if empty, returns the resulting head.
      const first = await seedRepoIfEmpty(cfg);
      expect(
        first.sha,
        'after seedRepoIfEmpty the default branch must have a HEAD SHA',
      ).not.toBeNull();
      expect(first.sha).toMatch(/^[a-f0-9]{40}$/);

      // Second call: same SHA — idempotent.
      const second = await seedRepoIfEmpty(cfg);
      expect(second.sha).toBe(first.sha);
      expect(second.name).toBe(first.name);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Link to private repo with personal token'),
      'ensureWorkspaceJsonOnMain seeds workspace.json when absent and is idempotent when present',
    ),
    async () => {
      const head = await seedRepoIfEmpty(cfg); // pre-req: branch exists
      // First call: creates workspace.json if missing.
      await ensureWorkspaceJsonOnMain(cfg, head.name);
      const probe1 = await fetch(
        `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/workspace.json?ref=${encodeURIComponent(head.name)}`,
        {
          headers: {
            Authorization: `token ${cfg.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      expect(
        probe1.ok,
        'workspace.json must exist on the default branch after ensureWorkspaceJsonOnMain',
      ).toBe(true);
      const body1 = (await probe1.json()) as { content: string; sha: string };
      expect(body1.sha.length).toBeGreaterThan(0);

      // Second call: no new commit — the existing file's SHA is unchanged.
      await ensureWorkspaceJsonOnMain(cfg, head.name);
      const probe2 = await fetch(
        `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/workspace.json?ref=${encodeURIComponent(head.name)}`,
        {
          headers: {
            Authorization: `token ${cfg.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      expect(probe2.ok).toBe(true);
      const body2 = (await probe2.json()) as { sha: string };
      expect(body2.sha).toBe(body1.sha);
    },
  );

  test(
    tc(
      gt('Push'),
      'after bootstrap, connect-and-branch + push succeeds end-to-end on the seeded sandbox',
    ),
    async ({ app }) => {
      await seedRepoIfEmpty(cfg); // guarantee a HEAD
      const branch = makeBranchName(test.info().workerIndex, 'bootstrap-roundtrip');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      const { commitSha } = await app.evaluate(async () =>
        window.__apicircleStore!.getState().pushWorkspace('e2e post-bootstrap roundtrip'),
      );
      expect(commitSha).toMatch(/^[a-f0-9]{40}$/);
      await disconnect(app);
    },
  );
});
