import { expect, test } from '../fixtures/app';
import {
  connectAndBranchV2,
  createV2HostRepo,
  createV2Tracker,
  fetchWorkspaceJson,
  getV2BotConfig,
  makeV2BranchName,
  mergePullRequest,
  v2SkipReason,
} from './_helpers';

test.describe('Live GitHub - branch and workspace transitions @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('multiple branch pushes, PR merges, workspace switches, and restore-from-main retain data', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'branch-workspace-transitions');
    const branchA = makeV2BranchName(test.info().workerIndex, 'transition-a');
    const branchB = makeV2BranchName(test.info().workerIndex, 'transition-b');
    const branchC = makeV2BranchName(test.info().workerIndex, 'transition-c');
    await connectAndBranchV2(app, host, branchA, tracker);

    const first = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      const requestId = api.addRequest(null, 'v2 transition request A');
      api.addEnvironment('v2-transition-env-a');
      await api.pushWorkspace('e2e live: transition A');
      const pr = await api.createPullRequest({
        title: 'e2e v2 transition A',
        body: 'first transition merge',
      });
      const state = window.__apicircleStore!.getState() as any;
      return { requestId, prNumber: pr.number, workspaceId: state.synced.workspaceId };
    });
    const mergeA = await mergePullRequest(host, first.prNumber, {
      method: 'squash',
      commitTitle: 'e2e v2 transition A',
    });
    expect(mergeA.merged).toBe(true);

    const afterMergeA = await app.evaluate(
      async ({ branchName }) => {
        const api = window.__apicircleStore!.getState() as any;
        const retired = await api.refreshWorkspace();
        const created = await api.createWorkingBranch({ branchName });
        const refresh = await api.refreshWorkspace();
        const requestId = api.addRequest(null, 'v2 transition request B');
        api.addEnvironment('v2-transition-env-b');
        await api.pushWorkspace('e2e live: transition B');
        const pr = await api.createPullRequest({
          title: 'e2e v2 transition B',
          body: 'second transition merge',
        });
        const state = window.__apicircleStore!.getState() as any;
        return {
          retiredStatus: retired.status,
          retiredReason: retired.retired?.reason ?? state.local.retiredBranch?.reason ?? null,
          branchName: created.name,
          refreshStatus: refresh.status,
          requestId,
          prNumber: pr.number,
          requests: Object.values(state.synced.collections.requests).map((r: any) => r.name),
        };
      },
      { branchName: branchB },
    );
    tracker.trackBranch(host, branchB);
    expect(afterMergeA.retiredStatus).toBe('retired');
    expect(afterMergeA.retiredReason).toBe('pr-merged');
    expect(afterMergeA.branchName).toBe(branchB);
    expect(['up-to-date', 'merged']).toContain(afterMergeA.refreshStatus);
    expect(afterMergeA.requests).toContain('v2 transition request A');

    const mergeB = await mergePullRequest(host, afterMergeA.prNumber, {
      method: 'merge',
      commitTitle: 'e2e v2 transition B',
    });
    expect(mergeB.merged).toBe(true);

    const main = (await fetchWorkspaceJson(host, 'main')).json as Record<string, any>;
    const mainRequestNames = Object.values(main.collections.requests).map((r: any) => r.name);
    expect(mainRequestNames).toContain('v2 transition request A');
    expect(mainRequestNames).toContain('v2 transition request B');

    const fresh = await app.evaluate(
      async ({ token, owner, name, branchName, originalWorkspaceId }) => {
        const api = window.__apicircleStore!.getState() as any;
        const freshId = await api.createNewWorkspace('v2 transition fresh workspace');
        await api.connectGitHubSession(token);
        await api.connectRepo(owner, name);
        await api.createWorkingBranch({ branchName });
        let refresh = await api.refreshWorkspace();
        if (refresh.status === 'conflicts') {
          const pending = (window.__apicircleStore!.getState() as any).pendingRefresh;
          const resolutions: Record<string, 'theirs'> = {};
          for (const entry of pending.diff.conflicts)
            resolutions[`${entry.bucket}:${entry.key}`] = 'theirs';
          await api.commitRefresh(resolutions);
          refresh = { status: 'conflicts-applied' };
        }
        const afterPull = window.__apicircleStore!.getState() as any;
        const adoptedFreshId = afterPull.synced.workspaceId;
        const snapshotId = afterPull.local.snapshots.entries[0]?.id ?? null;
        const namesAfterPull = Object.values(afterPull.synced.collections.requests).map(
          (r: any) => r.name,
        );

        const restoreOk = snapshotId ? api.restoreSnapshot(snapshotId) : false;
        const afterRestore = window.__apicircleStore!.getState() as any;
        const namesAfterRestore = Object.values(afterRestore.synced.collections.requests).map(
          (r: any) => r.name,
        );
        let secondRefresh = await api.refreshWorkspace();
        if (secondRefresh.status === 'conflicts') {
          const pending = (window.__apicircleStore!.getState() as any).pendingRefresh;
          const resolutions: Record<string, 'theirs'> = {};
          for (const entry of pending.diff.conflicts)
            resolutions[`${entry.bucket}:${entry.key}`] = 'theirs';
          await api.commitRefresh(resolutions);
          secondRefresh = { status: 'conflicts-applied' };
        }
        const afterRePull = window.__apicircleStore!.getState() as any;
        const namesAfterRePull = Object.values(afterRePull.synced.collections.requests).map(
          (r: any) => r.name,
        );

        await api.switchWorkspace(originalWorkspaceId);
        const original = window.__apicircleStore!.getState() as any;
        const originalNames = Object.values(original.synced.collections.requests).map(
          (r: any) => r.name,
        );
        await api.switchWorkspace(adoptedFreshId);
        const switchedBack = window.__apicircleStore!.getState() as any;
        const freshNames = Object.values(switchedBack.synced.collections.requests).map(
          (r: any) => r.name,
        );
        return {
          freshId,
          refreshStatus: refresh.status,
          snapshotId,
          restoreOk,
          namesAfterPull,
          namesAfterRestore,
          secondRefreshStatus: secondRefresh.status,
          namesAfterRePull,
          originalNames,
          freshNames,
          localBranch: switchedBack.local.workingBranch?.name ?? null,
        };
      },
      {
        token: bot.token,
        owner: host.owner,
        name: host.name,
        branchName: branchC,
        originalWorkspaceId: first.workspaceId,
      },
    );
    tracker.trackBranch(host, branchC);

    expect(fresh.localBranch).toBe(branchC);
    expect(fresh.namesAfterPull).toContain('v2 transition request A');
    expect(fresh.namesAfterPull).toContain('v2 transition request B');
    expect(fresh.snapshotId).toBeTruthy();
    expect(fresh.restoreOk).toBe(true);
    expect(fresh.namesAfterRestore).not.toContain('v2 transition request B');
    expect(fresh.namesAfterRePull).toContain('v2 transition request A');
    expect(fresh.namesAfterRePull).toContain('v2 transition request B');
    expect(fresh.originalNames).toContain('v2 transition request A');
    expect(fresh.originalNames).toContain('v2 transition request B');
    expect(fresh.freshNames).toContain('v2 transition request A');
    expect(fresh.freshNames).toContain('v2 transition request B');
  });
});
