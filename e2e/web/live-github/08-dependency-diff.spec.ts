import { summarizeUnpushedChanges } from '@apicircle/core';
import { expect, test } from '../fixtures/app';
import {
  assertRemoteWorkspaceHasNoLocalOnlyData,
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  fetchWorkspaceJson,
  getV2BotConfig,
  makeV2BranchName,
  v2SkipReason,
} from './_helpers';

function diff(pair: { base: any; current: any }) {
  return summarizeUnpushedChanges(pair.base, pair.current, {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
}

function expectDiff(pair: { base: any; current: any }, bucket: string, kind = 'added'): void {
  expect(
    diff(pair).changes.some((change) => change.bucket === bucket && change.kind === kind),
    `expected ${kind} ${bucket}`,
  ).toBe(true);
}

test.describe('Live GitHub - dependency diff buckets @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('dependency buckets appear before push and reset after push', async ({ app }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'dep-diff-host');
    const source = await createV2SourceRepo(tracker, bot, 'dep-diff-source', 'private');
    const branch = makeV2BranchName(test.info().workerIndex, 'dep-diff');
    await connectAndBranchV2(app, host, branch, tracker);

    const beforePush = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const snapshot = window.__apicircleStore!.getState().local.linkedCollections[link.id];
        const reqId = Object.keys(snapshot.collections.requests)[0];
        const env = Object.values(snapshot.environments.items)[0] as any;
        api.setLinkedRequestOverride(link.id, reqId, {
          method: 'POST',
          url: 'https://v2.example.test/override',
        });
        api.setLinkedEnvVarOverride(link.id, env.name, env.variables[0].key, {
          value: 'https://v2.example.test/env',
        });
        const state = window.__apicircleStore!.getState() as any;
        return {
          ids: { linkId: link.id, reqId, envName: env.name, varKey: env.variables[0].key },
          pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );
    expectDiff(beforePush.pair, 'linkedWorkspace');
    expectDiff(beforePush.pair, 'linkedRequestOverride');
    expectDiff(beforePush.pair, 'linkedEnvOverride');
    expectDiff(beforePush.pair, 'releasePerLink');

    const afterPush = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      const push = await api.pushWorkspace('e2e live: dependency diff');
      const state = window.__apicircleStore!.getState() as any;
      return {
        commitSha: push.commitSha as string,
        base: state.local.sync.lastPulledSnapshot ?? null,
        current: state.synced,
      };
    });
    expect(diff(afterPush).total).toBe(0);

    // Read by the immutable push commit SHA, not the branch ref: `?ref=<branch>`
    // can serve the pre-push snapshot for several seconds after updateRef
    // (Contents-API propagation), which left `linkedWorkspaces[id]` undefined.
    const remote = (
      await fetchWorkspaceJson(host, branch, { expectedCommitSha: afterPush.commitSha })
    ).json as Record<string, any>;
    assertRemoteWorkspaceHasNoLocalOnlyData(remote);
    expect(remote.linkedWorkspaces[beforePush.ids.linkId]).toBeDefined();
    expect(
      remote.linkedOverrides.requests[`${beforePush.ids.linkId}:${beforePush.ids.reqId}`],
    ).toBeDefined();
    expect(
      remote.linkedOverrides.environmentVars[
        `${beforePush.ids.linkId}:${beforePush.ids.envName}:${beforePush.ids.varKey}`
      ],
    ).toBeDefined();
    expect(remote.releases.perLink[beforePush.ids.linkId]).toBeDefined();
  });
});
