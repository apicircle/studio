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

// Workspace sharing (Link Workspace, linked content, Releases, Tag/Topics) is
// switched off in shipped builds — `WORKSPACE_SHARING_ENABLED` in
// `@apicircle/shared` is hard-coded `false`, with no prop, env var or storage
// key that lifts it. These specs drive surfaces that therefore do not render,
// so they are skipped rather than deleted: the feature's own behaviour stays
// covered by the unit suites, and this file is what comes back when the
// constant flips. The matching workbook rows are marked N/A for v1 so the
// coverage denominator moves with the numerator.
test.skip(true, 'Workspace sharing is off in v1 (WORKSPACE_SHARING_ENABLED)');

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
