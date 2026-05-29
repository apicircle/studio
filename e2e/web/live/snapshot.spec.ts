// Live GitHub — snapshot capture survives a push round-trip.
//
// `captureSnapshot` stores an entry in `local.snapshots.entries`.
// Snapshots are LOCAL-only (per `WorkspaceLocal`), so they don't
// land in the pushed `workspace.json`. The product invariant we
// assert is the LOCAL one:
//
//   * After CRUD + `captureSnapshot`, the snapshot id exists in
//     `local.snapshots.entries`.
//   * After a subsequent push, the snapshot is still present and
//     `restoreSnapshot(id)` returns true.
//
// This is a live-github spec (not an offline one) because the
// snapshot path used to silently break under the "push-replaces-
// the-sync-snapshot" code path — verifying it against a real push
// is the relevant regression guard.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapHS } from '../fixtures/tcMapHS';
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

function hs(key: string): TcId {
  const v = tcMapHS[key];
  if (!v) throw new Error(`No TC-HS entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

test.describe('Live GitHub — snapshot survives push @live-github', () => {
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

  // The HS workbook covers history snapshots. The "Persistence" key
  // is the load-bearing cell — a snapshot must persist across the
  // events that would otherwise corrupt it.
  const persistenceKey = Object.keys(tcMapHS).find((k) => k.toLowerCase().includes('persist'));
  const snapshotKey = persistenceKey ?? Object.keys(tcMapHS)[0];

  test(
    tc(
      hs(snapshotKey),
      'captureSnapshot after CRUD is present in local.snapshots.entries — and survives a subsequent push',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'snapshot');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);

      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        api.addRequest(null, 'snapshot-marker');
        const id = api.captureSnapshot({ trigger: 'manual', note: 'e2e snapshot' });
        const before = window.__apicircleStore!.getState();
        const beforeIds = (before.local?.snapshots?.entries ?? []).map((s) => s.id);
        await api.pushWorkspace('e2e snapshot push');
        const after = window.__apicircleStore!.getState();
        const afterIds = (after.local?.snapshots?.entries ?? []).map((s) => s.id);
        const restored = id ? api.restoreSnapshot(id) : false;
        return {
          id,
          beforePresent: id !== null && beforeIds.includes(id),
          afterPresent: id !== null && afterIds.includes(id),
          restored,
        };
      });

      expect(result.id, 'captureSnapshot must return a snapshot id').not.toBeNull();
      expect(
        result.beforePresent,
        'snapshot must be present in local.snapshots.entries immediately after capture',
      ).toBe(true);
      expect(
        result.afterPresent,
        'snapshot must STILL be present in local.snapshots.entries after a push',
      ).toBe(true);
      expect(result.restored, 'restoreSnapshot(id) must return true').toBe(true);
      await disconnect(app);
    },
  );
});
