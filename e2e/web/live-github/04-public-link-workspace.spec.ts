import { expect, test } from '../fixtures/app';
import {
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  getV2BotConfig,
  makeV2BranchName,
  v2SkipReason,
} from './_helpers';

test.describe('Live GitHub - public anonymous workspace link @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('links a public source without an active workspace GitHub session', async ({ app }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'public-link-host');
    const source = await createV2SourceRepo(tracker, bot, 'public-link', 'public');
    const branch = makeV2BranchName(test.info().workerIndex, 'public-link');
    await connectAndBranchV2(app, host, branch, tracker);

    const result = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        await api.disconnectGitHubSession();
        const link = await api.linkPublicWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        const snapshot = state.local.linkedCollections[link.id];
        const request = Object.values(snapshot.collections.requests)[0] as any;
        return {
          hasWorkspaceSession: !!state.local.sessions.github.workspace,
          requestUrl: request.url,
          repoFullName: state.synced.linkedWorkspaces[link.id].source.repoFullName,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );

    expect(result.hasWorkspaceSession).toBe(false);
    expect(result.repoFullName.toLowerCase()).toBe(source.cfg.fullName.toLowerCase());
    expect(result.requestUrl).toContain('1.0.0');
  });
});
