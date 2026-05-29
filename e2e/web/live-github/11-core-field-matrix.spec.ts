import { summarizeUnpushedChanges } from '@apicircle/core';
import { expect, test } from '../fixtures/app';
import {
  assertRemoteWorkspaceHasNoLocalOnlyData,
  connectAndBranchV2,
  createV2HostRepo,
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

test.describe('Live GitHub - core field matrix @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('editor, environment, execution, mock, and global-asset fields diff, push, refresh cleanly', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'core-field-matrix');
    const branch = makeV2BranchName(test.info().workerIndex, 'core-field-matrix');
    await connectAndBranchV2(app, host, branch, tracker);

    const state = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      const schemaId = api.addGlobalSchema({
        name: 'V2 User payload',
        description: 'schema used by live GitHub matrix',
        schema: JSON.stringify({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        }),
      });
      api.updateGlobalSchema(schemaId, {
        name: 'V2 User payload renamed',
        schema: JSON.stringify({
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        }),
      });
      const graphqlId = api.addGlobalGraphQL({
        name: 'V2 Catalog',
        source: 'type Query { item(id: ID!): Item } type Item { id: ID! name: String! }',
      });
      api.updateGlobalGraphQL(graphqlId, { description: 'GraphQL asset used by matrix' });

      const folderId = api.addFolder(null, 'matrix folder');
      api.renameFolder(folderId, 'matrix folder renamed');
      api.setFolderAuth(folderId, {
        type: 'basic',
        username: 'matrix-user',
        password: 'FOLDER_PASSWORD_SHOULD_NOT_PUSH',
      });
      const requestId = api.addRequest(folderId, 'matrix request');
      api.renameRequest(requestId, 'matrix request renamed');
      api.setRequestMethod(requestId, 'PATCH');
      api.setRequestUrl(requestId, 'https://api.example.test/matrix/{id}');
      api.setRequestHeaders(requestId, [{ key: 'X-Matrix', value: 'yes', enabled: true }]);
      api.setRequestQuery(requestId, [{ key: 'q', value: 'live', enabled: true }]);
      api.setRequestPathParams(requestId, { id: '42' });
      api.setRequestCookies(requestId, [{ key: 'mode', value: 'matrix', enabled: true }]);
      api.setRequestBody(requestId, {
        type: 'graphql',
        content: 'query Item($id: ID!) { item(id: $id) { id } }',
        variables: '{"id":"42"}',
      });
      api.setRequestAuth(requestId, {
        type: 'api-key',
        key: 'x-api-key',
        value: 'API_KEY_SHOULD_NOT_PUSH',
        addTo: 'header',
      });
      api.setRequestContextVars(requestId, [{ key: 'LOCAL_HINT', value: 'matrix' }]);
      api.setRequestExtractions(requestId, [
        { id: 'extract-id', variable: 'ITEM_ID', source: 'body', path: 'item.id', enabled: true },
      ]);
      api.setRequestAssertions(requestId, [
        { id: 'assert-200', kind: 'status', op: 'equals', expected: 200 },
      ]);
      api.setRequestBodySchemaId(requestId, schemaId);
      api.setRequestGraphqlSchemaId(requestId, graphqlId);
      const removedRequestId = api.addRequest(null, 'matrix removed request');
      api.removeRequest(removedRequestId);
      const removedFolderId = api.addFolder(null, 'matrix removed folder');
      api.removeFolder(removedFolderId);

      api.addEnvironment('matrix-dev');
      api.renameEnvironment('matrix-dev', 'matrix-renamed');
      api.setVariables('matrix-renamed', [
        { key: 'BASE_URL', value: 'https://api.example.test', encrypted: false },
        {
          key: 'SECRETISH',
          value: 'metadata-only',
          encrypted: true,
          secretKeyId: 'matrix-secret-slot',
        },
      ]);
      api.addEnvironment('matrix-prod');
      api.setActiveEnvironment('matrix-renamed');
      api.setPriorityOrder([
        { kind: 'local', name: 'matrix-renamed' },
        { kind: 'local', name: 'matrix-prod' },
      ]);
      api.removeEnvironment('matrix-prod');

      const planId = api.addPlan('matrix plan');
      api.renamePlan(planId, 'matrix plan renamed');
      api.addPlanStep(planId, requestId);
      api.addPlanStep(planId, requestId);
      api.setPlanStepEnabled(planId, 1, false);
      api.reorderPlanSteps(planId, 1, 0);
      api.removePlanStep(planId, 1);
      api.setPlanStopOnFailure(planId, true);
      api.setPlanVariables(planId, [{ key: 'PLAN_MODE', value: 'matrix' }]);
      api.setPlanEnvPriority(planId, [{ kind: 'local', name: 'matrix-renamed' }]);
      const removedPlanId = api.addPlan('matrix removed plan');
      api.removePlan(removedPlanId);

      const mockId = api.createMockServer({
        name: 'matrix mock',
        source: { kind: 'manual', endpoints: [] },
      });
      api.setMockServerName(mockId, 'matrix mock renamed');
      api.setMockServerCors(mockId, { enabled: true, origins: ['https://app.example.test'] });
      const endpointId = api.addMockEndpoint(mockId);
      api.updateMockEndpoint(mockId, endpointId, {
        name: 'matrix endpoint',
        method: 'PUT',
        pathPattern: '/matrix/{id}',
        response: {
          status: 203,
          body: { type: 'json', content: '{"ok":true}' },
          headers: [{ key: 'x-mock', value: 'yes', enabled: true }],
        },
        requestValidation: [
          { id: 'needs-header', kind: 'header-required', target: 'x-matrix', enabled: true },
        ],
        responseRules: [
          {
            id: 'rule-1',
            name: 'rule',
            enabled: true,
            when: [{ scope: 'query', target: 'mode', op: 'equals', value: 'fast' }],
            response: { status: 204, body: { type: 'text', content: '' }, headers: [] },
          },
        ],
        multipliers: [
          {
            id: 'mult-1',
            targetJsonPath: '$.items',
            source: { kind: 'query', key: 'count' },
            min: 1,
            max: 5,
            defaultCount: 2,
          },
        ],
      });
      const removedEndpointId = api.addMockEndpoint(mockId);
      api.removeMockEndpoint(mockId, removedEndpointId);

      const current = window.__apicircleStore!.getState() as any;
      return {
        ids: { schemaId, graphqlId, folderId, requestId, planId, mockId, endpointId },
        pair: { base: current.local.sync.lastPulledSnapshot ?? null, current: current.synced },
      };
    });

    for (const bucket of [
      'request',
      'folder',
      'environment',
      'executionPlan',
      'mockServer',
      'globalSchema',
      'globalGraphql',
    ]) {
      expectBucket(state.pair, bucket);
    }

    const remote = await pushAndFetchWorkspaceV2(app, host, branch, 'e2e live: core field matrix');
    assertRemoteWorkspaceHasNoLocalOnlyData(remote, {
      forbiddenNeedles: ['API_KEY_SHOULD_NOT_PUSH', 'FOLDER_PASSWORD_SHOULD_NOT_PUSH'],
    });
    const request = remote.collections.requests[state.ids.requestId];
    expect(request.name).toBe('matrix request renamed');
    expect(request.method).toBe('PATCH');
    expect(request.pathParams.id).toBe('42');
    expect(request.cookies[0].key).toBe('mode');
    expect(request.body.type).toBe('graphql');
    expect(request.bodySchemaId).toBe(state.ids.schemaId);
    expect(request.graphqlSchemaId).toBe(state.ids.graphqlId);
    expect(request.auth.value).toBe('');
    expect(remote.collections.folders[state.ids.folderId].auth.password).toBe('');
    expect(remote.environments.items['matrix-renamed'].variables).toHaveLength(2);
    expect(remote.environments.activeName).toBe('matrix-renamed');
    expect(remote.executionPlans[state.ids.planId].stopOnAssertionFailure).toBe(true);
    expect(remote.mockServers[state.ids.mockId].cors.enabled).toBe(true);
    expect(
      remote.mockServers[state.ids.mockId].endpoints.some(
        (endpoint: any) => endpoint.id === state.ids.endpointId,
      ),
    ).toBe(true);
    expect(remote.globalAssets.schemas[state.ids.schemaId].name).toBe('V2 User payload renamed');
    expect(remote.globalAssets.graphql[state.ids.graphqlId].description).toBe(
      'GraphQL asset used by matrix',
    );

    const refreshed = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as any;
      const refresh = await api.refreshWorkspace();
      const state = window.__apicircleStore!.getState() as any;
      return {
        status: refresh.status,
        pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
      };
    });
    expect(['up-to-date', 'merged']).toContain(refreshed.status);
    expect(summary(refreshed.pair).total).toBe(0);
    const latestRemote = (await fetchWorkspaceJson(host, branch)).json as Record<string, any>;
    expect(latestRemote.collections.requests[state.ids.requestId]).toBeDefined();
  });
});
