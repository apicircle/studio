import { expect, test } from '../../fixtures/app';
import {
  assertRepoReadableWithTokenV2,
  createV2Repo,
  createV2Tracker,
  getV2BotConfig,
  seedRepoIfEmpty,
  v2SkipReason,
} from './_helpers';

test.describe('V2 Live GitHub - preflight @live-github-v2', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('PAT, owner, private/public repo creation, delete permission, and dedicated PAT are valid', async () => {
    const bot = getV2BotConfig();
    expect(bot.owner).toBeTruthy();
    expect(
      bot.dedicatedToken,
      'APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED is required for v2 coverage',
    ).toBeTruthy();

    const privateRepo = tracker.trackRepo(await createV2Repo(bot, 'preflight-private', 'private'));
    const publicRepo = tracker.trackRepo(await createV2Repo(bot, 'preflight-public', 'public'));
    expect(privateRepo.owner.toLowerCase()).toBe(bot.owner.toLowerCase());
    expect(publicRepo.owner.toLowerCase()).toBe(bot.owner.toLowerCase());

    await seedRepoIfEmpty(privateRepo, { workspaceJson: true });
    await seedRepoIfEmpty(publicRepo, { workspaceJson: true });

    await assertRepoReadableWithTokenV2(bot.token, privateRepo);
    await assertRepoReadableWithTokenV2(bot.token, publicRepo);
    await assertRepoReadableWithTokenV2(bot.dedicatedToken!, privateRepo);
  });
});
