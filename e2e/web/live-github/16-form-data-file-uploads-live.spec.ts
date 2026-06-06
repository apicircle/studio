import { expect, test } from '../fixtures/app';
import {
  attachmentBlobPathV2,
  connectAndBranchV2,
  createV2HostRepo,
  createV2Tracker,
  fetchRepoFileBytesV2,
  getV2BotConfig,
  makeV2BranchName,
  pushAndFetchWorkspaceV2,
  sha256HexV2,
  v2Bytes,
  v2SkipReason,
} from './_helpers';

// Live GitHub coverage for the two file-upload flows in the Workspace
// surface that previously had no end-to-end pin:
//
//   1. Global Assets sidebar upload + bind-from-form-data
//      (`addGlobalFileAsset` -> `setFormRowGlobalFileAsset`)
//   2. Direct file upload in a form-data row
//      (`attachFormFile`, which mints a private per-row slot — NOT
//      auto-registered as a Global Asset; this spec pins that
//      behaviour explicitly so a future regression that silently
//      promotes the row to a Global Asset would fail loudly here.)
//
// Both attachments must round-trip through a real push: the per-row
// slot bytes land at `.apicircle/attachments/<slotId>` and the synced
// doc carries the correct form-row bindings (one with
// `globalFileAssetId`, one slot-only).

