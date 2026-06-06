import { z } from 'zod';
import type { GlobalFileAsset } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import type { AnyToolDef } from './types';

// =============================================================================
// Global Assets — File library MCP tools.
//
// Files in `synced.globalAssets.files` are the reusable file uploads
// referenced from request bodies and mock-server responses. Every direct
// upload in the UI now mints a Global Asset entry, so this catalog is the
// single inventory point AI clients see when asking "what files are in
// the workspace?".
//
// Each asset carries provenance state (workingBranchRef + baseBranchRef)
// recorded by the push + refresh flows. `globalAssets.files.list`
// surfaces that state alongside the cross-cutting reference count so a
// caller can identify orphans, files awaiting the next push, files that
// merged to base, etc.
//
// Note on `globalAssets.files.create`: MCP cannot carry binary bytes, so
// this tool is metadata-only — it records the file in the registry with
// an explicit `pendingFromMcp` source marker the desktop / web can use
// to prompt for the missing bytes. Most MCP clients won't need create;
// list / update / delete are the common surfaces.
// =============================================================================

export type FileAssetState =
  | 'uploading'
  | 'workingOnly'
  | 'merged'
  | 'baseOnly'
  | 'missing'
  | 'diverged';

function deriveState(
  asset: Pick<GlobalFileAsset, 'workingBranchRef' | 'baseBranchRef'>,
  hasPendingUpload: boolean,
): FileAssetState {
  const w = asset.workingBranchRef ?? null;
  const b = asset.baseBranchRef ?? null;
  if (w && b) {
    if (w.blobSha && b.blobSha && w.blobSha !== b.blobSha) return 'diverged';
    return 'merged';
  }
  if (w && !b) return 'workingOnly';
  if (!w && b) return 'baseOnly';
  if (hasPendingUpload) return 'uploading';
  return 'missing';
}

export const globalAssetsFilesListTool: AnyToolDef = {
  name: 'assets.list_files',
  description:
    'List every Global File Asset with its provenance state and reference count. Each entry includes id, name, filename, size, mimeType, sha256, state (uploading | workingOnly | merged | baseOnly | missing | diverged), workingBranchRef, baseBranchRef, and usage { requests, mockEndpoints, total }.',
  inputSchema: z.object({}).strict(),
  async handler(_input, ctx) {
    const state = await ctx.workspace.read();
    const files = state.synced.globalAssets.files ?? {};
    const pending = state.local.pendingFileUploads ?? {};
    const usage = state.local.assetUsageIndex ?? {};
    const items = Object.values(files).map((asset) => {
      const hasPending = Boolean(pending[asset.id]);
      const u = usage[asset.id] ?? { requests: [], mockEndpoints: [], total: 0 };
      return {
        id: asset.id,
        name: asset.name,
        description: asset.description ?? null,
        filename: asset.filename,
        size: asset.size,
        mimeType: asset.mimeType,
        sha256: asset.sha256 ?? null,
        state: deriveState(asset, hasPending),
        workingBranchRef: asset.workingBranchRef ?? null,
        baseBranchRef: asset.baseBranchRef ?? null,
        usage: { ...u },
      };
    });
    return { count: items.length, files: items };
  },
};

export const globalAssetsFilesCreateTool: AnyToolDef = {
  name: 'assets.create_file',
  description:
    'Register a Global File Asset entry. Bytes are NOT carried — MCP returns the new asset id and the asset enters the "missing" state. The user fills the bytes from the Global Assets panel (a "Fill bytes" button surfaces on missing-state assets) which preserves the slot id and queues the bytes for the next push. Use this when an AI client wants to claim an asset slot for a file the user will provide later.',
  inputSchema: z
    .object({
      name: z.string().min(1, 'name is required'),
      description: z.string().optional(),
      filename: z.string().min(1, 'filename is required'),
      size: z.number().int().nonnegative(),
      mimeType: z.string().default('application/octet-stream'),
      sha256: z.string().optional(),
    })
    .strict(),
  async handler(input, ctx) {
    const now = new Date().toISOString();
    const file: GlobalFileAsset = {
      id: generateId(),
      name: input.name,
      description: input.description,
      slotId: generateId(),
      filename: input.filename,
      size: input.size,
      mimeType: input.mimeType,
      sha256: input.sha256,
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'globalAsset.upsertFile', file });
    return { id: file.id, slotId: file.slotId, changedIds: out.changedIds };
  },
};

export const globalAssetsFilesUpdateTool: AnyToolDef = {
  name: 'assets.update_file',
  description:
    'Rename or re-describe a Global File Asset. Provenance refs (workingBranchRef, baseBranchRef) and binary metadata (slotId, sha256, size, mimeType) are preserved verbatim.',
  inputSchema: z
    .object({
      id: z.string().min(1),
      patch: z
        .object({
          name: z.string().optional(),
          description: z.string().nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const existing = state.synced.globalAssets.files?.[input.id];
    if (!existing) {
      return { found: false, changedIds: [] };
    }
    const next: GlobalFileAsset = {
      ...existing,
      name: input.patch.name ?? existing.name,
      description:
        input.patch.description === null
          ? undefined
          : (input.patch.description ?? existing.description),
    };
    const out = await ctx.workspace.apply({ kind: 'globalAsset.upsertFile', file: next });
    return { found: true, id: next.id, changedIds: out.changedIds };
  },
};

export const globalAssetsFilesDeleteTool: AnyToolDef = {
  name: 'assets.delete_file',
  description:
    'Delete a Global File Asset. Cascades — every request body and mock-response body that referenced the asset is unbound in the same mutation. The result envelope includes the consumer list that was cleared so the caller can report what changed.',
  inputSchema: z.object({ id: z.string().min(1) }).strict(),
  async handler(input, ctx) {
    // Snapshot the consumer list BEFORE the cascade so the envelope can
    // report what was cleared. Uses the local assetUsageIndex when
    // available, otherwise walks the synced doc directly.
    const before = await ctx.workspace.read();
    const usage = before.local.assetUsageIndex?.[input.id] ?? {
      requests: [],
      mockEndpoints: [],
      total: 0,
    };
    const existing = before.synced.globalAssets.files?.[input.id];
    if (!existing) {
      return { found: false, changedIds: [] };
    }
    const out = await ctx.workspace.apply({ kind: 'globalAsset.removeFile', id: input.id });
    return {
      found: true,
      id: input.id,
      filename: existing.filename,
      unbound: {
        requests: usage.requests,
        mockEndpoints: usage.mockEndpoints,
        total: usage.total,
      },
      changedIds: out.changedIds,
    };
  },
};
