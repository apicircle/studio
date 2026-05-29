// Live GitHub - dependency-linked core surface regression.
//
// This spec exercises the core app surfaces after a GitHub dependency is
// linked. It verifies that Editor, Environments, Execution Plans, and Mock
// Servers all:
//   - show up in the pre-push diff buckets,
//   - push to real GitHub as synced intent,
//   - return to a clean diff after push,
//   - are recoverable from the automatic pre-push snapshot,
//   - never leak local-only state or plaintext secrets into workspace.json.

import { summarizeUnpushedChanges } from '@apicircle/core';
import type { WorkspaceSynced } from '@apicircle/shared';
import { expect, test } from '../fixtures/app';
import {
  type LiveGithubConfig,
  assertRemoteWorkspaceHasNoLocalOnlyData,
  connectAndBranch,
  createRepo,
  deleteBranch,
  deleteRepo,
  disconnect,
  fetchWorkspaceJson,
  getBotOwner,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  makeDeterministicWorkspace,
  seedRepoIfEmpty,
  writeWorkspaceJson,
} from './_helpers';

interface StatePair {
  base: WorkspaceSynced | null;
  current: WorkspaceSynced;
}

const createdBranches: string[] = [];
const createdRepos: Array<{ owner: string; name: string; token: string }> = [];

