import { beforeEach, describe, expect, it } from 'vitest';
import type { GlobalFileAsset, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '@apicircle/core/providers';
import { SingleWorkspaceAdapter } from '@apicircle/core/providers';
import { InProcessMockController } from '@apicircle/core/providers';
import {
  globalAssetsFilesCreateTool,
  globalAssetsFilesDeleteTool,
  globalAssetsFilesListTool,
  globalAssetsFilesUpdateTool,
} from './globalAssets';

const T0 = '2026-06-06T00:00:00.000Z';

function asset(overrides: Partial<GlobalFileAsset> = {}): GlobalFileAsset {
  return {
    id: 'a1',
    name: 'Reusable payload',
    slotId: 'slot-1',
    filename: 'payload.bin',
    size: 4,
    mimeType: 'application/octet-stream',
    sha256: 'sha-1',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function freshState(
  files: Record<string, GlobalFileAsset> = {},
  pending: WorkspaceLocal['pendingFileUploads'] = undefined,
  usage: WorkspaceLocal['assetUsageIndex'] = undefined,
): { synced: WorkspaceSynced; local: WorkspaceLocal } {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files },
      mockServers: {},
      meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
    },
    local: {
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
      pendingFileUploads: pending,
      assetUsageIndex: usage,
    },
  };
}

let ctx: {
  workspace: InMemoryWorkspaceProvider;
  workspaces: SingleWorkspaceAdapter;
  mock: InProcessMockController;
};

