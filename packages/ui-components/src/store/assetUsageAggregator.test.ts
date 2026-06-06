import { describe, expect, it } from 'vitest';
import type {
  GlobalFileAsset,
  MockServer,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';

import { makeDefaultRequestSchema } from '@apicircle/shared';

import { aggregateAssetUsage, recomputeAssetUsage } from './assetUsageAggregator';

const T = '2026-06-06T00:00:00.000Z';

function makeSynced(overrides: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    meta: { createdAt: T, updatedAt: T, appVersion: '0.1.0' },
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

function makeAsset(id: string): GlobalFileAsset {
  return {
    id,
    name: `Asset ${id}`,
    slotId: `slot-${id}`,
    filename: `${id}.bin`,
    size: 10,
    mimeType: 'application/octet-stream',
    sha256: `sha-${id}`,
    createdAt: T,
    updatedAt: T,
  };
}

function makeRequest(id: string, overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    name: id,
    folderId: null,
    method: 'POST',
    url: 'https://x',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

function makeMockServer(id: string, endpoints: MockServer['endpoints']): MockServer {
  return {
    id,
    name: id,
    source: { kind: 'manual', endpoints },
    endpoints,
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: T,
    updatedAt: T,
  };
}

describe('aggregateAssetUsage', () => {
  it('returns an empty index when no asset references exist', () => {
    expect(aggregateAssetUsage(makeSynced())).toEqual({});
  });

  it('counts binary request bodies bound to an asset', () => {
    const synced = makeSynced({
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        folders: {},
        requests: {
          r1: makeRequest('r1', {
            body: {
              type: 'binary',
              content: '',
              attachment: {
                slotId: 'slot-a',
                globalFileAssetId: 'asset-a',
                filename: 'a.bin',
              },
            },
          }),
        },
      },
    });
    const out = aggregateAssetUsage(synced);
    expect(out['asset-a']).toEqual({
      requests: ['r1'],
      mockEndpoints: [],
      total: 1,
    });
  });

  it('counts form-data file rows bound to an asset', () => {
    const synced = makeSynced({
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        folders: {},
        requests: {
          r1: makeRequest('r1', {
            body: {
              type: 'form-data',
              content: '',
              formRows: [
                { kind: 'text', key: 't', value: 'v', enabled: true },
                {
                  kind: 'file',
                  key: 'upload',
                  enabled: true,
                  slotId: 'slot-a',
                  globalFileAssetId: 'asset-a',
                  filename: 'a.bin',
                  size: 10,
                  mimeType: 'application/octet-stream',
                },
              ],
            },
          }),
        },
      },
    });
    expect(aggregateAssetUsage(synced)['asset-a']?.requests).toEqual(['r1']);
  });

  it('dedupes the same asset bound twice by the same request', () => {
    // E.g. a form-data row + a binary body in the same request (impossible
    // in practice but defensive). The asset should appear once.
    const synced = makeSynced({
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        folders: {},
        requests: {
          r1: makeRequest('r1', {
            body: {
              type: 'form-data',
              content: '',
              formRows: [
                {
                  kind: 'file',
                  key: 'a',
                  enabled: true,
                  slotId: 'slot-a',
                  globalFileAssetId: 'asset-a',
                  filename: 'a.bin',
                  size: 10,
                  mimeType: 'application/octet-stream',
                },
                {
                  kind: 'file',
                  key: 'a-again',
                  enabled: true,
                  slotId: 'slot-a',
                  globalFileAssetId: 'asset-a',
                  filename: 'a.bin',
                  size: 10,
                  mimeType: 'application/octet-stream',
                },
              ],
            },
          }),
        },
      },
    });
    const out = aggregateAssetUsage(synced);
    expect(out['asset-a']?.requests).toEqual(['r1']);
    expect(out['asset-a']?.total).toBe(1);
  });

  it('counts mock-server endpoints (defaultResponse, requestValidation, responseRules)', () => {
    const ep: MockServer['endpoints'][number] = {
      id: 'ep-1',
      name: 'GET /a',
      method: 'GET',
      pathPattern: '/a',
      requestSchema: makeDefaultRequestSchema(),
      requestValidation: [
        {
          id: 'rv-1',
          kind: 'header-equals',
          target: 'x',
          expected: '1',
          enabled: true,
          failResponse: {
            status: 400,
            headers: [],
            delayMs: 0,
            body: {
              type: 'binary',
              content: '',
              attachment: { slotId: 'slot-a', globalFileAssetId: 'asset-a', filename: 'a.bin' },
            },
          },
        },
      ],
      responseRules: [
        {
          id: 'rr-1',
          name: 'rule',
          enabled: true,
          when: [],
          response: {
            status: 200,
            headers: [],
            delayMs: 0,
            body: {
              type: 'binary',
              content: '',
              attachment: { slotId: 'slot-a', globalFileAssetId: 'asset-a', filename: 'a.bin' },
            },
          },
        },
      ],
      defaultResponse: {
        status: 200,
        headers: [],
        delayMs: 0,
        body: {
          type: 'binary',
          content: '',
          attachment: { slotId: 'slot-a', globalFileAssetId: 'asset-a', filename: 'a.bin' },
        },
      },
    };
    const synced = makeSynced({ mockServers: { m1: makeMockServer('m1', [ep]) } });
    const out = aggregateAssetUsage(synced);
    // Same endpoint referenced by three sub-bodies — collapses to one entry.
    expect(out['asset-a']?.mockEndpoints).toEqual([{ mockId: 'm1', endpointId: 'ep-1' }]);
    expect(out['asset-a']?.total).toBe(1);
  });
});