function summary(pair: StatePair) {
  return summarizeUnpushedChanges(pair.base, pair.current, {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
}

function expectBucket(pair: StatePair, bucket: string): void {
  const found = summary(pair).changes.some((c) => c.bucket === bucket);
  expect(found, `expected an unpushed ${bucket} diff`).toBe(true);
}

async function provisionSourceRepo(
  token: string,
  botOwner: string,
  label: string,
): Promise<{ cfg: LiveGithubConfig; branch: string }> {
  const created = await createRepo(token, {
    owner: botOwner,
    name: `apicircle-e2e-core-source-${label}-${Date.now() % 1_000_000}`,
    visibility: 'private',
  });
  createdRepos.push({ owner: created.owner, name: created.name, token });
  const cfg: LiveGithubConfig = {
    token,
    owner: created.owner,
    name: created.name,
    fullName: created.fullName,
  };
  const head = await seedRepoIfEmpty(cfg);
  await writeWorkspaceJson(
    cfg,
    head.name,
    makeDeterministicWorkspace(`core-${label}`, {
      version: '1.0.0',
      notes: '# Core linked source\n\n- v1 seeded for core surface regression.',
    }),
    'e2e: seed core dependency source',
  );
  return { cfg, branch: head.name };
}

test.describe('Live GitHub - core surfaces under linked dependencies @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let host: LiveGithubConfig;
  let source: LiveGithubConfig;
  let sourceBranch: string;
  let botOwner: string;

  test.beforeAll(async () => {
    const resolved = getPipelineRepoConfig().privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    host = resolved;
    const owner = getBotOwner();
    test.skip(
      owner === null,
      'core dependency regression creates a source repo - set APICIRCLE_E2E_BOT_OWNER.',
    );
    botOwner = owner!;
    await seedRepoIfEmpty(host);
    const provisioned = await provisionSourceRepo(host.token, botOwner, 'core');
    source = provisioned.cfg;
    sourceBranch = provisioned.branch;
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(host, branch);
    }
    for (const repo of createdRepos.splice(0)) {
      try {
        await deleteRepo(repo.token, repo.owner, repo.name);
      } catch {
        /* orphan sweep catches misses */
      }
    }
  });

  test('Editor, Environments, Execution Plans, and Mocks track, push, refresh, and restore without data loss', async ({
    app,
  }) => {
    const branch = makeBranchName(test.info().workerIndex, 'core-surfaces-linked');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const mutation = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;

        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        const linkedSnapshot = window.__apicircleStore!.getState().local?.linkedCollections?.[
          link.id
        ] as { collections?: { requests?: Record<string, unknown> } } | undefined;
        const linkedRequestId = Object.keys(linkedSnapshot?.collections?.requests ?? {})[0];
        if (!linkedRequestId)
          throw new Error('deterministic linked source did not expose a request');

        const folderId = api.addFolder(null, 'live core folder');
        api.renameFolder(folderId, 'live core folder renamed');
        const requestId = api.addRequest(folderId, 'live core request');
        api.renameRequest(requestId, 'live core request renamed');
        api.setRequestMethod(requestId, 'POST');
        api.setRequestUrl(requestId, 'https://api.example.test/core/{id}');
        api.setRequestPathParams(requestId, { id: '42' });
        api.setRequestHeaders(requestId, [{ key: 'X-Core', value: 'yes', enabled: true }]);
        api.setRequestQuery(requestId, [{ key: 'mode', value: 'live', enabled: true }]);
        api.setRequestCookies(requestId, [
          { key: 'session', value: 'cookie-value', enabled: true },
        ]);
        api.setRequestBody(requestId, { type: 'json', content: JSON.stringify({ core: true }) });
        api.setRequestAuth(requestId, {
          type: 'bearer',
          token: 'E2E_PLAINTEXT_BEARER_DO_NOT_PUSH',
        });
        api.setRequestAssertions(requestId, [
          { id: 'assert-core-status', kind: 'status', op: 'equals', expected: 201 },
        ]);

        const dropRequestId = api.addRequest(null, 'live core request removed');
        api.removeRequest(dropRequestId);
        const dropFolderId = api.addFolder(null, 'live core folder removed');
        api.removeFolder(dropFolderId);

        const passphrase = await api.setupPassphrase('live-core-e2e-passphrase');
        if (!passphrase.ok) throw new Error(`setupPassphrase failed: ${passphrase.reason}`);
        api.addEnvironment('live-core-env');
        api.setVariables('live-core-env', [
          { key: 'BASE_URL', value: 'https://api.example.test', encrypted: false },
          { key: 'API_TOKEN', value: 'plaintext-before-bind', encrypted: false },
        ]);
        const secretId = await api.addSecret({
          label: 'LIVE_CORE_TOKEN',
          value: 'E2E_SECRET_VALUE_DO_NOT_PUSH',
          origin: 'workspace',
        });
        const bound = await api.bindVariableToSecretKey('live-core-env', 1, secretId);
        if (!bound) throw new Error('bindVariableToSecretKey failed');
        api.addEnvironment('live-core-env-removed');
        api.removeEnvironment('live-core-env-removed');
        api.setActiveEnvironment('live-core-env');
        api.setPriorityOrder([{ kind: 'local', name: 'live-core-env' }]);

        const planId = api.addPlan('live core plan');
        api.renamePlan(planId, 'live core plan renamed');
        api.addPlanStep(planId, requestId);
        api.addPlanStep(planId, linkedRequestId, link.id);
        api.setPlanStopOnFailure(planId, true);
        api.setPlanVariables(planId, [{ key: 'PLAN_MODE', value: 'linked-live' }]);
        const dropPlanId = api.addPlan('live core plan removed');
        api.removePlan(dropPlanId);

        const mockId = api.createMockServer({
          name: 'live core mock',
          source: { kind: 'manual', endpoints: [] },
        });
        const endpointId = api.addMockEndpoint(mockId);
        api.updateMockEndpoint(mockId, endpointId, {
          name: 'POST /widgets/{id}',
          method: 'POST',
          pathPattern: '/widgets/{id}',
          description: 'core regression endpoint',
          requestSchema: {
            pathParams: [{ id: 'param-id', name: 'id', required: true }],
            queryParams: [{ id: 'query-page', name: 'page', required: false }],
            headers: [{ id: 'header-core', name: 'x-core', required: true }],
            cookies: [],
            body: { description: 'json payload', example: '{"ok":true}' },
          },
          requestValidation: [
            {
              id: 'validation-core-header',
              kind: 'header-required',
              target: 'x-core',
              enabled: true,
              message: 'x-core is required',
              failResponse: {
                status: 400,
                headers: [],
                body: { type: 'json', content: '{"error":"missing"}' },
              },
            },
          ],
          responseRules: [
            {
              id: 'rule-page-one',
              name: 'page one',
              enabled: true,
              when: [
                { id: 'clause-page', scope: 'query', target: 'page', op: 'equals', value: '1' },
              ],
              response: {
                status: 202,
                headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
                body: { type: 'json', content: '{"accepted":true}' },
              },
            },
          ],
          defaultResponse: {
            status: 201,
            headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
            body: {
              type: 'json',
              content: '{"items":[{"id":"template"}]}',
              multipliers: [
                {
                  id: 'mult-page-size',
                  name: 'page size',
                  source: { kind: 'query', key: 'limit' },
                  targetJsonPath: '$.items',
                  defaultCount: 1,
                  min: 1,
                  max: 5,
                },
              ],
            },
          },
        });
        const dropEndpointId = api.addMockEndpoint(mockId);
        api.removeMockEndpoint(mockId, dropEndpointId);
        const dropMockId = api.createMockServer({
          name: 'live core mock removed',
          source: { kind: 'manual', endpoints: [] },
        });
        api.removeMockServer(dropMockId);

        const state = window.__apicircleStore!.getState() as unknown as {
          local?: { sync?: { lastPulledSnapshot?: WorkspaceSynced | null } };
          synced: WorkspaceSynced;
        };
        return {
          pair: { base: state.local?.sync?.lastPulledSnapshot ?? null, current: state.synced },
          ids: {
            linkId: link.id,
            linkedRequestId,
            folderId,
            requestId,
            secretId,
            planId,
            mockId,
            endpointId,
          },
        };
      },
      { repoFullName: source.fullName, sourceRef: sourceBranch },
    );

    expectBucket(mutation.pair, 'linkedWorkspace');
    expectBucket(mutation.pair, 'releasePerLink');
    expectBucket(mutation.pair, 'folder');
    expectBucket(mutation.pair, 'request');
    expectBucket(mutation.pair, 'environment');
    expectBucket(mutation.pair, 'secretKey');
    expectBucket(mutation.pair, 'secretCrypto');
    expectBucket(mutation.pair, 'executionPlan');
    expectBucket(mutation.pair, 'mockServer');

    const pushed = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
      const push = await api.pushWorkspace('e2e core surfaces linked regression');
      const state = window.__apicircleStore!.getState() as unknown as {
        local?: {
          sync?: { lastPulledSnapshot?: WorkspaceSynced | null };
          snapshots?: { entries?: Array<{ id: string; triggeredBy?: string; note?: string }> };
        };
        synced: WorkspaceSynced;
      };
      const snapshot = (state.local?.snapshots?.entries ?? [])[0] ?? null;
      return {
        commitSha: push.commitSha,
        snapshot,
        pair: { base: state.local?.sync?.lastPulledSnapshot ?? null, current: state.synced },
      };
    });
    expect(pushed.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(pushed.snapshot?.triggeredBy).toBe('pre-push');
    expect(summary(pushed.pair).total, 'diff should be clean after successful push').toBe(0);

    const remote = (await fetchWorkspaceJson(host, branch)).json as Record<string, any>;
    assertRemoteWorkspaceHasNoLocalOnlyData(remote, {
      forbiddenNeedles: ['E2E_PLAINTEXT_BEARER_DO_NOT_PUSH', 'E2E_SECRET_VALUE_DO_NOT_PUSH'],
    });
    expect(remote.collections?.folders?.[mutation.ids.folderId]?.name).toBe(
      'live core folder renamed',
    );
    const remoteRequest = remote.collections?.requests?.[mutation.ids.requestId];
    expect(remoteRequest?.method).toBe('POST');
    expect(remoteRequest?.url).toBe('https://api.example.test/core/{id}');
    expect(remoteRequest?.body?.content).toContain('"core":true');
    expect(remoteRequest?.auth?.token, 'bearer token must be redacted in workspace.json').toBe('');
    expect(remoteRequest?.assertions?.[0]?.expected).toBe(201);
    const remoteEnv = remote.environments?.items?.['live-core-env'];
    expect(
      remoteEnv?.variables?.some((v: any) => v.key === 'API_TOKEN' && v.encrypted && v.secretKeyId),
    ).toBe(true);
    expect(remote.secretKeys?.[mutation.ids.secretId]?.label).toBe('LIVE_CORE_TOKEN');
    const remotePlan = remote.executionPlans?.[mutation.ids.planId];
    expect(remotePlan?.steps).toHaveLength(2);
    expect(remotePlan?.steps?.[1]?.linkedWorkspaceId).toBe(mutation.ids.linkId);
    const remoteMock = remote.mockServers?.[mutation.ids.mockId];
    expect(remoteMock?.endpoints?.[0]?.responseRules).toHaveLength(1);
    expect(remoteMock?.endpoints?.[0]?.requestValidation).toHaveLength(1);
    expect(remoteMock?.endpoints?.[0]?.defaultResponse?.body?.multipliers).toHaveLength(1);

    const refresh = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as unknown as {
        refreshWorkspace: () => Promise<{ status: string }>;
      };
      return api.refreshWorkspace();
    });
    expect(refresh.status).toBe('up-to-date');

    const restored = await app.evaluate(
      ({ snapshotId, ids }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const noiseRequestId = api.addRequest(null, 'local noise after push');
        const ok = api.restoreSnapshot(snapshotId);
        const state = window.__apicircleStore!.getState() as unknown as {
          synced: Record<string, any>;
          local?: { linkedCollections?: Record<string, unknown> };
        };
        return {
          ok,
          noisePresent: !!state.synced.collections?.requests?.[noiseRequestId],
          requestPresent: !!state.synced.collections?.requests?.[ids.requestId],
          envPresent: !!state.synced.environments?.items?.['live-core-env'],
          planStepCount: state.synced.executionPlans?.[ids.planId]?.steps?.length ?? 0,
          mockPresent: !!state.synced.mockServers?.[ids.mockId],
          linkedPresent: !!state.synced.linkedWorkspaces?.[ids.linkId],
          linkedCachePresent: !!state.local?.linkedCollections?.[ids.linkId],
          releaseLedgerPresent: !!state.synced.releases?.perLink?.[ids.linkId],
        };
      },
      { snapshotId: pushed.snapshot.id, ids: mutation.ids },
    );
    expect(restored.ok).toBe(true);
    expect(restored.noisePresent).toBe(false);
    expect(restored.requestPresent).toBe(true);
    expect(restored.envPresent).toBe(true);
    expect(restored.planStepCount).toBe(2);
    expect(restored.mockPresent).toBe(true);
    expect(restored.linkedPresent).toBe(true);
    expect(restored.linkedCachePresent).toBe(true);
    expect(restored.releaseLedgerPresent).toBe(true);

    await disconnect(app);
  });

  test('push and refresh failure paths leave synced state byte-identical', async ({ app }) => {
    const branch = makeBranchName(test.info().workerIndex, 'core-failure-identity');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const result = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
      api.addRequest(null, 'failure identity marker');
      const beforePush = JSON.stringify(window.__apicircleStore!.getState().synced);
      api.disconnectRepo();
      let pushError = false;
      try {
        await api.pushWorkspace('should fail without repo');
      } catch {
        pushError = true;
      }
      const afterPush = JSON.stringify(window.__apicircleStore!.getState().synced);
      let refreshError = false;
      try {
        await api.refreshWorkspace();
      } catch {
        refreshError = true;
      }
      const afterRefresh = JSON.stringify(window.__apicircleStore!.getState().synced);
      return {
        pushError,
        refreshError,
        pushSame: beforePush === afterPush,
        refreshSame: beforePush === afterRefresh,
      };
    });
    expect(result.pushError).toBe(true);
    expect(result.refreshError).toBe(true);
    expect(result.pushSame).toBe(true);
    expect(result.refreshSame).toBe(true);

    await disconnect(app);
  });
});
