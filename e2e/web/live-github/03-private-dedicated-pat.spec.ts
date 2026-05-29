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

test.describe('Live GitHub - private dedicated PAT link @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('refreshes a private linked source after workspace GitHub session is removed', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    test.skip(
      !bot.dedicatedToken,
      'Set APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED to run dedicated PAT coverage.',
    );

    const host = await createV2HostRepo(tracker, bot, 'dedicated-host');
    const source = await createV2SourceRepo(tracker, bot, 'dedicated-private', 'private');
    const branch = makeV2BranchName(test.info().workerIndex, 'dedicated-private');
    await connectAndBranchV2(app, host, branch, tracker);

    const result = await app.evaluate(
      async ({ repoFullName, sourceBranch, token }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
          sessionMode: 'dedicated',
          linkSessionToken: token,
        });
        await api.disconnectGitHubSession();
        await api.refreshLinkedWorkspace(link.id);
        const state = window.__apicircleStore!.getState() as any;
        return {
          hasWorkspaceSession: !!state.local.sessions.github.workspace,
          hasLinkSession: !!state.local.sessions.github.links?.[link.id],
          snapshotPresent: !!state.local.linkedCollections[link.id],
          ledgerCurrent: state.synced.releases.perLink[link.id]?.currentVersion ?? null,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch, token: bot.dedicatedToken },
    );

    expect(result.hasWorkspaceSession).toBe(false);
    expect(result.hasLinkSession).toBe(true);
    expect(result.snapshotPresent).toBe(true);
    expect(result.ledgerCurrent).toBe('1.0.0');
  });
});
