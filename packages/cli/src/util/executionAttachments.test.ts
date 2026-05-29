import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceState } from '@apicircle/core';
import type {
  ExecutionPlan,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { prepareExecutionAttachments } from './executionAttachments';

const T0 = '2026-05-01T00:00:00.000Z';

function makeRequest(id: string, partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    name: id,
    folderId: null,
    method: 'POST',
    url: 'https://api.test/upload',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

function makePlan(step: ExecutionPlan['steps'][number]): ExecutionPlan {
  return {
    id: 'p1',
    name: 'Uploads',
    steps: [step],
    envPriorityOrder: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

function makeSynced(overrides: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
    ...overrides,
  };
}

function makeLocal(overrides: Partial<WorkspaceLocal> = {}): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: null, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    attachmentCache: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    ...overrides,
  };
}

async function tmpWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-attachments-'));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prepareExecutionAttachments', () => {
  it('records an existing local attachment path and resolves bytes for execution', async () => {
    const dir = await tmpWorkspace();
    const bytes = new Uint8Array([1, 2, 3]);
    await fs.mkdir(path.join(dir, '.apicircle', 'attachments'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.apicircle', 'attachments', encodeURIComponent('slot-1')),
      bytes,
    );
    const request = makeRequest('r1', {
      body: {
        type: 'binary',
        content: '',
        attachment: {
          slotId: 'slot-1',
          filename: 'payload.bin',
          mimeType: 'application/octet-stream',
          size: bytes.length,
        },
      },
    });
    const state: WorkspaceState = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          requests: { r1: request },
          folders: {},
        },
      }),
      local: makeLocal(),
    };

    const prepared = await prepareExecutionAttachments(dir, state, makePlan({ requestId: 'r1' }));
    const meta = prepared.state.local.attachmentCache?.['slot-1'];

    expect(prepared.summary).toMatchObject({ total: 1, alreadyPresent: 1, downloaded: 0 });
    expect(meta?.localPath).toBe(path.join(dir, '.apicircle', 'attachments', 'slot-1'));
    expect(meta?.requiredBy).toEqual([{ requestId: 'r1', requestName: 'r1' }]);
    const resolved = await prepared.resolveAttachment('slot-1');
    expect(resolved?.filename).toBe('payload.bin');
    expect(new Uint8Array(await resolved!.blob.arrayBuffer())).toEqual(bytes);
  });

  it('downloads a public linked attachment and records the linked source metadata', async () => {
    const dir = await tmpWorkspace();
    const bytes = new Uint8Array([9, 8, 7]);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: 'file',
              encoding: 'base64',
              content: Buffer.from(bytes).toString('base64'),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const linkedRequest = makeRequest('linked-r1', {
      name: 'Linked upload',
      body: {
        type: 'form-data',
        content: '',
        formRows: [
          {
            kind: 'file',
            key: 'file',
            slotId: 'linked-slot',
            filename: 'linked.txt',
            mimeType: 'text/plain',
            size: bytes.length,
            enabled: true,
          },
        ],
      },
    });
    const state: WorkspaceState = {
      synced: makeSynced({
        linkedWorkspaces: {
          lw1: {
            id: 'lw1',
            kind: 'public',
            name: 'Public source',
            source: {
              provider: 'github',
              repoFullName: 'acme/public-source',
              branch: 'main',
              sessionMode: 'workspace',
            },
            scope: ['collections', 'environments'],
            pinnedVersion: null,
            updatePolicy: 'manual',
            linkedAt: T0,
            requiredSecretKeyIds: [],
          },
        },
      }),
      local: makeLocal({
        linkedCollections: {
          lw1: {
            pulledAt: T0,
            ref: 'HEAD@main',
            collections: {
              tree: { id: 'root', type: 'root', children: [] },
              requests: { 'linked-r1': linkedRequest },
              folders: {},
            },
            environments: { items: {}, activeName: null, priorityOrder: [] },
          },
        },
      }),
    };

    const prepared = await prepareExecutionAttachments(
      dir,
      state,
      makePlan({ requestId: 'linked-r1', linkedWorkspaceId: 'lw1' }),
    );
    const meta = prepared.state.local.attachmentCache?.['linked-slot'];

    expect(prepared.summary).toMatchObject({ total: 1, downloaded: 1 });
    expect(meta).toMatchObject({
      source: 'linked-workspace',
      linkedWorkspaceId: 'lw1',
      filename: 'linked.txt',
    });
    expect(await fs.readFile(meta!.localPath)).toEqual(Buffer.from(bytes));
  });

  it('fails closed when downloaded bytes do not match the expected sha256', async () => {
    const dir = await tmpWorkspace();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: 'file',
              encoding: 'base64',
              content: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const linkedRequest = makeRequest('linked-r1', {
      name: 'Linked upload',
      body: {
        type: 'binary',
        content: '',
        attachment: {
          slotId: 'linked-slot',
          filename: 'linked.txt',
          sha256: 'expected-sha',
        },
      },
    });
    const state: WorkspaceState = {
      synced: makeSynced({
        linkedWorkspaces: {
          lw1: {
            id: 'lw1',
            kind: 'public',
            name: 'Public source',
            source: {
              provider: 'github',
              repoFullName: 'acme/public-source',
              branch: 'main',
              sessionMode: 'workspace',
            },
            scope: ['collections', 'environments'],
            pinnedVersion: null,
            updatePolicy: 'manual',
            linkedAt: T0,
            requiredSecretKeyIds: [],
          },
        },
      }),
      local: makeLocal({
        linkedCollections: {
          lw1: {
            pulledAt: T0,
            ref: 'HEAD@main',
            collections: {
              tree: { id: 'root', type: 'root', children: [] },
              requests: { 'linked-r1': linkedRequest },
              folders: {},
            },
            environments: { items: {}, activeName: null, priorityOrder: [] },
          },
        },
      }),
    };

    await expect(
      prepareExecutionAttachments(
        dir,
        state,
        makePlan({ requestId: 'linked-r1', linkedWorkspaceId: 'lw1' }),
      ),
    ).rejects.toThrow(/checksum verification/);
  });
});
