import { summarizeUnpushedChanges } from '@apicircle/core';
import { expect, test } from '../fixtures/app';
import {
  attachmentBlobPathV2,
  assertRemoteWorkspaceHasNoLocalOnlyData,
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  fetchRepoFileBytesV2,
  fetchWorkspaceJson,
  getV2BotConfig,
  makeV2BranchName,
  pushAndFetchWorkspaceV2,
  sha256HexV2,
  updateWorkspaceJson,
  v2Bytes,
  v2SkipReason,
  waitForRepoFileAbsentV2,
} from './_helpers';

const SOURCE_SCHEMA_ID = 'v2-source-json-schema';
const SOURCE_GRAPHQL_ID = 'v2-source-graphql-schema';

function summary(pair: { base: any; current: any }) {
  return summarizeUnpushedChanges(pair.base, pair.current, {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
}

test.describe('Live GitHub - global assets through linked workspaces @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('JSON Schema, GraphQL, and file assets push, link, cache, and keep request references intact', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'global-assets-host');
    const source = await createV2SourceRepo(tracker, bot, 'global-assets-source', 'private');
    const branch = makeV2BranchName(test.info().workerIndex, 'global-assets');
    const fileBytes = v2Bytes('consumer reusable global file asset');
    await updateWorkspaceJson(source.cfg, source.branch, 'e2e live: source global assets', (ws) => {
      const typed = ws as Record<string, any>;
      typed.globalAssets = {
        schemas: {
          [SOURCE_SCHEMA_ID]: {
            id: SOURCE_SCHEMA_ID,
            name: 'Source User JSON',
            description: 'schema from linked source',
            schema: JSON.stringify({
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' } },
            }),
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        graphql: {
          [SOURCE_GRAPHQL_ID]: {
            id: SOURCE_GRAPHQL_ID,
            name: 'Source GraphQL',
            description: 'graphql from linked source',
            kind: 'sdl',
            source: 'type Query { sourceUser(id: ID!): SourceUser } type SourceUser { id: ID! }',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      };
      const req = Object.values(typed.collections.requests)[0] as any;
      req.bodySchemaId = SOURCE_SCHEMA_ID;
      req.graphqlSchemaId = SOURCE_GRAPHQL_ID;
      req.body = {
        type: 'graphql',
        content: 'query SourceUser($id: ID!) { sourceUser(id: $id) { id } }',
        variables: '{"id":"42"}',
      };
    });

    await connectAndBranchV2(app, host, branch, tracker);
    const linked = await app.evaluate(
      async ({ repoFullName, sourceBranch, sourceSchemaId, sourceGraphqlId, payload }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const schemaId = api.addGlobalSchema({
          name: 'Consumer Order JSON',
          schema: JSON.stringify({ type: 'object', properties: { orderId: { type: 'string' } } }),
        });
        const graphqlId = api.addGlobalGraphQL({
          name: 'Consumer GraphQL',
          source: 'type Query { order(id: ID!): Order } type Order { id: ID! }',
        });
        const fileAssetId = await api.addGlobalFileAsset(
          new File([new Uint8Array(payload)], 'consumer-payload.txt', { type: 'text/plain' }),
          { name: 'Consumer payload file' },
        );
        const requestId = api.addRequest(null, 'consumer asset request');
        api.setRequestBody(requestId, {
          type: 'graphql',
          content: 'query Order($id: ID!) { order(id: $id) { id } }',
          variables: '{"id":"o-1"}',
        });
        api.setRequestBodySchemaId(requestId, schemaId);
        api.setRequestGraphqlSchemaId(requestId, graphqlId);
        const binaryRequestId = api.addRequest(null, 'consumer file asset request');
        await api.setBinaryGlobalFileAsset(binaryRequestId, fileAssetId);
        const formRequestId = api.addRequest(null, 'consumer form file asset request');
        api.setRequestBody(formRequestId, {
          type: 'form-data',
          content: '',
          formRows: [{ kind: 'file', key: 'upload', enabled: true, slotId: null }],
        });
        await api.setFormRowGlobalFileAsset(formRequestId, 0, fileAssetId);
        const { id: mockId } = await api.createMockServer({
          name: 'consumer global file mock',
          source: { kind: 'manual', endpoints: [] },
        });
        const mockEndpointId = api.addMockEndpoint(mockId);
        api.updateMockEndpoint(mockId, mockEndpointId, {
          name: 'GET consumer payload file',
          method: 'GET',
          pathPattern: '/payload',
        });
        await api.setMockResponseGlobalFileAsset(mockId, mockEndpointId, fileAssetId);
        const state = window.__apicircleStore!.getState() as any;
        const fileAsset = state.synced.globalAssets.files[fileAssetId];
        const mockBody = state.synced.mockServers[mockId].endpoints.find(
          (endpoint: any) => endpoint.id === mockEndpointId,
        ).defaultResponse.body;
        const snapshot = state.local.linkedCollections[link.id];
        const linkedReq = Object.values(snapshot.collections.requests)[0] as any;
        return {
          ids: {
            linkId: link.id,
            requestId,
            binaryRequestId,
            formRequestId,
            mockId,
            mockEndpointId,
            schemaId,
            graphqlId,
            fileAssetId,
          },
          fileAsset,
          formRow: state.synced.collections.requests[formRequestId].body.formRows[0],
          mockBody,
          linked: {
            schemaPresent: !!snapshot.globalAssets?.schemas?.[sourceSchemaId],
            graphqlPresent: !!snapshot.globalAssets?.graphql?.[sourceGraphqlId],
            requestSchemaId: linkedReq.bodySchemaId,
            requestGraphqlId: linkedReq.graphqlSchemaId,
          },
          pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
        };
      },
      {
        repoFullName: source.cfg.fullName,
        sourceBranch: source.branch,
        sourceSchemaId: SOURCE_SCHEMA_ID,
        sourceGraphqlId: SOURCE_GRAPHQL_ID,
        payload: Array.from(fileBytes),
      },
    );

    expect(linked.linked.schemaPresent).toBe(true);
    expect(linked.linked.graphqlPresent).toBe(true);
    expect(linked.linked.requestSchemaId).toBe(SOURCE_SCHEMA_ID);
    expect(linked.linked.requestGraphqlId).toBe(SOURCE_GRAPHQL_ID);
    expect(summary(linked.pair).changes.some((change) => change.bucket === 'globalSchema')).toBe(
      true,
    );
    expect(summary(linked.pair).changes.some((change) => change.bucket === 'globalGraphql')).toBe(
      true,
    );
    expect(summary(linked.pair).changes.some((change) => change.bucket === 'globalFile')).toBe(
      true,
    );
    expect(linked.fileAsset.filename).toBe('consumer-payload.txt');
    expect(linked.fileAsset.sha256).toBe(sha256HexV2(fileBytes));
    expect(linked.formRow.globalFileAssetId).toBe(linked.ids.fileAssetId);
    expect(linked.formRow.slotId).toBe(linked.fileAsset.slotId);
    expect(linked.mockBody.attachment.globalFileAssetId).toBe(linked.ids.fileAssetId);
    expect(linked.mockBody.attachment.slotId).toBe(linked.fileAsset.slotId);

    const remote = await pushAndFetchWorkspaceV2(app, host, branch, 'e2e live: global assets');
    assertRemoteWorkspaceHasNoLocalOnlyData(remote);
    expect(remote.globalAssets.schemas[linked.ids.schemaId]).toBeDefined();
    expect(remote.globalAssets.graphql[linked.ids.graphqlId]).toBeDefined();
    expect(remote.globalAssets.files[linked.ids.fileAssetId]).toMatchObject({
      name: 'Consumer payload file',
      filename: 'consumer-payload.txt',
      slotId: linked.fileAsset.slotId,
    });
    expect(remote.collections.requests[linked.ids.requestId].bodySchemaId).toBe(
      linked.ids.schemaId,
    );
    expect(remote.collections.requests[linked.ids.requestId].graphqlSchemaId).toBe(
      linked.ids.graphqlId,
    );
    expect(
      remote.collections.requests[linked.ids.binaryRequestId].body.attachment.globalFileAssetId,
    ).toBe(linked.ids.fileAssetId);
    expect(
      remote.collections.requests[linked.ids.formRequestId].body.formRows[0].globalFileAssetId,
    ).toBe(linked.ids.fileAssetId);
    const remoteMockEndpoint = remote.mockServers[linked.ids.mockId].endpoints.find(
      (endpoint: any) => endpoint.id === linked.ids.mockEndpointId,
    );
    expect(remoteMockEndpoint.defaultResponse.body.attachment.globalFileAssetId).toBe(
      linked.ids.fileAssetId,
    );
    expect(remoteMockEndpoint.defaultResponse.body.attachment.slotId).toBe(linked.fileAsset.slotId);
    expect(JSON.stringify(remote)).not.toContain('linkedCollections');
    const hostWorkspaceId = remote.workspaceId as string;
    const remoteBytes = await fetchRepoFileBytesV2(
      host,
      branch,
      attachmentBlobPathV2(linked.fileAsset.slotId, hostWorkspaceId),
    );
    expect(Array.from(remoteBytes)).toEqual(Array.from(fileBytes));

    // ----- Provenance state-machine transitions -----------------------
    //
    // Right after the push, the consumer asset should be in the
    // "workingOnly" state — workingBranchRef stamped, baseBranchRef
    // null. Pin that.
    const provenanceAfterPush = await app.evaluate(
      ({ assetId }) => {
        const api = window.__apicircleStore!.getState() as any;
        const a = api.synced.globalAssets.files[assetId];
        return {
          workingBranchRef: a.workingBranchRef ?? null,
          baseBranchRef: a.baseBranchRef ?? null,
        };
      },
      { assetId: linked.ids.fileAssetId },
    );
    expect(provenanceAfterPush.workingBranchRef?.branchName).toBe(branch);
    expect(provenanceAfterPush.workingBranchRef?.blobSha).toMatch(/^[a-f0-9]{40}$/);
    expect(provenanceAfterPush.baseBranchRef).toBeNull();

    // Synthesize a PR merge: write the same workspace.json + the
    // attachment blob to the host's default (base) branch. The
    // verifyAssetRefs probe should then detect the file on base and
    // run the cleanup invariant.
    const defaultBranch = 'main';
    await updateWorkspaceJson(host, defaultBranch, 'e2e live: synthetic merge to base', (ws) => {
      // Replace the base branch's workspace.json with the consumer's
      // current synced doc so the asset entry exists on base.
      Object.assign(ws as Record<string, unknown>, remote);
    });
    // Write the attachment blob to base under .apicircle/workspace-<id>/attachments/<slotId>.
    {
      const blobPath = attachmentBlobPathV2(linked.fileAsset.slotId, hostWorkspaceId);
      const probeUrl = `https://api.github.com/repos/${host.owner}/${host.name}/contents/${blobPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(defaultBranch)}`;
      const probe = await fetch(probeUrl, {
        headers: {
          Authorization: `Bearer ${host.token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const existing = probe.ok ? ((await probe.json()) as { sha?: string }) : null;
      const putUrl = `https://api.github.com/repos/${host.owner}/${host.name}/contents/${blobPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${host.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'e2e live: synthetic merge attachment',
          content: Buffer.from(fileBytes).toString('base64'),
          branch: defaultBranch,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        }),
      });
      expect(putRes.ok).toBe(true);
    }

    // Refresh in the studio — verifyAssetRefs probes working ref (still
    // valid, same blob sha) AND opportunistically probes base (which
    // now has the file). When both refs hold the same blob sha, the
    // cleanup invariant drops workingBranchRef.
    const provenanceAfterMerge = await app.evaluate(
      async ({ assetId }) => {
        const api = window.__apicircleStore!.getState() as any;
        await api.refreshWorkspace();
        const a = window.__apicircleStore!.getState().synced!.globalAssets.files![assetId];
        return {
          workingBranchRef: a.workingBranchRef ?? null,
          baseBranchRef: a.baseBranchRef ?? null,
        };
      },
      { assetId: linked.ids.fileAssetId },
    );
    // Base ref is set after the merge.
    expect(provenanceAfterMerge.baseBranchRef?.branchName).toBe(defaultBranch);
    expect(provenanceAfterMerge.baseBranchRef?.blobSha).toMatch(/^[a-f0-9]{40}$/);
    // Cleanup invariant: same blob sha on both refs → working ref dropped.
    expect(provenanceAfterMerge.workingBranchRef).toBeNull();

    const modified = await app.evaluate(
      async ({ ids }) => {
        const api = window.__apicircleStore!.getState() as any;
        api.updateGlobalFileAsset(ids.fileAssetId, { name: 'Consumer payload file renamed' });
        const state = window.__apicircleStore!.getState() as any;
        return {
          pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
        };
      },
      { ids: linked.ids },
    );
    expect(summary(modified.pair).changes.some((change) => change.bucket === 'globalFile')).toBe(
      true,
    );
    const renamedRemote = await pushAndFetchWorkspaceV2(
      app,
      host,
      branch,
      'e2e live: rename global file asset',
    );
    expect(renamedRemote.globalAssets.files[linked.ids.fileAssetId].name).toBe(
      'Consumer payload file renamed',
    );

    const removed = await app.evaluate(
      async ({ ids }) => {
        const api = window.__apicircleStore!.getState() as any;
        await api.removeGlobalFileAsset(ids.fileAssetId);
        const state = window.__apicircleStore!.getState() as any;
        const binaryBody = state.synced.collections.requests[ids.binaryRequestId].body;
        const formRow = state.synced.collections.requests[ids.formRequestId].body.formRows[0];
        const mockBody = state.synced.mockServers[ids.mockId].endpoints.find(
          (endpoint: any) => endpoint.id === ids.mockEndpointId,
        ).defaultResponse.body;
        return {
          binaryBody,
          formRow,
          mockBody,
          pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
        };
      },
      { ids: linked.ids },
    );
    expect(summary(removed.pair).changes.some((change) => change.bucket === 'globalFile')).toBe(
      true,
    );
    expect(removed.binaryBody).toEqual({ type: 'binary', content: '' });
    expect(removed.formRow).toMatchObject({ kind: 'file', slotId: null });
    expect(removed.formRow.globalFileAssetId).toBeUndefined();
    expect(removed.mockBody).toEqual({ type: 'binary', content: '' });
    const removedRemote = await pushAndFetchWorkspaceV2(
      app,
      host,
      branch,
      'e2e live: remove global file asset',
    );
    expect(removedRemote.globalAssets.files[linked.ids.fileAssetId]).toBeUndefined();
    expect(removedRemote.collections.requests[linked.ids.binaryRequestId].body).toEqual({
      type: 'binary',
      content: '',
    });
    expect(
      removedRemote.collections.requests[linked.ids.formRequestId].body.formRows[0],
    ).toMatchObject({
      kind: 'file',
      slotId: null,
    });
    const removedRemoteMockEndpoint = removedRemote.mockServers[linked.ids.mockId].endpoints.find(
      (endpoint: any) => endpoint.id === linked.ids.mockEndpointId,
    );
    expect(removedRemoteMockEndpoint.defaultResponse.body).toEqual({ type: 'binary', content: '' });

    // ----- Attachment blob deletion on the remote ---------------------
    //
    // The bug this pins: removing a Global File Asset must also remove
    // the orphan blob from `.apicircle/workspace-<id>/attachments/<slotId>` on the
    // working branch. Without the `pendingAttachmentDeletes` queue + the
    // push-side `{path, sha: null}` tree entries, the blob would
    // persist on the remote tree forever — the PR merge would then
    // carry the orphan into the base branch too. After the post-delete
    // push above, the blob is gone from the working branch; the
    // pendingAttachmentDeletes queue is cleared.
    {
      const blobPath = attachmentBlobPathV2(linked.fileAsset.slotId, hostWorkspaceId);
      // Poll until the blob is gone from the branch-ref tree. The delete push
      // above fetched workspace.json by commit SHA, so the branch-ref replica
      // can still serve the pre-delete tree (blob 200) for a beat — a bare
      // `expect(status).toBe(404)` would race that window.
      await waitForRepoFileAbsentV2(host, branch, blobPath);
    }

    // Local queue must be empty — the push consumed it.
    const queueAfterDeletePush = await app.evaluate(
      () => (window.__apicircleStore!.getState() as any).local.pendingAttachmentDeletes ?? [],
    );
    expect(queueAfterDeletePush).toEqual([]);

    // ----- PR-merge propagation to base branch ------------------------
    //
    // Simulate the post-delete PR merge: copy the now-clean working
    // branch's workspace.json onto the base branch AND issue a Contents
    // API delete for the attachment blob on the base branch (so the
    // base branch matches the post-merge state). After this, the blob
    // is gone from both refs — exactly what the user expects when they
    // delete and the merge lands.
    {
      // Sync workspace.json onto base — it no longer references the asset.
      await updateWorkspaceJson(
        host,
        defaultBranch,
        'e2e live: synthetic merge of delete to base',
        (ws) => {
          Object.assign(ws as Record<string, unknown>, removedRemote);
        },
      );
      // Delete the attachment blob on base via the Contents API.
      const blobPath = attachmentBlobPathV2(linked.fileAsset.slotId, hostWorkspaceId);
      const probeUrl = `https://api.github.com/repos/${host.owner}/${host.name}/contents/${blobPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(defaultBranch)}`;
      const probe = await fetch(probeUrl, {
        headers: {
          Authorization: `Bearer ${host.token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const sha = probe.ok ? ((await probe.json()) as { sha?: string }).sha : null;
      if (sha) {
        const deleteUrl = `https://api.github.com/repos/${host.owner}/${host.name}/contents/${blobPath
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;
        const delRes = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${host.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: 'e2e live: synthetic merge of attachment deletion',
            sha,
            branch: defaultBranch,
          }),
        });
        expect(delRes.ok).toBe(true);
      }

      // Verify the blob is now ALSO gone from the base branch.
      const checkUrl = `https://api.github.com/repos/${host.owner}/${host.name}/contents/${blobPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(defaultBranch)}`;
      const checkRes = await fetch(checkUrl, {
        headers: {
          Authorization: `Bearer ${host.token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      expect(checkRes.status).toBe(404);
    }

    const refreshed = await app.evaluate(
      async ({ ids, sourceSchemaId, sourceGraphqlId }) => {
        const api = window.__apicircleStore!.getState() as any;
        const refresh = await api.refreshWorkspace();
        const state = window.__apicircleStore!.getState() as any;
        const snapshot = state.local.linkedCollections[ids.linkId];
        return {
          status: refresh.status,
          schemaStillPresent: !!snapshot.globalAssets?.schemas?.[sourceSchemaId],
          graphqlStillPresent: !!snapshot.globalAssets?.graphql?.[sourceGraphqlId],
          pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
        };
      },
      { ids: linked.ids, sourceSchemaId: SOURCE_SCHEMA_ID, sourceGraphqlId: SOURCE_GRAPHQL_ID },
    );
    expect(['up-to-date', 'merged']).toContain(refreshed.status);
    expect(refreshed.schemaStillPresent).toBe(true);
    expect(refreshed.graphqlStillPresent).toBe(true);
    expect(summary(refreshed.pair).total).toBe(0);
    const sourceRemote = (await fetchWorkspaceJson(source.cfg, source.branch)).json as Record<
      string,
      any
    >;
    expect(sourceRemote.globalAssets.schemas[SOURCE_SCHEMA_ID]).toBeDefined();
  });
});
