import { expect, test } from '../fixtures/app';
import {
  connectAndBranchV2,
  createV2HostRepo,
  createV2Tracker,
  fetchBranchRefV2,
  fetchWorkspaceJson,
  getV2BotConfig,
  makeV2BranchName,
  pushAndFetchWorkspaceV2,
  v2SkipReason,
} from './_helpers';

test.describe('Live GitHub - connect, branch, push @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('creates the exact requested branch and pushes workspace.json', async ({ app }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'connect-branch-push');
    const branch = makeV2BranchName(test.info().workerIndex, 'connect-branch-push');
    await connectAndBranchV2(app, host, branch, tracker);

    await app.evaluate(() => {
      const api = window.__apicircleStore!.getState() as any;
      const requestId = api.addRequest(null, 'v2 push request');
      api.setRequestMethod(requestId, 'POST');
      api.setRequestUrl(requestId, 'https://v2.example.test/push');
      api.setRequestBody(requestId, { type: 'json', content: '{"v2":true}' });
    });

    const remote = await pushAndFetchWorkspaceV2(
      app,
      host,
      branch,
      'e2e live: connect branch push',
    );
    expect(Object.keys(remote.collections?.requests ?? {}).length).toBeGreaterThan(0);
    expect(JSON.stringify(remote)).toContain('https://v2.example.test/push');

    const ref = await fetchBranchRefV2(host, branch);
    const file = await fetchWorkspaceJson(host, branch);
    expect(ref.sha).toMatch(/^[a-f0-9]{40}$/);
    expect(file.sha).toMatch(/^[a-f0-9]{40}$/);
  });
});