function setupCtx(state: { synced: WorkspaceSynced; local: WorkspaceLocal }) {
  const workspace = new InMemoryWorkspaceProvider(state);
  ctx = {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
}

beforeEach(() => {
  setupCtx(freshState());
});

describe('globalAssets.files.list', () => {
  it('returns an empty list when no assets exist', async () => {
    const out = (await globalAssetsFilesListTool.handler({}, ctx)) as {
      count: number;
      files: unknown[];
    };
    expect(out.count).toBe(0);
    expect(out.files).toEqual([]);
  });

  it('surfaces the parsed spec summary when the asset is an OpenAPI document', async () => {
    const specAsset = asset({
      id: 'spec1',
      filename: 'petstore.json',
      mimeType: 'application/json',
      spec: {
        dialect: 'openapi-3',
        format: 'json',
        title: 'Petstore',
        version: '1.0',
        operationCount: 4,
        parsedAt: T0,
        warnings: [],
      },
    });
    setupCtx(freshState({ spec1: specAsset }));
    const out = (await globalAssetsFilesListTool.handler({}, ctx)) as {
      files: Array<{ spec: unknown }>;
    };
    expect(out.files[0]?.spec).toMatchObject({ dialect: 'openapi-3', operationCount: 4 });
  });

  it('returns spec: null for ordinary file assets', async () => {
    setupCtx(freshState({ a1: asset({ id: 'a1' }) }));
    const out = (await globalAssetsFilesListTool.handler({}, ctx)) as {
      files: Array<{ spec: unknown }>;
    };
    expect(out.files[0]?.spec).toBeNull();
  });

  it('derives each asset state from refs + pending bytes', async () => {
    const a1 = asset({ id: 'a1' });
    const a2 = asset({
      id: 'a2',
      workingBranchRef: {
        branchName: 'apicircle/wb',
        blobSha: 'blob-w',
        commitSha: 'c-w',
        verifiedAt: T0,
      },
    });
    const a3 = asset({
      id: 'a3',
      baseBranchRef: { branchName: 'main', blobSha: 'blob-b', commitSha: 'c-b', verifiedAt: T0 },
    });
    const a4 = asset({
      id: 'a4',
      workingBranchRef: { branchName: 'wb', blobSha: 'b-same', verifiedAt: T0 },
      baseBranchRef: { branchName: 'main', blobSha: 'b-same', verifiedAt: T0 },
    });
    const a5 = asset({
      id: 'a5',
      workingBranchRef: { branchName: 'wb', blobSha: 'b-x', verifiedAt: T0 },
      baseBranchRef: { branchName: 'main', blobSha: 'b-y', verifiedAt: T0 },
    });
    setupCtx(
      freshState(
        { a1: a1, a2: a2, a3: a3, a4: a4, a5: a5 },
        {
          a1: {
            slotId: a1.slotId,
            filename: a1.filename,
            mimeType: a1.mimeType,
            sha256: a1.sha256!,
            size: a1.size,
            queuedAt: T0,
          },
        },
      ),
    );
    const out = (await globalAssetsFilesListTool.handler({}, ctx)) as {
      count: number;
      files: Array<{ id: string; state: string }>;
    };
    expect(out.count).toBe(5);
    const byId = Object.fromEntries(out.files.map((f) => [f.id, f.state]));
    expect(byId.a1).toBe('uploading');
    expect(byId.a2).toBe('workingOnly');
    expect(byId.a3).toBe('baseOnly');
    expect(byId.a4).toBe('merged');
    expect(byId.a5).toBe('diverged');
  });

  it('includes the cross-cutting usage index in each envelope entry', async () => {
    const a = asset();
    setupCtx(
      freshState({ a1: a }, undefined, {
        a1: {
          requests: ['r1', 'r2'],
          mockEndpoints: [{ mockId: 'm1', endpointId: 'ep1' }],
          total: 3,
        },
      }),
    );
    const out = (await globalAssetsFilesListTool.handler({}, ctx)) as {
      files: Array<{ id: string; usage: { total: number } }>;
    };
    expect(out.files[0].usage.total).toBe(3);
  });

  it('returns "missing" state for an asset with no refs AND no pending bytes', async () => {
    setupCtx(freshState({ a1: asset({ workingBranchRef: null, baseBranchRef: null }) }));
    const out = (await globalAssetsFilesListTool.handler({}, ctx)) as {
      files: Array<{ state: string }>;
    };
    expect(out.files[0].state).toBe('missing');
  });
});

describe('globalAssets.files.create', () => {
  it('registers a new asset and returns the minted id + slotId', async () => {
    const out = (await globalAssetsFilesCreateTool.handler(
      {
        name: 'New from MCP',
        filename: 'plan.json',
        size: 128,
        mimeType: 'application/json',
        sha256: 'sha-x',
      },
      ctx,
    )) as { id: string; slotId: string; changedIds: string[] };
    expect(out.id).toMatch(/.+/);
    expect(out.slotId).toMatch(/.+/);
    expect(out.changedIds).toContain(out.id);

    const state = await ctx.workspace.read();
    const stored = state.synced.globalAssets.files![out.id];
    expect(stored).toMatchObject({
      name: 'New from MCP',
      filename: 'plan.json',
      size: 128,
      mimeType: 'application/json',
      sha256: 'sha-x',
    });
    // Brand-new entry has no provenance — that's the contract: MCP can't
    // carry bytes, so workingBranchRef + baseBranchRef stay undefined.
    expect(stored.workingBranchRef).toBeUndefined();
    expect(stored.baseBranchRef).toBeUndefined();
  });
});

describe('globalAssets.files.update', () => {
  it('renames an asset and preserves provenance refs', async () => {
    const a = asset({
      workingBranchRef: { branchName: 'wb', blobSha: 'b-w', verifiedAt: T0 },
      baseBranchRef: { branchName: 'main', blobSha: 'b-w', verifiedAt: T0 },
    });
    setupCtx(freshState({ [a.id]: a }));
    const out = (await globalAssetsFilesUpdateTool.handler(
      { id: a.id, patch: { name: 'Renamed' } },
      ctx,
    )) as { found: boolean; changedIds: string[] };
    expect(out.found).toBe(true);
    const state = await ctx.workspace.read();
    const after = state.synced.globalAssets.files![a.id];
    expect(after.name).toBe('Renamed');
    expect(after.workingBranchRef?.branchName).toBe('wb');
    expect(after.baseBranchRef?.branchName).toBe('main');
  });

  it('reports found:false for an unknown id without mutating state', async () => {
    const out = (await globalAssetsFilesUpdateTool.handler(
      { id: 'missing', patch: { name: 'X' } },
      ctx,
    )) as { found: boolean };
    expect(out.found).toBe(false);
  });
});

describe('globalAssets.files.delete', () => {
  it('cascades the unbind and returns the cleared consumer list', async () => {
    const a = asset();
    setupCtx(
      freshState({ [a.id]: a }, undefined, {
        [a.id]: {
          requests: ['r1', 'r2'],
          mockEndpoints: [{ mockId: 'm1', endpointId: 'ep1' }],
          total: 3,
        },
      }),
    );
    const out = (await globalAssetsFilesDeleteTool.handler({ id: a.id }, ctx)) as {
      found: boolean;
      unbound: { requests: string[]; mockEndpoints: unknown[]; total: number };
    };
    expect(out.found).toBe(true);
    expect(out.unbound.total).toBe(3);
    expect(out.unbound.requests).toEqual(['r1', 'r2']);
    expect(out.unbound.mockEndpoints).toEqual([{ mockId: 'm1', endpointId: 'ep1' }]);
    const state = await ctx.workspace.read();
    expect(state.synced.globalAssets.files?.[a.id]).toBeUndefined();
  });

  it('reports found:false for an unknown id', async () => {
    const out = (await globalAssetsFilesDeleteTool.handler({ id: 'missing' }, ctx)) as {
      found: boolean;
    };
    expect(out.found).toBe(false);
  });

  it('queues the slot id for remote deletion when the asset had a workingBranchRef', async () => {
    // Headless writer (AI client via MCP) deletes an asset that has
    // already been pushed. The patch handler must queue the slotId in
    // `pendingAttachmentDeletes` so the next desktop push emits a
    // `{path: '.apicircle/workspace-<id>/attachments/<slotId>', sha: null}` tree entry.
    // Without this queue, AI-driven deletions would orphan blobs on
    // the remote tree.
    const a = asset({
      workingBranchRef: {
        branchName: 'apicircle/wb',
        blobSha: 'blob-w',
        commitSha: 'commit-w',
        verifiedAt: T0,
      },
    });
    setupCtx(freshState({ [a.id]: a }));
    await globalAssetsFilesDeleteTool.handler({ id: a.id }, ctx);
    const state = await ctx.workspace.read();
    expect(state.local.pendingAttachmentDeletes).toContain(a.slotId);
  });

  it('queues the slot id when the asset had only a baseBranchRef (post-cleanup-invariant state)', async () => {
    const a = asset({
      baseBranchRef: { branchName: 'main', blobSha: 'blob-b', verifiedAt: T0 },
    });
    setupCtx(freshState({ [a.id]: a }));
    await globalAssetsFilesDeleteTool.handler({ id: a.id }, ctx);
    const state = await ctx.workspace.read();
    expect(state.local.pendingAttachmentDeletes).toContain(a.slotId);
  });

  it('does NOT queue a remote delete for a local-only asset (no push refs)', async () => {
    // The asset was never pushed — there's nothing on the remote to
    // delete. Queueing would waste a tree entry on the next push.
    const a = asset(); // no refs
    setupCtx(freshState({ [a.id]: a }));
    await globalAssetsFilesDeleteTool.handler({ id: a.id }, ctx);
    const state = await ctx.workspace.read();
    expect(state.local.pendingAttachmentDeletes ?? []).not.toContain(a.slotId);
  });
});
