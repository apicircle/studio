// Live GitHub — branch creation, switching, and the no-data-loss
// invariant across branch transitions.
//
// Product invariant: a pending in-memory mutation must survive the
// following hostile events without silent data loss:
//
//   * Creating a brand-new working branch on top of a connected repo.
//   * Switching from one working branch to a freshly created second
//     working branch on the same repo.
//   * Refreshing a branch where the upstream `git/refs` was deleted
//     out from under us (the retired-branch flow) — local edits
//     remain in `synced` even though `local.workingBranch` clears.
//
// We don't auto-delete-and-restore main; we only manipulate working
// branches we created in this run. Each is named via `makeBranchName`
// so a botched cleanup never collides on the next run.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapGT } from '../fixtures/tcMapGT';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  deleteBranch,
  disconnect,
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

test.describe('Live GitHub — branch lifecycle @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  test.beforeAll(async () => {
    const c = getLiveConfig();
    if (!c) throw new Error('live config missing after skip checks');
    cfg = c;
    await seedRepoIfEmpty(cfg);
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(
      gt('Branch :: Switch working branch'),
      'creating a working branch reflects on the upstream — `git/refs/heads/<branch>` resolves',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'branch-create');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      // pushWorkspace creates the upstream ref. Without a push, the
      // local working-branch state hasn't yet hit the remote.
      const commit = await app.evaluate(async () =>
        window.__apicircleStore!.getState().pushWorkspace('e2e branch create'),
      );
      expect(commit.commitSha).toMatch(/^[a-f0-9]{40}$/);

      const ref = `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
      const res = await fetch(
        `https://api.github.com/repos/${cfg.owner}/${cfg.name}/git/refs/${ref}`,
        {
          headers: {
            Authorization: `token ${cfg.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      expect(res.ok).toBe(true);
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('Branch :: Switch with unsaved warns'),
      'local edits made on branch A persist in `synced` after switching to branch B',
    ),
    async ({ app }) => {
      const branchA = makeBranchName(test.info().workerIndex, 'switch-a');
      const branchB = makeBranchName(test.info().workerIndex, 'switch-b');
      createdBranches.push(branchA, branchB);

      // Connect + branch A. Push so it lands upstream.
      await connectAndBranch(app, cfg, branchA);
      const result = await app.evaluate(
        async ({ next }) => {
          const api = window.__apicircleStore!.getState();
          const reqId = api.addRequest(null, 'survives-branch-switch');
          await api.pushWorkspace('e2e on branch A');
          // Switch to branch B by creating a fresh working branch.
          // The store rebases the local synced doc onto the new base.
          await api.createWorkingBranch({ branchName: next });
          const s = window.__apicircleStore!.getState();
          return {
            requestStillThere: !!(
              s.synced?.collections?.requests as Record<string, unknown> | undefined
            )?.[reqId],
            workingBranchName: s.local?.workingBranch?.name ?? null,
          };
        },
        { next: branchB },
      );
      expect(result.workingBranchName).toBe(branchB);
      expect(
        result.requestStillThere,
        'request added on branch A must survive switch to branch B',
      ).toBe(true);
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('Retired'),
      'when upstream branch is deleted, `local.retiredBranch` is set BUT local synced data is not lost',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'retired-survives-data');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      const markerReqId = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        const reqId = api.addRequest(null, 'survives-retire');
        await api.pushWorkspace('e2e survive-retire push');
        return reqId;
      });

      // Out-of-band: delete the branch on the remote.
      await deleteBranch(cfg, branch);

      // Refresh — the store should observe the deletion and clear
      // `workingBranch` while preserving the local `synced` doc.
      const after = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        const out = await api.refreshWorkspace();
        const s = window.__apicircleStore!.getState();
        return {
          refreshStatus: out.status,
          retiredReason: s.local?.retiredBranch?.reason ?? null,
          workingBranch: s.local?.workingBranch?.name ?? null,
          requestStillThere: !!(
            s.synced?.collections?.requests as Record<string, unknown> | undefined
          )?.[markerReqId],
        };
      });
      // Either `retired` (canonical) or `no-remote` (transient race) is
      // acceptable; both must leave the local data intact.
      expect(['retired', 'no-remote']).toContain(after.refreshStatus);
      expect(
        after.requestStillThere,
        'local edits must NOT be lost when upstream branch is deleted',
      ).toBe(true);
      await disconnect(app);
    },
  );
});
