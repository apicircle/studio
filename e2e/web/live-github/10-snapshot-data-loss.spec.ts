import { expect, test } from '../fixtures/app';
import {
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  fetchWorkspaceJson,
  getV2BotConfig,
  makeV2BranchName,
  updateWorkspaceJson,
  v2SkipReason,
} from './_helpers';

const SNAPSHOT_BEARER = 'V2_SNAPSHOT_BEARER_SHOULD_RESTORE';

test.describe('Live GitHub - snapshots and data-loss guards @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('pre-push/pre-merge snapshots restore linked and core state; failure paths keep synced byte-identical', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'snapshot-host');
    const source = await createV2SourceRepo(tracker, bot, 'snapshot-source', 'private');
    const branch = makeV2BranchName(test.info().workerIndex, 'snapshot');
    await connectAndBranchV2(app, host, branch, tracker);

    const setup = await app.evaluate(
      async ({ repoFullName, sourceBranch, bearerToken }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const requestId = api.addRequest(null, 'v2 snapshot request');
        api.setRequestUrl(requestId, 'https://v2.example.test/snapshot');
        api.setRequestAuth(requestId, { type: 'bearer', token: bearerToken });
        api.addEnvironment('v2-snapshot-env');
        api.setVariables('v2-snapshot-env', [
          { key: 'BASE_URL', value: 'https://v2.example.test', encrypted: false },
        ]);
        const planId = api.addPlan('v2 snapshot plan');
        api.addPlanStep(planId, requestId);
        const mockId = api.createMockServer({
          name: 'v2 snapshot mock',
          source: { kind: 'manual', endpoints: [] },
        });
        await api.pushWorkspace('e2e live: snapshot baseline');
        const state = window.__apicircleStore!.getState() as any;
        return {
          linkId: link.id,
          requestId,
          planId,
          mockId,
          pushedSnapshot: state.local.snapshots.entries[0]?.id ?? null,
        };
      },
      {
        repoFullName: source.cfg.fullName,
        sourceBranch: source.branch,
        bearerToken: SNAPSHOT_BEARER,
      },
    );
    expect(setup.pushedSnapshot).toBeTruthy();
    const remote = (await fetchWorkspaceJson(host, branch)).json as Record<string, any>;
    expect(remote.collections.requests[setup.requestId].auth.token).toBe('');

    await updateWorkspaceJson(host, branch, 'e2e live: remote snapshot merge', (ws) => {
      const typed = ws as Record<string, any>;
      typed.linkedWorkspaces[setup.linkId].name = 'snapshot remote link name';
    });

    const merge = await app.evaluate(async ({ linkId }) => {
      const api = window.__apicircleStore!.getState() as any;
      api.addRequest(null, 'v2 local before merge');
      const refresh = await api.refreshWorkspace();
      if (refresh.status !== 'merged') throw new Error(`expected merged, got ${refresh.status}`);
      const state = window.__apicircleStore!.getState() as any;
      return {
        name: state.synced.linkedWorkspaces[linkId].name,
        preMergeSnapshot: state.local.snapshots.entries[0]?.id ?? null,
        preMergeTrigger: state.local.snapshots.entries[0]?.triggeredBy ?? null,
      };
    }, setup);
    expect(merge.name).toBe('snapshot remote link name');
    expect(merge.preMergeSnapshot).toBeTruthy();
    expect(merge.preMergeTrigger).toBe('pre-merge');

    const restored = await app.evaluate(
      async ({ snapshotId, requestId, planId, mockId, linkId }) => {
        const api = window.__apicircleStore!.getState() as any;
        const ok = api.restoreSnapshot(snapshotId);
        const state = window.__apicircleStore!.getState() as any;
        return {
          ok,
          request: !!state.synced.collections.requests[requestId],
          requestAuthToken: state.synced.collections.requests[requestId]?.auth?.token ?? null,
          plan: !!state.synced.executionPlans[planId],
          mock: !!state.synced.mockServers[mockId],
          link: !!state.synced.linkedWorkspaces[linkId],
          linkedCache: !!state.local.linkedCollections[linkId],
          releaseLedger: !!state.synced.releases.perLink[linkId],
        };
      },
      { ...setup, snapshotId: setup.pushedSnapshot },
    );
    expect(restored.ok).toBe(true);
    expect(restored.request).toBe(true);
    expect(restored.requestAuthToken).toBe(SNAPSHOT_BEARER);
    expect(restored.plan).toBe(true);
    expect(restored.mock).toBe(true);
    expect(restored.link).toBe(true);
    expect(restored.linkedCache).toBe(true);
    expect(restored.releaseLedger).toBe(true);

    const failure = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      api.addRequest(null, 'v2 failure marker');
      const before = JSON.stringify(window.__apicircleStore!.getState().synced);
      api.disconnectRepo();
      let pushError = false;
      let refreshError = false;
      try {
        await api.pushWorkspace('should fail');
      } catch {
        pushError = true;
      }
      const afterPush = JSON.stringify(window.__apicircleStore!.getState().synced);
      try {
        await api.refreshWorkspace();
      } catch {
        refreshError = true;
      }
      const afterRefresh = JSON.stringify(window.__apicircleStore!.getState().synced);
      return {
        pushError,
        refreshError,
        pushSame: before === afterPush,
        refreshSame: before === afterRefresh,
      };
    });
    expect(failure.pushError).toBe(true);
    expect(failure.refreshError).toBe(true);
    expect(failure.pushSame).toBe(true);
    expect(failure.refreshSame).toBe(true);
  });
});
