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
  pushAndFetchWorkspaceV2,
  v2SkipReason,
} from './_helpers';

function summary(pair: { base: any; current: any }) {
  return summarizeUnpushedChanges(pair.base, pair.current, {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
}

function expectBucket(pair: { base: any; current: any }, bucket: string): void {
  expect(
    summary(pair).changes.some((change) => change.bucket === bucket),
    `expected ${bucket} diff`,
  ).toBe(true);
}

test.describe('Live GitHub - core surfaces under linked source @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('editor, env, execution plan, and mock changes diff, push, refresh, and remain secret-safe', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'core-surfaces-host');
    const source = await createV2SourceRepo(tracker, bot, 'core-surfaces-source', 'private');
    const branch = makeV2BranchName(test.info().workerIndex, 'core-surfaces');
    await connectAndBranchV2(app, host, branch, tracker);

    const state = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const linkedReqId = Object.keys(
          window.__apicircleStore!.getState().local.linkedCollections[link.id].collections.requests,
        )[0];
        const folderId = api.addFolder(null, 'v2 core folder');
        const requestId = api.addRequest(folderId, 'v2 core request');
        api.setRequestMethod(requestId, 'POST');
        api.setRequestUrl(requestId, 'https://v2.example.test/core/{id}');
        api.setRequestBody(requestId, { type: 'json', content: '{"core":true}' });
        api.setRequestAuth(requestId, { type: 'bearer', token: 'V2_BEARER_SHOULD_NOT_PUSH' });
        api.setRequestAssertions(requestId, [
          { id: 'v2-status', kind: 'status', op: 'equals', expected: 201 },
        ]);
        const passphrase = await api.setupPassphrase('v2-core-passphrase');
        if (!passphrase.ok) throw new Error(`setupPassphrase failed: ${passphrase.reason}`);
        api.addEnvironment('v2-core-env');
        api.setVariables('v2-core-env', [
          { key: 'BASE_URL', value: 'https://v2.example.test', encrypted: false },
          { key: 'TOKEN', value: 'before-bind', encrypted: false },
        ]);
        const secretId = await api.addSecret({
          label: 'V2_CORE_TOKEN',
          value: 'V2_SECRET_SHOULD_NOT_PUSH',
          origin: 'workspace',
        });
        await api.bindVariableToSecretKey('v2-core-env', 1, secretId);
        const planId = api.addPlan('v2 core plan');
        api.addPlanStep(planId, requestId);
        api.addPlanStep(planId, linkedReqId, link.id);
        const mockId = api.createMockServer({
          name: 'v2 core mock',
          source: { kind: 'manual', endpoints: [] },
        });
        const endpointId = api.addMockEndpoint(mockId);
        api.updateMockEndpoint(mockId, endpointId, {
          method: 'POST',
          pathPattern: '/v2/{id}',
          response: { status: 202, body: { type: 'json', content: '{"ok":true}' }, headers: [] },
          requestValidation: [
            { id: 'v2-header', kind: 'header-required', target: 'x-v2', enabled: true },
          ],
          responseRules: [
            {
              id: 'v2-rule',
              name: 'ok',
              enabled: true,
              when: [],
              response: {
                status: 200,
                body: { type: 'json', content: '{"rule":true}' },
                headers: [],
              },
            },
          ],
          multipliers: [
            {
              id: 'v2-mult',
              targetJsonPath: '$.items',
              source: { kind: 'query', key: 'count' },
              min: 1,
              max: 3,
              defaultCount: 1,
            },
          ],
        });
        const current = window.__apicircleStore!.getState() as any;
        return {
          ids: { requestId, planId, mockId, secretId },
          pair: { base: current.local.sync.lastPulledSnapshot ?? null, current: current.synced },
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );

    expectBucket(state.pair, 'request');
    expectBucket(state.pair, 'environment');
    expectBucket(state.pair, 'executionPlan');
    expectBucket(state.pair, 'mockServer');

    const remote = await pushAndFetchWorkspaceV2(app, host, branch, 'e2e live: core surfaces');
    assertRemoteWorkspaceHasNoLocalOnlyData(remote, {
      forbiddenNeedles: ['V2_BEARER_SHOULD_NOT_PUSH', 'V2_SECRET_SHOULD_NOT_PUSH'],
    });
    expect(remote.collections.requests[state.ids.requestId].auth.token).toBe('');
    expect(remote.executionPlans[state.ids.planId]).toBeDefined();
    expect(remote.mockServers[state.ids.mockId]).toBeDefined();

    const afterPush = await app.evaluate(async () => {
      const state = window.__apicircleStore!.getState() as any;
      return { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced };
    });
    expect(summary(afterPush).total).toBe(0);
    const refreshed = await app.evaluate(
      async ({ ids }) => {
        const result = await window.__apicircleStore!.getState().refreshWorkspace();
        const state = window.__apicircleStore!.getState() as any;
        const request = state.synced.collections.requests[ids.requestId];
        const env = state.synced.environments.items['v2-core-env'];
        return {
          status: result.status,
          requestPresent: !!request,
          requestUrl: request?.url ?? null,
          requestAuthToken: request?.auth?.token ?? null,
          envPresent: !!env,
          planPresent: !!state.synced.executionPlans[ids.planId],
          mockPresent: !!state.synced.mockServers[ids.mockId],
          linkedCount: Object.keys(state.synced.linkedWorkspaces ?? {}).length,
          pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
        };
      },
      { ids: state.ids },
    );
    expect(refreshed.status).toBe('merged');
    expect(refreshed.requestPresent).toBe(true);
    expect(refreshed.requestUrl).toBe('https://v2.example.test/core/{id}');
    expect(refreshed.requestAuthToken).toBe('V2_BEARER_SHOULD_NOT_PUSH');
    expect(refreshed.envPresent).toBe(true);
    expect(refreshed.planPresent).toBe(true);
    expect(refreshed.mockPresent).toBe(true);
    expect(refreshed.linkedCount).toBe(1);
    expect(summary(refreshed.pair).total, 'diff should be clean after refresh settles').toBe(0);
    expect((await fetchWorkspaceJson(host, branch)).json).toBeDefined();
  });
});
