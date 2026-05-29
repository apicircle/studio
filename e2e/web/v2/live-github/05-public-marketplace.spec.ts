import { expect, test } from '../../fixtures/app';
import {
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  getV2BotConfig,
  makeV2BranchName,
  v2SkipReason,
  waitForMarketplaceResultV2,
} from './_helpers';

test.describe('V2 Live GitHub - public marketplace discovery @live-github-v2', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('discovers a public apicircle source and links it', async ({ app }) => {
    test.setTimeout(120_000);
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'marketplace-host');
    const source = await createV2SourceRepo(tracker, bot, 'marketplace-source', 'public');
    const branch = makeV2BranchName(test.info().workerIndex, 'marketplace-source');
    await connectAndBranchV2(app, host, branch, tracker);

    await app.evaluate(async () => {
      await window.__apicircleStore!.getState().disconnectGitHubSession();
    });
    await waitForMarketplaceResultV2(app, source.cfg.fullName, source.cfg.name);

    const result = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        const items = await api.searchMarketplace(repoFullName.split('/')[1]);
        const found = items.find(
          (item: any) => item.fullName.toLowerCase() === repoFullName.toLowerCase(),
        );
        if (!found) throw new Error(`Marketplace result missing ${repoFullName}`);
        const link = await api.linkPublicWorkspace({
          repoFullName: found.fullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        return {
          linkedRepo: state.synced.linkedWorkspaces[link.id].source.repoFullName,
          snapshotPresent: !!state.local.linkedCollections[link.id],
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );

    expect(result.linkedRepo.toLowerCase()).toBe(source.cfg.fullName.toLowerCase());
    expect(result.snapshotPresent).toBe(true);
  });
});