describe('recomputeAssetUsage', () => {
  it('writes a zero-use entry for an asset with no consumers (so the UI can show "Unused")', () => {
    const asset = makeAsset('a');
    const synced = makeSynced({
      globalAssets: { schemas: {}, graphql: {}, files: { [asset.id]: asset } },
    });
    const out = recomputeAssetUsage(synced, makeLocal());
    expect(out.assetUsageIndex?.[asset.id]).toEqual({
      requests: [],
      mockEndpoints: [],
      total: 0,
    });
  });

  it('returns the same local reference when nothing changed', () => {
    const asset = makeAsset('a');
    const local = makeLocal({
      assetUsageIndex: {
        [asset.id]: { requests: [], mockEndpoints: [], total: 0 },
      },
    });
    const synced = makeSynced({
      globalAssets: { schemas: {}, graphql: {}, files: { [asset.id]: asset } },
    });
    const out = recomputeAssetUsage(synced, local);
    expect(out).toBe(local);
  });

  // Regression: pendingAttachmentDeletes entries whose slotId is still
  // owned by a current asset are GHOSTS — typically from a delete +
  // snapshot-restore sequence. The push has a safety filter that
  // drops them before emitting, but without pruning here the queue
  // would grow unbounded.
  it('prunes pendingAttachmentDeletes entries whose slotId still belongs to a current asset', () => {
    const live = makeAsset('a');
    const local = makeLocal({
      // Three entries: two real (slot ids that no longer belong to any
      // asset in the registry — those should stay queued for emission)
      // and one ghost (slot id that matches the live asset — that
      // should be pruned).
      pendingAttachmentDeletes: ['slot-real-1', live.slotId, 'slot-real-2'],
    });
    const synced = makeSynced({
      globalAssets: { schemas: {}, graphql: {}, files: { [live.id]: live } },
    });
    const next = recomputeAssetUsage(synced, local);
    expect(next.pendingAttachmentDeletes).toEqual(['slot-real-1', 'slot-real-2']);
  });

  it('leaves pendingAttachmentDeletes untouched when every queued slotId is a real delete', () => {
    const live = makeAsset('a');
    const local = makeLocal({ pendingAttachmentDeletes: ['slot-gone-1', 'slot-gone-2'] });
    const synced = makeSynced({
      globalAssets: { schemas: {}, graphql: {}, files: { [live.id]: live } },
    });
    const next = recomputeAssetUsage(synced, local);
    // Same reference — proves the aggregator short-circuits when
    // nothing needs healing.
    expect(next.pendingAttachmentDeletes).toBe(local.pendingAttachmentDeletes);
  });

  // Regression: pendingFileUploads entries whose asset id is no longer
  // in synced.globalAssets.files are orphans. Normally
  // `removeGlobalFileAsset` + the `globalAsset.removeFile` patch both
  // drop the entry, but a buggy race or a hand-edit of the workspace
  // doc could leave a stale entry behind. The aggregator self-heals
  // by pruning them on every commit.
  it('prunes pendingFileUploads entries whose asset id is missing from the registry', () => {
    const live = makeAsset('a');
    const local = makeLocal({
      pendingFileUploads: {
        [live.id]: {
          slotId: live.slotId,
          filename: live.filename,
          mimeType: live.mimeType,
          sha256: live.sha256!,
          size: live.size,
          queuedAt: T,
        },
        orphan: {
          slotId: 'slot-orphan',
          filename: 'orphan.bin',
          mimeType: 'application/octet-stream',
          sha256: 'sha-orphan',
          size: 4,
          queuedAt: T,
        },
      },
    });
    const synced = makeSynced({
      globalAssets: { schemas: {}, graphql: {}, files: { [live.id]: live } },
    });
    const next = recomputeAssetUsage(synced, local);
    expect(next.pendingFileUploads?.[live.id]).toBeDefined();
    expect(next.pendingFileUploads?.orphan).toBeUndefined();
  });

  it('drops the index entirely when no file assets are registered', () => {
    const local = makeLocal({
      assetUsageIndex: { stale: { requests: [], mockEndpoints: [], total: 0 } },
    });
    const out = recomputeAssetUsage(makeSynced(), local);
    expect(out.assetUsageIndex).toBeUndefined();
  });

  it('refreshes the index when usage changes', () => {
    const asset = makeAsset('a');
    const initialLocal = makeLocal({
      assetUsageIndex: {
        [asset.id]: { requests: [], mockEndpoints: [], total: 0 },
      },
    });
    const synced = makeSynced({
      globalAssets: { schemas: {}, graphql: {}, files: { [asset.id]: asset } },
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        folders: {},
        requests: {
          r1: makeRequest('r1', {
            body: {
              type: 'binary',
              content: '',
              attachment: { slotId: asset.slotId, globalFileAssetId: asset.id, filename: 'x' },
            },
          }),
        },
      },
    });
    const next = recomputeAssetUsage(synced, initialLocal);
    expect(next).not.toBe(initialLocal);
    expect(next.assetUsageIndex?.[asset.id]?.requests).toEqual(['r1']);
    expect(next.assetUsageIndex?.[asset.id]?.total).toBe(1);
  });
});
