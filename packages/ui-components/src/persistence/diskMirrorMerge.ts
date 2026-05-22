import type { Folder, Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';

// =============================================================================
// One-time IDB ↔ disk merge.
//
// Before this mirror landed, the desktop app's workspace lived in IndexedDB
// while `apicircle import` / `apicircle-mcp` wrote a separate
// `workspace.synced.json` on disk. Users who used both surfaces have
// content in BOTH stores under DIFFERENT workspaceIds (the CLI seeded a
// fresh workspace via `ensureWorkspace`, the desktop app has its own).
//
// On first launch with the mirror enabled, we detect the divergence by
// comparing `synced.workspaceId` between disk and IDB. If they differ, we
// merge the disk-side collections into the IDB workspace so the user
// doesn't lose either side, then write the merged state back through both
// stores. Subsequent boots see matching workspaceIds and skip the merge.
//
// Merge rules (IDB wins on every collision — the user has been actively
// editing it):
//
//   - `collections.requests`   : union by ID, IDB wins on conflict.
//   - `collections.folders`    : union by ID, IDB wins on conflict.
//   - `collections.tree`       : keep IDB's tree, append every disk-only
//                                request / folder ID to root as a single
//                                "Imported from disk" folder so the user
//                                can locate them.
//   - `environments.items`     : union by name, IDB wins.
//   - `mockServers`            : union by ID, IDB wins.
//   - `globalAssets.{schemas,graphql}` : union by ID, IDB wins.
//   - `secretKeys`             : union by ID, IDB wins.
//   - Everything else (meta, priorityOrder, releases, etc.) : IDB wins.
//
// `local` is never merged — it's per-device runtime state and the IDB
// half is the source of truth for the running desktop.
// =============================================================================

const IMPORTED_FOLDER_NAME = 'Imported from disk';

export interface MergeResult {
  merged: WorkspaceSynced;
  importedRequestIds: string[];
  importedFolderIds: string[];
}

/**
 * Returns the merged synced doc + the IDs of every request/folder that
 * was pulled in from disk. Idempotent: calling with two identical docs
 * yields the IDB doc unchanged and an empty `imported*` list.
 *
 * The returned doc keeps IDB's `workspaceId` so the caller can write it
 * back through both stores; the disk file will then carry the IDB id and
 * future boots will see matching ids → no further merge.
 */
export function mergeSyncedFromDisk(idb: WorkspaceSynced, disk: WorkspaceSynced): MergeResult {
  const importedRequestIds: string[] = [];
  const importedFolderIds: string[] = [];

  const mergedRequests: Record<string, ApiRequest> = { ...idb.collections.requests };
  for (const [id, req] of Object.entries(disk.collections.requests)) {
    if (id in mergedRequests) continue;
    importedRequestIds.push(id);
    // Preserve the disk-side folderId for now. The wrapper-folder pass
    // below remaps top-level orphans to the wrapper; nested children
    // keep their existing parent so the sub-folder structure survives.
    mergedRequests[id] = req;
  }

  const mergedFolders: Record<string, Folder> = { ...idb.collections.folders };
  for (const [id, folder] of Object.entries(disk.collections.folders)) {
    if (id in mergedFolders) continue;
    importedFolderIds.push(id);
    mergedFolders[id] = folder;
  }

  // Tree update: keep IDB's tree as-is, then append the new orphans
  // under a single "Imported from disk" wrapper folder so the user can
  // locate them. Hierarchy in this codebase is encoded via Folder.parentId
  // and Request.folderId — `tree` only lists root-level children — so we
  // (a) add the wrapper to `tree.children`, (b) reparent every imported
  // entry to point at the wrapper. Sub-folder children naturally fall
  // under it via their existing parentId chain.
  let mergedTree = idb.collections.tree;
  if (importedRequestIds.length > 0 || importedFolderIds.length > 0) {
    const wrapperId = generateLocalId('imported-folder');
    const wrapperFolder: Folder = {
      id: wrapperId,
      name: IMPORTED_FOLDER_NAME,
      parentId: null,
    };
    mergedFolders[wrapperId] = wrapperFolder;
    // Reparent only the *top-level* orphans — sub-folder children
    // already point at their (imported) parent folder. We detect
    // top-level by checking whether the original parent existed in the
    // disk doc; an imported folder whose parentId points at another
    // imported folder is left alone.
    for (const id of importedFolderIds) {
      const f = mergedFolders[id];
      const parentStillImported = f.parentId && importedFolderIds.includes(f.parentId);
      if (!parentStillImported) {
        mergedFolders[id] = { ...f, parentId: wrapperId };
      }
    }
    for (const id of importedRequestIds) {
      const r = mergedRequests[id];
      const parentStillImported = r.folderId && importedFolderIds.includes(r.folderId);
      if (!parentStillImported) {
        mergedRequests[id] = { ...r, folderId: wrapperId };
      }
    }
    mergedTree = {
      ...mergedTree,
      children: [...mergedTree.children, { kind: 'folder', id: wrapperId }],
    };
  }

  const mergedEnvItems = { ...idb.environments.items };
  for (const [name, env] of Object.entries(disk.environments.items)) {
    if (name in mergedEnvItems) continue;
    mergedEnvItems[name] = env;
  }

  const mergedMocks = { ...idb.mockServers };
  for (const [id, server] of Object.entries(disk.mockServers ?? {})) {
    if (id in mergedMocks) continue;
    mergedMocks[id] = server;
  }

  const mergedSchemas = { ...idb.globalAssets.schemas };
  for (const [id, asset] of Object.entries(disk.globalAssets?.schemas ?? {})) {
    if (id in mergedSchemas) continue;
    mergedSchemas[id] = asset;
  }
  const mergedGraphql = { ...idb.globalAssets.graphql };
  for (const [id, asset] of Object.entries(disk.globalAssets?.graphql ?? {})) {
    if (id in mergedGraphql) continue;
    mergedGraphql[id] = asset;
  }

  const mergedSecretKeys = { ...(idb.secretKeys ?? {}) };
  for (const [id, meta] of Object.entries(disk.secretKeys ?? {})) {
    if (id in mergedSecretKeys) continue;
    mergedSecretKeys[id] = meta;
  }

  const merged: WorkspaceSynced = {
    ...idb,
    collections: {
      tree: mergedTree,
      requests: mergedRequests,
      folders: mergedFolders,
    },
    environments: {
      ...idb.environments,
      items: mergedEnvItems,
    },
    mockServers: mergedMocks,
    globalAssets: { schemas: mergedSchemas, graphql: mergedGraphql },
    secretKeys: mergedSecretKeys,
    meta: {
      ...idb.meta,
      updatedAt: new Date().toISOString(),
    },
  };

  return { merged, importedRequestIds, importedFolderIds };
}

/**
 * The merge needs new IDs for the wrapper folder; we don't want to pull
 * `generateId` from `@apicircle/shared` here (it's already imported in
 * countless call sites — keeping this module's surface narrow). A simple
 * prefix + random suffix is enough since this only runs once per device.
 */
function generateLocalId(prefix: string): string {
  // Match the shape of generateId() — 16 hex chars is plenty of entropy
  // for a one-shot tag that lives next to UUID-like ids.
  let suffix = '';
  for (let i = 0; i < 16; i++) {
    suffix += Math.floor(Math.random() * 16).toString(16);
  }
  return `${prefix}-${suffix}`;
}