test.describe('Live GitHub - form-data + Global Assets file uploads @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('uploads a Global Asset, binds it to a form-data row, direct-uploads another file in the same body, and pushes both blobs to the remote', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'form-data-file-uploads');
    const branch = makeV2BranchName(test.info().workerIndex, 'form-data-file-uploads');

    // Two distinct payloads so we can tell them apart in the asserts.
    // The Global Asset payload represents a reusable file the user uploads
    // via the Assets sidebar; the direct payload represents a one-off file
    // dropped straight into a form-data row.
    const globalBytes = v2Bytes('global assets sidebar upload payload');
    const directBytes = v2Bytes('direct form-data row upload payload (not promoted to global)');

    await connectAndBranchV2(app, host, branch, tracker);

    const setup = await app.evaluate(
      async ({ globalPayload, directPayload }) => {
        const api = window.__apicircleStore!.getState() as any;

        // Flow #1 — Global Assets sidebar upload.
        const fileAssetId = await api.addGlobalFileAsset(
          new File([new Uint8Array(globalPayload)], 'global-payload.txt', { type: 'text/plain' }),
          { name: 'Reusable payload (from Global Assets)' },
        );

        // Build a request whose body has THREE rows: one text field, one
        // file row backed by the Global Asset, one file row that gets a
        // direct upload via `attachFormFile`. The text row is included to
        // confirm row coexistence under attachment churn.
        const requestId = api.addRequest(null, 'form-data with global + direct file uploads');
        api.setRequestMethod(requestId, 'POST');
        api.setRequestUrl(requestId, 'https://api.example.test/v2/multipart-upload');
        api.setRequestBody(requestId, {
          type: 'form-data',
          content: '',
          formRows: [
            { kind: 'text', key: 'caller', value: 'live-github-e2e', enabled: true },
            { kind: 'file', key: 'shared-file', enabled: true, slotId: null },
            { kind: 'file', key: 'one-off-file', enabled: true, slotId: null },
          ],
        });

        // Bind row #1 to the Global Asset (mimics picking it from the
        // "Use existing global file" affordance in the form-data row UI).
        await api.setFormRowGlobalFileAsset(requestId, 1, fileAssetId);

        // Flow #2 — direct upload into row #2. The action mints a fresh
        // slotId, writes the blob to IndexedDB, and reshapes the row to
        // carry the file metadata. It does NOT register the file as a
        // Global Asset — the row is the only reference.
        await api.attachFormFile(
          requestId,
          2,
          new File([new Uint8Array(directPayload)], 'direct-payload.txt', { type: 'text/plain' }),
        );

        const state = window.__apicircleStore!.getState() as any;
        const globalRow = state.synced.collections.requests[requestId].body.formRows[1];
        const directRow = state.synced.collections.requests[requestId].body.formRows[2];
        const fileAsset = state.synced.globalAssets.files[fileAssetId];

        // Snapshot the Global Assets registry so we can assert the
        // direct-upload slot is NOT also present there.
        const globalAssetSlotIds = Object.values(state.synced.globalAssets.files ?? {}).map(
          (f: any) => f.slotId,
        );

        const push = await api.pushWorkspace(
          'e2e live: push form-data global + direct file uploads',
        );

        return {
          requestId,
          fileAssetId,
          fileAsset,
          globalRow,
          directRow,
          globalAssetSlotIds,
          commitSha: push.commitSha,
        };
      },
      {
        globalPayload: Array.from(globalBytes),
        directPayload: Array.from(directBytes),
      },
    );

    // ----- In-memory shape assertions ---------------------------------

    expect(setup.commitSha).toMatch(/^[a-f0-9]{40}$/);

    // The Global Asset entry exists with the bytes' true sha256.
    expect(setup.fileAsset).toMatchObject({
      id: setup.fileAssetId,
      name: 'Reusable payload (from Global Assets)',
      filename: 'global-payload.txt',
      mimeType: 'text/plain',
      size: globalBytes.length,
      sha256: sha256HexV2(globalBytes),
    });

    // Row #1 carries the Global Asset binding AND mirrors its slot.
    expect(setup.globalRow).toMatchObject({
      kind: 'file',
      key: 'shared-file',
      enabled: true,
      globalFileAssetId: setup.fileAssetId,
      slotId: setup.fileAsset.slotId,
      filename: 'global-payload.txt',
      mimeType: 'text/plain',
      size: globalBytes.length,
      sha256: sha256HexV2(globalBytes),
    });

    // Row #2 — direct upload via `attachFormFile`. With the unified
    // upload flow (1.0.9 Global Asset provenance work), every direct
    // file drop ALSO mints a Global Asset entry, so the row carries
    // `globalFileAssetId` like row #1 but pointing at a separate
    // auto-named asset.
    expect(setup.directRow.kind).toBe('file');
    expect(setup.directRow.key).toBe('one-off-file');
    expect(setup.directRow.enabled).toBe(true);
    expect(setup.directRow.slotId).toEqual(expect.any(String));
    expect(setup.directRow.slotId).not.toBe(setup.fileAsset.slotId);
    expect(setup.directRow.globalFileAssetId).toEqual(expect.any(String));
    expect(setup.directRow.globalFileAssetId).not.toBe(setup.fileAssetId);
    expect(setup.directRow.filename).toBe('direct-payload.txt');
    expect(setup.directRow.size).toBe(directBytes.length);
    expect(setup.directRow.sha256).toBe(sha256HexV2(directBytes));

    // BOTH slots appear in the Global Assets library now — the direct
    // upload became a discoverable asset alongside the sidebar upload.
    expect(setup.globalAssetSlotIds).toContain(setup.fileAsset.slotId);
    expect(setup.globalAssetSlotIds).toContain(setup.directRow.slotId);

    // After the push, the direct-upload asset has its workingBranchRef
    // stamped (provenance state machine: "On working branch").
    const directAssetAfterPush = await app.evaluate(
      ({ assetId }) => {
        const api = window.__apicircleStore!.getState() as any;
        const a = api.synced.globalAssets.files[assetId];
        return a
          ? {
              workingBranchRef: a.workingBranchRef ?? null,
              baseBranchRef: a.baseBranchRef ?? null,
            }
          : null;
      },
      { assetId: setup.directRow.globalFileAssetId },
    );
    expect(directAssetAfterPush?.workingBranchRef?.branchName).toBe(branch);
    expect(directAssetAfterPush?.workingBranchRef?.blobSha).toMatch(/^[a-f0-9]{40}$/);
    expect(directAssetAfterPush?.baseBranchRef ?? null).toBeNull();

    // ----- Remote / push assertions -----------------------------------

    // Re-fetch the just-pushed workspace.json from .apicircle/workspace.json
    // and verify the bindings landed verbatim.
    const remote = await pushAndFetchWorkspaceV2(
      app,
      host,
      branch,
      'e2e live: confirm form-data file uploads on remote',
    );

    expect(remote.globalAssets.files[setup.fileAssetId]).toMatchObject({
      name: 'Reusable payload (from Global Assets)',
      filename: 'global-payload.txt',
      slotId: setup.fileAsset.slotId,
      size: globalBytes.length,
      sha256: sha256HexV2(globalBytes),
    });

    const remoteFormRows: Array<Record<string, any>> =
      remote.collections.requests[setup.requestId].body.formRows;
    expect(remoteFormRows).toHaveLength(3);

    // Row #0 — text field stays untouched.
    expect(remoteFormRows[0]).toMatchObject({
      kind: 'text',
      key: 'caller',
      value: 'live-github-e2e',
      enabled: true,
    });

    // Row #1 — Global-Asset-backed file row.
    expect(remoteFormRows[1]).toMatchObject({
      kind: 'file',
      key: 'shared-file',
      enabled: true,
      globalFileAssetId: setup.fileAssetId,
      slotId: setup.fileAsset.slotId,
    });

    // Row #2 — direct-upload file row, bound to its auto-minted Global Asset.
    expect(remoteFormRows[2]).toMatchObject({
      kind: 'file',
      key: 'one-off-file',
      enabled: true,
      slotId: setup.directRow.slotId,
      globalFileAssetId: setup.directRow.globalFileAssetId,
      filename: 'direct-payload.txt',
      size: directBytes.length,
      sha256: sha256HexV2(directBytes),
    });
    // The direct-upload asset is on the remote registry with its
    // workingBranchRef set to the working branch (provenance roundtrip).
    expect(remote.globalAssets.files[setup.directRow.globalFileAssetId!]).toMatchObject({
      filename: 'direct-payload.txt',
      slotId: setup.directRow.slotId,
      size: directBytes.length,
      sha256: sha256HexV2(directBytes),
      workingBranchRef: expect.objectContaining({ branchName: branch }),
    });

    // Both attachment blobs land at .apicircle/attachments/<slotId> on
    // the remote and the bytes round-trip unchanged — this is what
    // "the file is transmitted along the request" guarantees for any
    // downstream consumer (CLI run, MCP execute, another Studio
    // refreshing the workspace).
    const remoteGlobalBytes = await fetchRepoFileBytesV2(
      host,
      branch,
      attachmentBlobPathV2(setup.fileAsset.slotId),
    );
    expect(Array.from(remoteGlobalBytes)).toEqual(Array.from(globalBytes));

    const remoteDirectBytes = await fetchRepoFileBytesV2(
      host,
      branch,
      attachmentBlobPathV2(setup.directRow.slotId),
    );
    expect(Array.from(remoteDirectBytes)).toEqual(Array.from(directBytes));
  });
});
