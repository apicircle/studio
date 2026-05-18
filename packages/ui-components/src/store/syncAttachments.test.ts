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
  return {
    body: {
      type: 'file',
      path: '.apicircle/attachments/x',
      sha,
      size: bytes.length,
      content,
      encoding: 'base64',
    },
  };
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
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: {
        slotId: 'slot-A',
        filename: 'pic.png',
        mimeType: 'image/png',
        size: 4,
        sha256: 'aabbccdd',
      },
    });

    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x42]);
    vi.stubGlobal('fetch', queuedFetch([fileResponse(bytes, 'blob-A')]));

    const result = await useWorkspaceStore.getState().syncAttachments();
    expect(result.fetched).toBe(1);
    expect(result.alreadyPresent).toBe(0);
    expect(result.failed).toBe(0);

    const stored = await getAttachment('slot-A');
    expect(stored).not.toBeNull();
    expect(Array.from(stored!.bytes)).toEqual(Array.from(bytes));
    expect(stored!.sha256).toBe('aabbccdd');
    expect(stored!.filename).toBe('pic.png');
  });

  it('skips slots whose local sha256 already matches the synced ref', async () => {
    await setupConnectedBranch();
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: {
        slotId: 'slot-already-present',
        filename: 'doc.bin',
        mimeType: 'application/octet-stream',
        size: 3,
        sha256: 'matched',
      },
    });
    await putAttachment({
      slotId: 'slot-already-present',
      filename: 'doc.bin',
      mimeType: 'application/octet-stream',
      size: 3,
      sha256: 'matched',
      savedAt: 'fixed',
      bytes: new Uint8Array([1, 2, 3]),
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
});
