import { expect, test } from '../../fixtures/app';
import {
  assertRemoteWorkspaceHasNoLocalOnlyData,
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  fetchWorkspaceJson,
  getV2BotConfig,
  makeV2BranchName,
  seedSourceAttachmentRequestV2,
  updateWorkspaceJson,
  v2Bytes,
  v2SkipReason,
} from './_helpers';

const SOURCE_SCHEMA_ID = 'v2-exec-source-json-schema';
const SOURCE_GRAPHQL_ID = 'v2-exec-source-graphql-schema';

test.describe('V2 Live GitHub - execution plans with linked assets @live-github-v2', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('linked plan step downloads source file assets, resolves source schemas, and sends multipart wire body', async ({
    app,
    e2eMock,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'linked-asset-execution-host');
    const source = await createV2SourceRepo(
      tracker,
      bot,
      'linked-asset-execution-source',
      'private',
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'linked-asset-execution');
    const path = `/anything/v2-linked-assets-${Date.now()}`;
    await e2eMock.clearInspection();

    await updateWorkspaceJson(
      source.cfg,
      source.branch,
      'e2e v2: linked execution global assets',
      (ws) => {
        const typed = ws as Record<string, any>;
        typed.globalAssets = {
          schemas: {
            [SOURCE_SCHEMA_ID]: {
              id: SOURCE_SCHEMA_ID,
              name: 'Linked execution JSON schema',
              description: 'schema must stay with linked request execution',
              schema: JSON.stringify({
                type: 'object',
                required: ['scenario'],
                properties: { scenario: { type: 'string' } },
              }),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
          graphql: {
            [SOURCE_GRAPHQL_ID]: {
              id: SOURCE_GRAPHQL_ID,
              name: 'Linked execution GraphQL schema',
              description: 'graphql asset must stay with linked request execution',
              kind: 'sdl',
              source:
                'type Query { linkedAsset(id: ID!): LinkedAsset } type LinkedAsset { id: ID! }',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        };
      },
    );
    await seedSourceAttachmentRequestV2(source, {
      slotId: 'v2-exec-linked-file',
      filename: 'linked-source-upload.txt',
      mimeType: 'text/plain',
      bytes: v2Bytes('linked execution file payload'),
      url: e2eMock.url(path),
      requestName: 'v2 linked asset executable request',
      textFields: [{ key: 'scenario', value: 'linked-execution' }],
      bodySchemaId: SOURCE_SCHEMA_ID,
      graphqlSchemaId: SOURCE_GRAPHQL_ID,
    });

    await connectAndBranchV2(app, host, branch, tracker);
    const setup = await app.evaluate(
      async ({ repoFullName, sourceBranch, schemaId, graphqlId }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const stateAfterLink = window.__apicircleStore!.getState() as any;
        const snapshot = stateAfterLink.local.linkedCollections[link.id];
        const linkedRequest = Object.values(snapshot.collections.requests)[0] as any;
        const planId = api.addPlan('v2 linked asset execution plan');
        api.addPlanStep(planId, linkedRequest.id, link.id);
        (window as any).__v2LinkedAssetPlanRun = api.runPlan(planId);
        return {
          linkId: link.id,
          planId,
          linkedRequestId: linkedRequest.id,
          schemaPresent: !!snapshot.globalAssets?.schemas?.[schemaId],
          graphqlPresent: !!snapshot.globalAssets?.graphql?.[graphqlId],
          requestSchemaId: linkedRequest.bodySchemaId,
          requestGraphqlId: linkedRequest.graphqlSchemaId,
        };
      },
      {
        repoFullName: source.cfg.fullName,
        sourceBranch: source.branch,
        schemaId: SOURCE_SCHEMA_ID,
        graphqlId: SOURCE_GRAPHQL_ID,
      },
    );

    expect(setup.schemaPresent).toBe(true);
    expect(setup.graphqlPresent).toBe(true);
    expect(setup.requestSchemaId).toBe(SOURCE_SCHEMA_ID);
    expect(setup.requestGraphqlId).toBe(SOURCE_GRAPHQL_ID);

    const dialog = app.getByRole('dialog', {
      name: /Download attachments before running this plan/,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('linked-source-upload.txt')).toBeVisible();
    await expect(dialog.getByText('Required by v2 linked asset executable request')).toBeVisible();
    await expect(dialog.getByText('Linked workspace')).toBeVisible();
    await app.getByRole('button', { name: /Download and continue/ }).click();
    await expect(dialog).toBeHidden();

    const result = await app.evaluate(
      async ({ planId, linkedRequestId }) => {
        const planRun = await (window as any).__v2LinkedAssetPlanRun;
        const api = window.__apicircleStore!.getState() as any;
        const detail = api.lastPlanResults[planId]?.[0];
        const attachmentCache = api.local.attachmentCache?.['v2-exec-linked-file'] ?? null;
        const push = await api.pushWorkspace('e2e v2: persist linked asset execution plan');
        return {
          planStepPassed: planRun.steps[0]?.passed ?? false,
          resultStatus: detail?.result?.status ?? null,
          resultOk: detail?.result?.ok ?? false,
          resultUrl: detail?.result?.url ?? '',
          attachmentLocalPath: attachmentCache?.localPath ?? null,
          attachmentRequiredBy: attachmentCache?.requiredBy?.[0]?.requestId ?? null,
          commitSha: push.commitSha,
          linkedRequestId,
        };
      },
      { planId: setup.planId, linkedRequestId: setup.linkedRequestId },
    );

    expect(result.attachmentLocalPath).toContain('indexeddb://apicircle-attachments/');
    expect(result.attachmentRequiredBy).toBe(setup.linkedRequestId);
    expect(result.planStepPassed).toBe(true);
    expect(result.resultOk).toBe(true);
    expect(result.resultStatus).toBe(200);
    expect(result.resultUrl).toContain(path);
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

    const wire = await e2eMock.findLastByPath((capturedPath) => capturedPath === path, {
      timeout: 10_000,
    });
    expect(wire.method).toBe('POST');
    expect(wire.body.kind).toBe('multipart');
    if (wire.body.kind === 'multipart') {
      expect(
        wire.body.parts.some(
          (part) => part.name === 'scenario' && part.text === 'linked-execution',
        ),
      ).toBe(true);
      expect(
        wire.body.parts.some(
          (part) =>
            part.name === 'upload' &&
            part.filename === 'linked-source-upload.txt' &&
            part.contentType === 'text/plain' &&
            part.bytes === 'linked execution file payload'.length,
        ),
      ).toBe(true);
    }

    const remote = (await fetchWorkspaceJson(host, branch)).json as Record<string, any>;
    assertRemoteWorkspaceHasNoLocalOnlyData(remote);
    const step = remote.executionPlans[setup.planId].steps[0];
    expect(step.requestId).toBe(setup.linkedRequestId);
    expect(step.linkedWorkspaceId).toBe(setup.linkId);
    expect(JSON.stringify(remote)).not.toContain('linked-source-upload.txt');
  });

  test('local reusable global file asset sends as multipart form-data', async ({
    app,
    e2eMock,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'local-global-file-execution-host');
    const branch = makeV2BranchName(test.info().workerIndex, 'local-global-file-execution');
    const path = `/anything/v2-local-global-file-${Date.now()}`;
    const fileBytes = v2Bytes('local reusable execution file payload');
    await e2eMock.clearInspection();
    await connectAndBranchV2(app, host, branch, tracker);

    const result = await app.evaluate(
      async ({ payload, url }) => {
        const api = window.__apicircleStore!.getState() as any;
        const fileAssetId = await api.addGlobalFileAsset(
          new File([new Uint8Array(payload)], 'local-global-upload.txt', { type: 'text/plain' }),
          { name: 'Local reusable upload' },
        );
        const requestId = api.addRequest(null, 'v2 local global asset upload');
        api.setRequestMethod(requestId, 'POST');
        api.setRequestUrl(requestId, url);
        api.setRequestBody(requestId, {
          type: 'form-data',
          content: '',
          formRows: [
            { kind: 'text', key: 'scenario', value: 'local-global-file', enabled: true },
            { kind: 'file', key: 'upload', enabled: true, slotId: null },
          ],
        });
        await api.setFormRowGlobalFileAsset(requestId, 1, fileAssetId);
        api.setActiveRequestId(requestId);
        await api.executeActiveRequest();
        const state = window.__apicircleStore!.getState() as any;
        return {
          requestId,
          ok: state.lastRun[requestId]?.ok ?? false,
          status: state.lastRun[requestId]?.status ?? null,
          attachmentCache:
            state.local.attachmentCache?.[state.synced.globalAssets.files[fileAssetId].slotId] ??
            null,
        };
      },
      { payload: Array.from(fileBytes), url: e2eMock.url(path) },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.attachmentCache).toBeNull();
    const wire = await e2eMock.findLastByPath((capturedPath) => capturedPath === path, {
      timeout: 10_000,
    });
    expect(wire.method).toBe('POST');
    expect(wire.body.kind).toBe('multipart');
    if (wire.body.kind === 'multipart') {
      expect(
        wire.body.parts.some(
          (part) => part.name === 'scenario' && part.text === 'local-global-file',
        ),
      ).toBe(true);
      expect(
        wire.body.parts.some(
          (part) =>
            part.name === 'upload' &&
            part.filename === 'local-global-upload.txt' &&
            part.contentType === 'text/plain' &&
            part.bytes === 'local reusable execution file payload'.length,
        ),
      ).toBe(true);
    }
  });

  test('public linked plan step downloads attachment anonymously before execution', async ({
    app,
    e2eMock,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'public-linked-asset-execution-host');
    const source = await createV2SourceRepo(
      tracker,
      bot,
      'public-linked-asset-execution-source',
      'public',
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'public-linked-asset-execution');
    const path = `/anything/v2-public-linked-assets-${Date.now()}`;
    await e2eMock.clearInspection();
    await seedSourceAttachmentRequestV2(source, {
      slotId: 'v2-exec-public-linked-file',
      filename: 'public-linked-upload.txt',
      mimeType: 'text/plain',
      bytes: v2Bytes('public linked execution file payload'),
      url: e2eMock.url(path),
      requestName: 'v2 public linked asset executable request',
      textFields: [{ key: 'scenario', value: 'public-linked-execution' }],
    });
    await connectAndBranchV2(app, host, branch, tracker);

    const setup = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        await api.disconnectGitHubSession();
        const link = await api.linkPublicWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const stateAfterLink = window.__apicircleStore!.getState() as any;
        const snapshot = stateAfterLink.local.linkedCollections[link.id];
        const linkedRequest = Object.values(snapshot.collections.requests)[0] as any;
        const planId = api.addPlan('v2 public linked asset execution plan');
        api.addPlanStep(planId, linkedRequest.id, link.id);
        (window as any).__v2PublicLinkedAssetPlanRun = api.runPlan(planId);
        return {
          hasWorkspaceSession: !!stateAfterLink.local.sessions.github.workspace,
          linkId: link.id,
          planId,
          linkedRequestId: linkedRequest.id,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );
    expect(setup.hasWorkspaceSession).toBe(false);

    const dialog = app.getByRole('dialog', {
      name: /Download attachments before running this plan/,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('public-linked-upload.txt')).toBeVisible();
    await app.getByRole('button', { name: /Download and continue/ }).click();
    await expect(dialog).toBeHidden();

    const result = await app.evaluate(
      async ({ planId }) => {
        const planRun = await (window as any).__v2PublicLinkedAssetPlanRun;
        const api = window.__apicircleStore!.getState() as any;
        const detail = api.lastPlanResults[planId]?.[0];
        const attachmentCache = api.local.attachmentCache?.['v2-exec-public-linked-file'] ?? null;
        return {
          planStepPassed: planRun.steps[0]?.passed ?? false,
          resultStatus: detail?.result?.status ?? null,
          resultOk: detail?.result?.ok ?? false,
          attachmentLocalPath: attachmentCache?.localPath ?? null,
        };
      },
      { planId: setup.planId },
    );

    expect(result.attachmentLocalPath).toContain('indexeddb://apicircle-attachments/');
    expect(result.planStepPassed).toBe(true);
    expect(result.resultOk).toBe(true);
    expect(result.resultStatus).toBe(200);
    const wire = await e2eMock.findLastByPath((capturedPath) => capturedPath === path, {
      timeout: 10_000,
    });
    expect(wire.method).toBe('POST');
    expect(wire.body.kind).toBe('multipart');
    if (wire.body.kind === 'multipart') {
      expect(
        wire.body.parts.some(
          (part) =>
            part.name === 'upload' &&
            part.filename === 'public-linked-upload.txt' &&
            part.bytes === 'public linked execution file payload'.length,
        ),
      ).toBe(true);
    }
  });
});
