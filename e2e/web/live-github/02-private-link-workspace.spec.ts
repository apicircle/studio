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

test.describe('Live GitHub - private workspace link @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('links a private source through the workspace session and reads request, env, and notes', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'private-link-host');
    const source = await createV2SourceRepo(tracker, bot, 'private-link', 'private', {
      notes: '# V2 private-link v1\n\n- Private source release notes.',
    });
    const branch = makeV2BranchName(test.info().workerIndex, 'private-link');
    await connectAndBranchV2(app, host, branch, tracker);

    const result = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        const snapshot = state.local.linkedCollections[link.id];
        const request = Object.values(snapshot.collections.requests)[0] as any;
        const env = Object.values(snapshot.environments.items)[0] as any;
        const ledger = state.synced.releases.perLink[link.id];
        return {
          linkId: link.id,
          repoFullName: state.synced.linkedWorkspaces[link.id].source.repoFullName,
          requestUrl: request.url,
          envName: env.name,
          notes: ledger.versions[0]?.notes ?? '',
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );

    expect(result.repoFullName.toLowerCase()).toBe(source.cfg.fullName.toLowerCase());
    expect(result.requestUrl).toContain('1.0.0');
    expect(result.envName).toContain('private-link');
    expect(result.notes).toContain('Private source release notes');

    const pushed = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      return api.pushWorkspace('e2e live: persist private linked workspace metadata');
    });
    expect(pushed.commitSha).toMatch(/^[a-f0-9]{40}$/);

    const remote = (await fetchWorkspaceJson(host, branch)).json as Record<string, any>;
    assertRemoteWorkspaceHasNoLocalOnlyData(remote);
    const linked = remote.linkedWorkspaces?.[result.linkId];
    expect(linked?.source?.repoFullName?.toLowerCase()).toBe(source.cfg.fullName.toLowerCase());
    expect(linked?.source?.branch).toBe(source.branch);
    expect(linked?.pinnedVersion).toBe('1.0.0');
    expect(remote.releases?.perLink?.[result.linkId]?.currentVersion).toBe('1.0.0');
  });
});
