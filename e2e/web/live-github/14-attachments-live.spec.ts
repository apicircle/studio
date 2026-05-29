import { expect, test } from '../fixtures/app';
import {
  attachmentBlobPathV2,
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  fetchRepoFileBytesV2,
  getV2BotConfig,
  makeV2BranchName,
  seedSourceAttachmentRequestV2,
  sha256HexV2,
  updateWorkspaceJson,
  v2Bytes,
  v2SkipReason,
} from './_helpers';

test.describe('Live GitHub - attachment blob transmission @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  test('current workspace attachment pushes as a Git blob and rehydrates on another branch', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'attachments-host');
    const branch = makeV2BranchName(test.info().workerIndex, 'attachments-source-branch');
    const cloneBranch = makeV2BranchName(test.info().workerIndex, 'attachments-clone-branch');
    const bytes = v2Bytes('v2 host attachment payload');
    await connectAndBranchV2(app, host, branch, tracker);

    const pushed = await app.evaluate(
      async ({ payload }) => {
        const api = window.__apicircleStore!.getState() as any;
        const requestId = api.addRequest(null, 'v2 host binary attachment');
        api.setRequestMethod(requestId, 'POST');
        api.setRequestUrl(requestId, 'https://api.example.test/v2/attachment');
        await api.attachBinaryFile(
          requestId,
          new File([new Uint8Array(payload)], 'host-payload.txt', { type: 'text/plain' }),
        );
        const state = window.__apicircleStore!.getState() as any;
        const attachment = state.synced.collections.requests[requestId].body.attachment;
        const push = await api.pushWorkspace('e2e live: push host attachment');
        return { requestId, attachment, commitSha: push.commitSha };
      },
      { payload: Array.from(bytes) },
    );
    expect(pushed.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(pushed.attachment.filename).toBe('host-payload.txt');
    expect(pushed.attachment.sha256).toBe(sha256HexV2(bytes));

    const remoteBytes = await fetchRepoFileBytesV2(
      host,
      branch,
      attachmentBlobPathV2(pushed.attachment.slotId),
    );
    expect(Array.from(remoteBytes)).toEqual(Array.from(bytes));

    const cloned = await app.evaluate(
      async ({ token, owner, name, cloneBranchName, baseBranch, requestId, slotId }) => {
        const deleteAttachmentRecord = (id: string) =>
          new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('apicircle-attachments', 1);
            open.onupgradeneeded = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
            };
            open.onerror = () => reject(open.error ?? new Error('attachments DB open failed'));
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('blobs', 'readwrite');
              tx.objectStore('blobs').delete(id);
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                reject(tx.error ?? new Error('attachment delete failed'));
              };
            };
          });

        const api = window.__apicircleStore!.getState() as any;
        await api.createNewWorkspace('v2 attachment clone workspace');
        await api.connectGitHubSession(token);
        await api.connectRepo(owner, name);
        const branch = await api.createWorkingBranch({ branchName: cloneBranchName, baseBranch });
        let refresh = await api.refreshWorkspace();
        if (refresh.status === 'conflicts') {
          const pending = (window.__apicircleStore!.getState() as any).pendingRefresh;
          const resolutions: Record<string, 'theirs'> = {};
          for (const entry of pending.diff.conflicts)
            resolutions[`${entry.bucket}:${entry.key}`] = 'theirs';
          await api.commitRefresh(resolutions);
          refresh = { status: 'conflicts-applied' };
        }
        await deleteAttachmentRecord(slotId);
        const sync = await api.syncAttachments();
        const state = window.__apicircleStore!.getState() as any;
        const request = state.synced.collections.requests[requestId];
        return {
          branchName: branch.name,
          refreshStatus: refresh.status,
          sync,
          requestPresent: !!request,
          slotId: request?.body?.attachment?.slotId ?? null,
        };
      },
      {
        token: bot.token,
        owner: host.owner,
        name: host.name,
        cloneBranchName: cloneBranch,
        baseBranch: branch,
        requestId: pushed.requestId,
        slotId: pushed.attachment.slotId,
      },
    );
    tracker.trackBranch(host, cloneBranch);
    expect(cloned.branchName).toBe(cloneBranch);
    expect(['up-to-date', 'merged', 'conflicts-applied']).toContain(cloned.refreshStatus);
    expect(cloned.requestPresent).toBe(true);
    expect(cloned.slotId).toBe(pushed.attachment.slotId);
    expect(cloned.sync).toEqual({ fetched: 1, alreadyPresent: 0, failed: 0 });
  });

  test('private linked source attachment downloads through the workspace GitHub session', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'private-linked-attachment-host');
    const source = await createV2SourceRepo(
      tracker,
      bot,
      'private-linked-attachment-source',
      'private',
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'private-linked-attachment');
    const sourceBytes = v2Bytes('private linked source attachment');
    await seedSourceAttachmentRequestV2(source, {
      slotId: 'v2-private-linked-file',
      filename: 'private-source.txt',
      mimeType: 'text/plain',
      bytes: sourceBytes,
      requestName: 'v2 private linked attachment request',
    });
    await connectAndBranchV2(app, host, branch, tracker);

    const result = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        const request = Object.values(
          state.local.linkedCollections[link.id].collections.requests,
        )[0] as any;
        return {
          linkId: link.id,
          slotId: request.body.formRows.find((row: any) => row.kind === 'file')?.slotId ?? null,
          filename: request.body.formRows.find((row: any) => row.kind === 'file')?.filename ?? null,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );
    expect(result.linkId).toBeTruthy();
    expect(result.slotId).toBe('v2-private-linked-file');
    expect(result.filename).toBe('private-source.txt');

    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await expect(app.getByText('Attachments')).toBeVisible();
    await expect(app.getByText(attachmentSummaryPattern(sourceBytes.length, 1))).toBeVisible();
    await expect(app.getByText('private-source.txt')).toBeVisible();
    await expect(app.getByText('Required by v2 private linked attachment request')).toBeVisible();
    const privateAttachmentList = app.getByLabel(/Attachments required by/);
    await expect(privateAttachmentList.getByText('missing', { exact: true })).toBeVisible();
    await app.getByRole('button', { name: /Download attachments for/ }).click();
    await expect(privateAttachmentList.getByText('downloaded', { exact: true })).toBeVisible();
    await expect(app.getByText(attachmentSummaryPattern(sourceBytes.length, 0))).toBeVisible();
  });

  test('public linked source attachment downloads without an active workspace GitHub session', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'public-linked-attachment-host');
    const source = await createV2SourceRepo(
      tracker,
      bot,
      'public-linked-attachment-source',
      'public',
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'public-linked-attachment');
    const sourceBytes = v2Bytes('public linked source attachment');
    await seedSourceAttachmentRequestV2(source, {
      slotId: 'v2-public-linked-file',
      filename: 'public-source.txt',
      mimeType: 'text/plain',
      bytes: sourceBytes,
      requestName: 'v2 public linked attachment request',
    });
    await connectAndBranchV2(app, host, branch, tracker);

    const result = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        await api.disconnectGitHubSession();
        const link = await api.linkPublicWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        const request = Object.values(
          state.local.linkedCollections[link.id].collections.requests,
        )[0] as any;
        return {
          hasWorkspaceSession: !!state.local.sessions.github.workspace,
          linkId: link.id,
          slotId: request.body.formRows.find((row: any) => row.kind === 'file')?.slotId ?? null,
          filename: request.body.formRows.find((row: any) => row.kind === 'file')?.filename ?? null,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );
    expect(result.hasWorkspaceSession).toBe(false);
    expect(result.linkId).toBeTruthy();
    expect(result.slotId).toBe('v2-public-linked-file');
    expect(result.filename).toBe('public-source.txt');

    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await expect(app.getByText('Attachments')).toBeVisible();
    await expect(app.getByText(attachmentSummaryPattern(sourceBytes.length, 1))).toBeVisible();
    await expect(app.getByText('public-source.txt')).toBeVisible();
    await expect(app.getByText('Required by v2 public linked attachment request')).toBeVisible();
    const publicAttachmentList = app.getByLabel(/Attachments required by/);
    await expect(publicAttachmentList.getByText('missing', { exact: true })).toBeVisible();
    await app.getByRole('button', { name: /Download attachments for/ }).click();
    await expect(publicAttachmentList.getByText('downloaded', { exact: true })).toBeVisible();
    await expect(app.getByText(attachmentSummaryPattern(sourceBytes.length, 0))).toBeVisible();
  });

  test('linked attachment checksum mismatch stays missing and does not cache bytes', async ({
    app,
  }) => {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, 'checksum-linked-attachment-host');
    const source = await createV2SourceRepo(
      tracker,
      bot,
      'checksum-linked-attachment-source',
      'private',
    );
    const branch = makeV2BranchName(test.info().workerIndex, 'checksum-linked-attachment');
    const sourceBytes = v2Bytes('checksum guarded source attachment');
    await seedSourceAttachmentRequestV2(source, {
      slotId: 'v2-checksum-linked-file',
      filename: 'checksum-source.txt',
      mimeType: 'text/plain',
      bytes: sourceBytes,
      requestName: 'v2 checksum linked attachment request',
    });
    await updateWorkspaceJson(
      source.cfg,
      source.branch,
      'e2e live: corrupt attachment checksum',
      (ws) => {
        const req = Object.values((ws as any).collections.requests)[0] as any;
        const row = req.body.formRows.find((item: any) => item.kind === 'file');
        row.sha256 = 'expected-but-wrong';
      },
    );
    await connectAndBranchV2(app, host, branch, tracker);

    const result = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        const sync = await api.syncAttachments();
        const state = window.__apicircleStore!.getState() as any;
        return {
          sync,
          cached: state.local.attachmentCache?.['v2-checksum-linked-file'] ?? null,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );

    expect(result.sync).toEqual({ fetched: 0, alreadyPresent: 0, failed: 1 });
    expect(result.cached).toBeNull();
    await app.getByRole('button', { name: /^Link Workspace$/ }).click();
    await expect(app.getByText(attachmentSummaryPattern(sourceBytes.length, 1))).toBeVisible();
    await expect(app.getByText('checksum-source.txt')).toBeVisible();
    await expect(app.getByText('Required by v2 checksum linked attachment request')).toBeVisible();
    const checksumAttachmentList = app.getByLabel(/Attachments required by/);
    await expect(checksumAttachmentList.getByText('missing', { exact: true })).toBeVisible();
  });
});

function attachmentSummaryPattern(size: number, missing: number): RegExp {
  return new RegExp(`1 file\\s+.*\\s+${size} B\\s+.*\\s+${missing} missing`);
}
