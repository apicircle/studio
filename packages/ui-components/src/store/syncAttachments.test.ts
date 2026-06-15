import { createHash } from 'node:crypto';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAttachment, putAttachment } from '../persistence/attachments';
import { useWorkspaceStore } from './workspaceStore';

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    return fakeResponse(queue[i++]);
  });
}

function fileResponse(bytes: Uint8Array, sha = 'blob-sha'): ResponseSpec {
  const content = Buffer.from(bytes).toString('base64');
  // The path in the response body is metadata — the actual routing is by
  // the fetch URL. Use a per-workspace path to match production.
  const wsId = useWorkspaceStore.getState().synced?.workspaceId ?? 'ws';
  return {
    body: {
      type: 'file',
      path: `.apicircle/workspace-${wsId}/attachments/x`,
      sha,
      size: bytes.length,
      content,
      encoding: 'base64',
    },
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function setupConnectedBranch(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
      {
        body: {
          full_name: 'me/api',
          name: 'api',
          owner: { login: 'me' },
          default_branch: 'main',
          permissions: { push: true, admin: false },
        },
      },
      { body: { name: 'main', commit: { sha: 'sha-main' } } },
      { body: { ref: 'refs/heads/apicircle/wb', object: { sha: 'sha-main' } } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  await useWorkspaceStore.getState().connectRepo('me', 'api');
  await useWorkspaceStore.getState().createWorkingBranch({ branchName: 'apicircle/wb' });
  vi.unstubAllGlobals();
}

describe('workspaceStore.syncAttachments', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when no working branch exists', async () => {
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: {
        slotId: 'needs-branch',
        filename: 'needs-branch.bin',
        mimeType: 'application/octet-stream',
        size: 1,
      },
    });

    await expect(useWorkspaceStore.getState().syncAttachments()).rejects.toThrow(
      /Create a working branch/,
    );
  });

  it('returns zeros when the synced doc has no attachment slots', async () => {
    await setupConnectedBranch();
    const result = await useWorkspaceStore.getState().syncAttachments();
    expect(result).toEqual({ fetched: 0, alreadyPresent: 0, failed: 0 });
  });

  it('fetches missing attachment bytes and persists them to local IDB', async () => {
    await setupConnectedBranch();
    const id = useWorkspaceStore.getState().addRequest(null);
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x42]);
    const digest = sha256(bytes);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: {
        slotId: 'slot-A',
        filename: 'pic.png',
        mimeType: 'image/png',
        size: 4,
        sha256: digest,
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileResponse(bytes, 'blob-A')]));

    const result = await useWorkspaceStore.getState().syncAttachments();
    expect(result.fetched).toBe(1);
    expect(result.alreadyPresent).toBe(0);
    expect(result.failed).toBe(0);

    const stored = await getAttachment('slot-A');
    expect(stored).not.toBeNull();
    expect(Array.from(stored!.bytes)).toEqual(Array.from(bytes));
    expect(stored!.sha256).toBe(digest);
    expect(stored!.filename).toBe('pic.png');
  });

  it('skips slots whose local sha256 already matches the synced ref', async () => {
    await setupConnectedBranch();
    const id = useWorkspaceStore.getState().addRequest(null);
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = sha256(bytes);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: {
        slotId: 'slot-already-present',
        filename: 'doc.bin',
        mimeType: 'application/octet-stream',
        size: 3,
        sha256: digest,
      },
    });
    await putAttachment({
      slotId: 'slot-already-present',
      filename: 'doc.bin',
      mimeType: 'application/octet-stream',
      size: 3,
      sha256: digest,
      savedAt: 'fixed',
      bytes,
    });

    // No fetch should fire — the queue is empty so the sync would crash if
    // the action tried to download anything.
    vi.stubGlobal('fetch', queuedFetch([]));

    const result = await useWorkspaceStore.getState().syncAttachments();
    expect(result).toEqual({ fetched: 0, alreadyPresent: 1, failed: 0 });
  });

  it('counts a 404 as failed without crashing the rest of the sync', async () => {
    await setupConnectedBranch();
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: { slotId: 'gone', filename: 'gone.bin' },
    });
    vi.stubGlobal('fetch', queuedFetch([{ body: { message: 'Not Found' }, status: 404 }]));
    const result = await useWorkspaceStore.getState().syncAttachments();
    expect(result.failed).toBe(1);
    expect(result.fetched).toBe(0);
  });

  it('rejects downloaded bytes whose checksum does not match the synced ref', async () => {
    await setupConnectedBranch();
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: {
        slotId: 'checksum-mismatch',
        filename: 'bad.bin',
        sha256: 'expected-sha',
      },
    });
    vi.stubGlobal('fetch', queuedFetch([fileResponse(new Uint8Array([9, 9, 9]))]));

    const result = await useWorkspaceStore.getState().syncAttachments();

    expect(result).toEqual({ fetched: 0, alreadyPresent: 0, failed: 1 });
    expect(await getAttachment('checksum-mismatch')).toBeNull();
  });

  it('downloads mock response attachments from the current workspace branch', async () => {
    await setupConnectedBranch();
    const serverId = useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Files', source: { kind: 'manual', endpoints: [] } });
    const endpointId = useWorkspaceStore.getState().addMockEndpoint(serverId);
    useWorkspaceStore.getState().updateMockEndpoint(serverId, endpointId, {
      name: 'GET file',
      defaultResponse: {
        status: 200,
        headers: [],
        body: {
          type: 'binary',
          content: '',
          attachment: {
            slotId: 'mock-response-slot',
            filename: 'mock.txt',
            mimeType: 'text/plain',
            size: 3,
          },
        },
      },
    });
    const bytes = new Uint8Array([7, 8, 9]);
    vi.stubGlobal('fetch', queuedFetch([fileResponse(bytes)]));

    const result = await useWorkspaceStore.getState().syncAttachments();

    expect(result).toEqual({ fetched: 1, alreadyPresent: 0, failed: 0 });
    const stored = await getAttachment('mock-response-slot');
    expect(stored?.filename).toBe('mock.txt');
    expect(Array.from(stored!.bytes)).toEqual(Array.from(bytes));
  });

  it('can reuse a global file asset as a mock binary response without deleting the library blob', async () => {
    const fileAssetId = await useWorkspaceStore
      .getState()
      .addGlobalFileAsset(
        new File([new Uint8Array([1, 2, 3])], 'library.txt', { type: 'text/plain' }),
        { name: 'Library file' },
      );
    const asset = useWorkspaceStore.getState().synced!.globalAssets.files?.[fileAssetId];
    if (!asset) throw new Error('Expected global file asset to be present');
    const serverId = useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Files', source: { kind: 'manual', endpoints: [] } });
    const endpointId = useWorkspaceStore.getState().addMockEndpoint(serverId);

    await useWorkspaceStore
      .getState()
      .setMockResponseGlobalFileAsset(serverId, endpointId, fileAssetId);

    const endpoint = useWorkspaceStore.getState().synced!.mockServers[serverId].endpoints[0];
    expect(endpoint.defaultResponse.body.type).toBe('binary');
    if (endpoint.defaultResponse.body.type === 'binary') {
      expect(endpoint.defaultResponse.body.attachment?.globalFileAssetId).toBe(fileAssetId);
      expect(endpoint.defaultResponse.body.attachment?.slotId).toBe(asset.slotId);
    }

    await useWorkspaceStore.getState().detachMockResponseFile(serverId, endpointId);

    expect(await getAttachment(asset.slotId)).not.toBeNull();
    const detached = useWorkspaceStore.getState().synced!.mockServers[serverId].endpoints[0];
    expect(detached.defaultResponse.body).toEqual({ type: 'binary', content: '' });
  });

  it('downloads public linked attachment bytes without an active workspace session', async () => {
    await setupConnectedBranch();
    const local = useWorkspaceStore.getState().local!;
    const synced = useWorkspaceStore.getState().synced!;
    const linkedRequest = {
      id: 'linked-request',
      name: 'linked request',
      folderId: null,
      method: 'POST' as const,
      url: 'https://example.test/upload',
      headers: [],
      query: [],
      pathParams: {},
      cookies: [],
      body: {
        type: 'form-data' as const,
        content: '',
        formRows: [
          {
            kind: 'file' as const,
            key: 'upload',
            slotId: 'public-linked-slot',
            filename: 'public.txt',
            mimeType: 'text/plain',
            size: 6,
            enabled: true,
          },
        ],
      },
      auth: { type: 'none' as const },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: 'fixed',
      updatedAt: 'fixed',
    };
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: {
          publicLink: {
            id: 'publicLink',
            kind: 'public',
            name: 'public/source',
            sourceWorkspaceId: 'src-ws-public',
            source: {
              provider: 'github',
              repoFullName: 'public/source',
              branch: 'main',
              sessionMode: 'workspace',
            },
            scope: ['collections', 'environments'],
            pinnedVersion: '1.0.0',
            updatePolicy: 'manual',
            linkedAt: 'fixed',
            requiredSecretKeyIds: [],
          },
        },
      },
      local: {
        ...local,
        sessions: {
          ...local.sessions,
          github: { ...local.sessions.github, workspace: null },
        },
        linkedCollections: {
          publicLink: {
            pulledAt: 'fixed',
            ref: 'v1.0.0',
            collections: {
              tree: {
                id: 'root',
                type: 'root',
                children: [{ kind: 'request', id: linkedRequest.id }],
              },
              folders: {},
              requests: { [linkedRequest.id]: linkedRequest },
            },
            environments: { items: {}, activeName: null, priorityOrder: [] },
          },
        },
      },
    });

    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    vi.stubGlobal('fetch', queuedFetch([fileResponse(bytes)]));

    const result = await useWorkspaceStore.getState().syncAttachments();
    expect(result).toEqual({ fetched: 1, alreadyPresent: 0, failed: 0 });
    const stored = await getAttachment('public-linked-slot');
    expect(stored?.filename).toBe('public.txt');
    expect(Array.from(stored!.bytes)).toEqual(Array.from(bytes));
    const cache = useWorkspaceStore.getState().local!.attachmentCache?.['public-linked-slot'];
    expect(cache).toMatchObject({
      filename: 'public.txt',
      source: 'linked-workspace',
      linkedWorkspaceId: 'publicLink',
      localPath: 'indexeddb://apicircle-attachments/public-linked-slot',
      requiredBy: [{ requestId: 'linked-request', requestName: 'linked request' }],
    });
  });
});
