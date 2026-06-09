import type {
  AssetGitRef,
  EnvPriorityRef,
  Folder,
  FolderNode,
  FormDataRow,
  GlobalFileAsset,
  MockResponseBody,
  MockResponseConfig,
  RequestBody,
  Request as ApiRequest,
  SecretCryptoMeta,
  WorkspaceLocal,
  WorkspaceSnapshot,
  WorkspaceSnapshotTrigger,
  WorkspaceSynced,
} from '@apicircle/shared';
import { envPriorityKey, generateId } from '@apicircle/shared';
import type { WorkspacePatch, WorkspaceState } from './patches';
import {
  importApicircleFolderInto,
  type ImportApicircleFolderResult,
} from './apicircleFolderImport';
import type { ParsedApicircleFolderExport } from '../import/apicircleFolder';

// =============================================================================
// applyMutation — single dispatch over every workspace patch.
//
// Pure: does not touch IDB, the network, or `Date.now` indirectly through
// imports. The `now` parameter is injectable so tests can pin timestamps and
// so the orchestrator stays deterministic when called multiple times in a
// batch (e.g. an MCP tool handler applying several patches in sequence).
//
// `changedIds` carries the entity ids touched by the patch (request id,
// folder id, environment name, plan id, mock id, etc). Callers use it to
// invalidate caches, trigger autosave, or report results back to MCP
// clients.
// =============================================================================

export interface ApplyMutationOptions {
  /** ISO timestamp to stamp into `updatedAt`. Defaults to the current time. */
  now?: string;
}

export interface ApplyMutationResult {
  next: WorkspaceState;
  changedIds: string[];
}

export function applyMutation(
  state: WorkspaceState,
  patch: WorkspacePatch,
  options: ApplyMutationOptions = {},
): ApplyMutationResult {
  const now = options.now ?? new Date().toISOString();
  switch (patch.kind) {
    case 'request.create':
      return applyRequestCreate(state, patch.request, now);
    case 'request.update':
      return applyRequestUpdate(state, patch.id, patch.patch, now);
    case 'request.delete':
      return applyRequestDelete(state, patch.id, now);
    case 'folder.create':
      return applyFolderCreate(state, patch.folder, now);
    case 'folder.delete':
      return applyFolderDelete(state, patch.id, now);
    case 'folder.move':
      return applyFolderMove(state, patch.id, patch.newParentId, now);
    case 'folder.import_apicircle':
      return applyFolderImportApicircle(state, patch.parsed, patch.parentFolderId, now);
    case 'environment.upsert':
      return applyEnvUpsert(state, patch.environment, now);
    case 'environment.delete':
      return applyEnvDelete(state, patch.name, now);
    case 'environment.setActive':
      return applyEnvSetActive(state, patch.name, now);
    case 'environment.setPriority':
      return applyEnvSetPriority(state, patch.order, now);
    case 'secretKey.upsert':
      return applySecretKeyUpsert(state, patch.meta, now);
    case 'secret.crypto.set':
      return applySecretCryptoSet(state, patch.crypto, now);
    case 'secret.crypto.clear':
      return applySecretCryptoClear(state, now);
    case 'assertion.upsert':
      return applyAssertionUpsert(state, patch.requestId, patch.assertion, now);
    case 'assertion.delete':
      return applyAssertionDelete(state, patch.requestId, patch.assertionId, now);
    case 'mock.upsert':
      return applyMockUpsert(state, patch.mock, now);
    case 'mock.delete':
      return applyMockDelete(state, patch.id, now);
    case 'globalAsset.upsertFile':
      return applyGlobalAssetUpsertFile(state, patch.file, now);
    case 'globalAsset.removeFile':
      return applyGlobalAssetRemoveFile(state, patch.id, now);
    case 'globalAsset.markPushed':
      return applyGlobalAssetMarkPushed(state, patch.id, patch.ref, now);
    case 'globalAsset.markMerged':
      return applyGlobalAssetMarkMerged(state, patch.id, patch.ref, now);
    case 'globalAsset.cleanupWorkingRef':
      return applyGlobalAssetCleanupWorkingRef(state, patch.id, now);
    case 'globalAsset.invalidateRef':
      return applyGlobalAssetInvalidateRef(state, patch.id, patch.which, now);
    case 'plan.upsert':
      return applyPlanUpsert(state, patch.plan, now);
    case 'plan.delete':
      return applyPlanDelete(state, patch.id);
    case 'history.delete_run':
      return applyHistoryDeleteRun(state, patch.runId);
    case 'history.delete_plan_run':
      return applyHistoryDeletePlanRun(state, patch.planRunId);
    case 'history.purge':
      return applyHistoryPurge(state, patch.olderThanMs);
    case 'snapshot.capture':
      return applySnapshotCapture(state, patch, now);
    case 'snapshot.delete':
      return applySnapshotDelete(state, patch.id);
    case 'snapshot.restore':
      return applySnapshotRestore(state, patch.id, now);
    case 'snapshot.set_max_bytes':
      return applySnapshotSetMaxBytes(state, patch.maxBytes);
  }
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

function applyRequestCreate(
  state: WorkspaceState,
  request: ApiRequest,
  now: string,
): ApplyMutationResult {
  if (state.synced.collections.requests[request.id]) {
    return { next: state, changedIds: [] };
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    collections: {
      ...state.synced.collections,
      requests: { ...state.synced.collections.requests, [request.id]: request },
      tree: pushTreeChild(state.synced.collections.tree, { kind: 'request', id: request.id }),
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [request.id] };
}

function applyRequestUpdate(
  state: WorkspaceState,
  id: string,
  patch: Partial<Omit<ApiRequest, 'id' | 'createdAt'>>,
  now: string,
): ApplyMutationResult {
  const existing = state.synced.collections.requests[id];
  if (!existing) {
    return { next: state, changedIds: [] };
  }
  const updated: ApiRequest = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
  const synced: WorkspaceSynced = {
    ...state.synced,
    collections: {
      ...state.synced.collections,
      requests: { ...state.synced.collections.requests, [id]: updated },
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [id] };
}

function applyRequestDelete(state: WorkspaceState, id: string, now: string): ApplyMutationResult {
  if (!state.synced.collections.requests[id]) {
    return { next: state, changedIds: [] };
  }
  const requests = { ...state.synced.collections.requests };
  delete requests[id];
  const synced: WorkspaceSynced = {
    ...state.synced,
    collections: {
      ...state.synced.collections,
      requests,
      tree: removeTreeChild(state.synced.collections.tree, { kind: 'request', id }),
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  // Linked-request overrides live on `synced.linkedOverrides.requests`
  // and are keyed by the LINKED workspace's request id, not by an owned
  // request id. Deleting an owned request never touches them.
  return { next: { ...state, synced }, changedIds: [id] };
}

// ---------------------------------------------------------------------------
// Folder handlers
// ---------------------------------------------------------------------------

function applyFolderCreate(
  state: WorkspaceState,
  folder: Folder,
  now: string,
): ApplyMutationResult {
  if (state.synced.collections.folders[folder.id]) {
    return { next: state, changedIds: [] };
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    collections: {
      ...state.synced.collections,
      folders: { ...state.synced.collections.folders, [folder.id]: folder },
      tree: pushTreeChild(state.synced.collections.tree, { kind: 'folder', id: folder.id }),
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [folder.id] };
}

function applyFolderDelete(state: WorkspaceState, id: string, now: string): ApplyMutationResult {
  if (!state.synced.collections.folders[id]) {
    return { next: state, changedIds: [] };
  }
  const folders = { ...state.synced.collections.folders };
  delete folders[id];
  // Reparent any direct children to the deleted folder's parent.
  const deleted = state.synced.collections.folders[id];
  const reparented: Record<string, Folder> = {};
  for (const [fid, f] of Object.entries(folders)) {
    if (f.parentId === id) {
      reparented[fid] = { ...f, parentId: deleted.parentId };
    } else {
      reparented[fid] = f;
    }
  }
  const requests = { ...state.synced.collections.requests };
  for (const [rid, r] of Object.entries(requests)) {
    if (r.folderId === id) {
      requests[rid] = { ...r, folderId: deleted.parentId };
    }
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    collections: {
      ...state.synced.collections,
      folders: reparented,
      requests,
      tree: removeTreeChild(state.synced.collections.tree, { kind: 'folder', id }),
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [id] };
}

function applyFolderMove(
  state: WorkspaceState,
  id: string,
  newParentId: string | null,
  now: string,
): ApplyMutationResult {
  const folder = state.synced.collections.folders[id];
  if (!folder) {
    return { next: state, changedIds: [] };
  }
  if (folder.parentId === newParentId) {
    return { next: state, changedIds: [] };
  }
  // Reject self-parenting.
  if (newParentId === id) {
    return { next: state, changedIds: [] };
  }
  // Reject creating a cycle: walk up newParent's chain; if we hit `id`, abort.
  let cursor: string | null = newParentId;
  const folders = state.synced.collections.folders;
  while (cursor !== null) {
    if (cursor === id) return { next: state, changedIds: [] };
    cursor = folders[cursor]?.parentId ?? null;
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    collections: {
      ...state.synced.collections,
      folders: {
        ...state.synced.collections.folders,
        [id]: { ...folder, parentId: newParentId },
      },
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [id] };
}

/**
 * Result-shape escape hatch for the `folder.import_apicircle` handler:
 * the underlying graft helper returns a richer object than the rest of
 * the reducers. We surface only the root + descendant ids through
 * `ApplyMutationResult.changedIds`. Clients that need the full counts
 * or re-attachment list should call `importApicircleFolderInto`
 * directly — the patch path is intentionally lossy so every reducer
 * has the same `{ next, changedIds }` shape.
 */
function applyFolderImportApicircle(
  state: WorkspaceState,
  parsed: ParsedApicircleFolderExport,
  parentFolderId: string | null,
  now: string,
): ApplyMutationResult {
  const result: ImportApicircleFolderResult = importApicircleFolderInto(
    state.synced,
    parsed,
    parentFolderId,
  );
  const synced: WorkspaceSynced = {
    ...result.synced,
    meta: { ...result.synced.meta, updatedAt: now },
  };
  const changedIds = [
    result.rootFolderId,
    ...parsed.subfolders.map((f) => f.id),
    ...parsed.requests.map((r) => r.id),
  ];
  return { next: { ...state, synced }, changedIds };
}

// ---------------------------------------------------------------------------
// Environment handlers
// ---------------------------------------------------------------------------

function applyEnvUpsert(
  state: WorkspaceState,
  environment: {
    name: string;
    variables: Array<{ key: string; value: string; encrypted: boolean }>;
  },
  now: string,
): ApplyMutationResult {
  const trimmed = environment.name.trim();
  if (!trimmed) {
    return { next: state, changedIds: [] };
  }
  const isNew = !state.synced.environments.items[trimmed];
  const synced: WorkspaceSynced = {
    ...state.synced,
    environments: {
      ...state.synced.environments,
      items: {
        ...state.synced.environments.items,
        [trimmed]: { ...environment, name: trimmed },
      },
      // Newly-created envs land at the end of the priority list so they're
      // always reachable. Existing envs keep their position.
      priorityOrder:
        isNew &&
        !state.synced.environments.priorityOrder.some(
          (r) => r.kind === 'local' && r.name === trimmed,
        )
          ? [...state.synced.environments.priorityOrder, { kind: 'local', name: trimmed }]
          : state.synced.environments.priorityOrder,
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [trimmed] };
}

function applyEnvDelete(state: WorkspaceState, name: string, now: string): ApplyMutationResult {
  if (!state.synced.environments.items[name]) {
    return { next: state, changedIds: [] };
  }
  const items = { ...state.synced.environments.items };
  delete items[name];
  const synced: WorkspaceSynced = {
    ...state.synced,
    environments: {
      ...state.synced.environments,
      items,
      activeName:
        state.synced.environments.activeName === name ? null : state.synced.environments.activeName,
      priorityOrder: state.synced.environments.priorityOrder.filter(
        (r) => !(r.kind === 'local' && r.name === name),
      ),
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [name] };
}

function applyEnvSetActive(
  state: WorkspaceState,
  name: string | null,
  now: string,
): ApplyMutationResult {
  if (name !== null && !state.synced.environments.items[name]) {
    return { next: state, changedIds: [] };
  }
  if (state.synced.environments.activeName === name) {
    return { next: state, changedIds: [] };
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    environments: { ...state.synced.environments, activeName: name },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: name ? [name] : [] };
}

function applyEnvSetPriority(
  state: WorkspaceState,
  order: EnvPriorityRef[],
  now: string,
): ApplyMutationResult {
  // Filter against:
  //   - local envs: must be in `state.synced.environments.items`
  //   - linked envs: pass through unconditionally — the snapshot lives in
  //     `WorkspaceLocal.linkedCollections` which this reducer can't see.
  //     Stale linked refs are dropped at resolve time (handled by
  //     parseEnvPriorityKey returning null for unknown shapes).
  // Dedupe across both kinds via composite key.
  const knownLocal = new Set(Object.keys(state.synced.environments.items));
  const seen = new Set<string>();
  const filtered = order.filter((ref) => {
    const key = envPriorityKey(ref);
    if (seen.has(key)) return false;
    if (ref.kind === 'local' && !knownLocal.has(ref.name)) return false;
    seen.add(key);
    return true;
  });
  const synced: WorkspaceSynced = {
    ...state.synced,
    environments: { ...state.synced.environments, priorityOrder: filtered },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: filtered.map(envPriorityKey) };
}

// ---------------------------------------------------------------------------
// Secret-vault slot handlers
// ---------------------------------------------------------------------------

function applySecretKeyUpsert(
  state: WorkspaceState,
  meta: { id: string; label: string; salt: string; createdAt: string },
  now: string,
): ApplyMutationResult {
  // Defensive: an empty id or label would corrupt the slot map. Drop
  // silently so an MCP client batching multiple slot upserts doesn't
  // poison the workspace on a single malformed row.
  if (!meta.id || !meta.label.trim() || !meta.salt) {
    return { next: state, changedIds: [] };
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    secretKeys: {
      ...(state.synced.secretKeys ?? {}),
      [meta.id]: { ...meta, label: meta.label.trim() },
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [meta.id] };
}

function applySecretCryptoSet(
  state: WorkspaceState,
  crypto: SecretCryptoMeta,
  now: string,
): ApplyMutationResult {
  // Defensive: refuse to persist a malformed blob. The verifier MUST be
  // populated — without it `unlockSecretCrypto` can't reject a wrong
  // passphrase and we'd hand back a wrong key to every downstream
  // decrypt. salt + iterations are equally non-negotiable.
  if (
    !crypto ||
    crypto.kdf !== 'pbkdf2-sha256-v1' ||
    !crypto.salt ||
    !crypto.verifier ||
    !(crypto.iterations >= 1)
  ) {
    return { next: state, changedIds: [] };
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    secretCrypto: { ...crypto },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: ['secret.crypto'] };
}

function applySecretCryptoClear(state: WorkspaceState, now: string): ApplyMutationResult {
  // No-op if already cleared. Keeps `updatedAt` stable so repeated calls
  // don't churn the synced doc.
  if (!state.synced.secretCrypto) {
    return { next: state, changedIds: [] };
  }
  const synced: WorkspaceSynced = {
    ...state.synced,
    secretCrypto: null,
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: ['secret.crypto'] };
}

// ---------------------------------------------------------------------------
// Assertion handlers
// ---------------------------------------------------------------------------

function applyAssertionUpsert(
  state: WorkspaceState,
  requestId: string,
  assertion: { id: string; kind: string; op: string; expected: string | number; target?: string },
  now: string,
): ApplyMutationResult {
  const request = state.synced.collections.requests[requestId];
  if (!request) {
    return { next: state, changedIds: [] };
  }
  const idx = request.assertions.findIndex((a) => a.id === assertion.id);
  const next = [...request.assertions];
  if (idx === -1) {
    next.push(assertion as ApiRequest['assertions'][number]);
  } else {
    next[idx] = assertion as ApiRequest['assertions'][number];
  }
  return applyRequestUpdate(state, requestId, { assertions: next }, now);
}

function applyAssertionDelete(
  state: WorkspaceState,
  requestId: string,
  assertionId: string,
  now: string,
): ApplyMutationResult {
  const request = state.synced.collections.requests[requestId];
  if (!request) {
    return { next: state, changedIds: [] };
  }
  const next = request.assertions.filter((a) => a.id !== assertionId);
  if (next.length === request.assertions.length) {
    return { next: state, changedIds: [] };
  }
  return applyRequestUpdate(state, requestId, { assertions: next }, now);
}

// ---------------------------------------------------------------------------
// Mock handlers
// ---------------------------------------------------------------------------

function applyMockUpsert(
  state: WorkspaceState,
  mock: { id: string },
  now: string,
): ApplyMutationResult {
  const synced: WorkspaceSynced = {
    ...state.synced,
    mockServers: {
      ...state.synced.mockServers,
      [mock.id]: mock as WorkspaceSynced['mockServers'][string],
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [mock.id] };
}

function applyMockDelete(state: WorkspaceState, id: string, now: string): ApplyMutationResult {
  if (!state.synced.mockServers[id]) {
    return { next: state, changedIds: [] };
  }
  const mockServers = { ...state.synced.mockServers };
  delete mockServers[id];
  const synced: WorkspaceSynced = {
    ...state.synced,
    mockServers,
    meta: { ...state.synced.meta, updatedAt: now },
  };
  // Also clear runtime entry — a deleted definition can't have a live runtime.
  const local: WorkspaceLocal = state.local.mockRuntime.active[id]
    ? {
        ...state.local,
        mockRuntime: {
          active: Object.fromEntries(
            Object.entries(state.local.mockRuntime.active).filter(([k]) => k !== id),
          ),
        },
      }
    : state.local;
  return { next: { synced, local }, changedIds: [id] };
}

// ---------------------------------------------------------------------------
// Global file asset handlers (synced.globalAssets.files)
//
// `upsertFile` and `removeFile` are CRUD primitives. The four state-machine
// transitions (`markPushed`, `markMerged`, `cleanupWorkingRef`,
// `invalidateRef`) are driven by the push + refresh flows. Each preserves
// the provenance fields the caller didn't touch — e.g. `markMerged` does
// not clear `workingBranchRef`; that's the cleanup invariant's job.
//
// `removeFile` is the only one that cascades through other slices: every
// request body + mock-response body that referenced the asset id gets
// unbound. The helpers below mirror `clearGlobalFileAssetFromBody` and
// friends from `globalAssetsActions.ts` — kept inline so the core layer
// has no UI-store dependency.
// ---------------------------------------------------------------------------

function applyGlobalAssetUpsertFile(
  state: WorkspaceState,
  file: GlobalFileAsset,
  now: string,
): ApplyMutationResult {
  const files = state.synced.globalAssets.files ?? {};
  const existing = files[file.id];
  // If the caller didn't carry the ref fields, preserve the existing ones.
  // Stops a generic `upsert` from accidentally erasing provenance the
  // push/refresh flows worked to establish.
  const next: GlobalFileAsset = {
    ...file,
    workingBranchRef:
      file.workingBranchRef !== undefined ? file.workingBranchRef : existing?.workingBranchRef,
    baseBranchRef: file.baseBranchRef !== undefined ? file.baseBranchRef : existing?.baseBranchRef,
    updatedAt: now,
  };
  const synced: WorkspaceSynced = {
    ...state.synced,
    globalAssets: {
      ...state.synced.globalAssets,
      files: { ...files, [file.id]: next },
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [file.id] };
}

function applyGlobalAssetRemoveFile(
  state: WorkspaceState,
  id: string,
  now: string,
): ApplyMutationResult {
  const files = state.synced.globalAssets.files ?? {};
  if (!files[id]) {
    return { next: state, changedIds: [] };
  }
  const { [id]: _drop, ...rest } = files;
  void _drop;

  // Cascade — clear `globalFileAssetId` on every request body + mock
  // response body that referenced the asset.
  const requests = { ...state.synced.collections.requests };
  for (const [reqId, req] of Object.entries(requests)) {
    const body = clearAssetFromRequestBody(req.body, id);
    if (body !== req.body) requests[reqId] = { ...req, body, updatedAt: now };
  }

  const mockServers = { ...state.synced.mockServers };
  for (const [serverId, server] of Object.entries(mockServers)) {
    let touchedServer = false;
    const endpoints = server.endpoints.map((endpoint) => {
      let touched = false;
      const defaultResponse = clearAssetFromMockResponse(endpoint.defaultResponse, id);
      if (defaultResponse !== endpoint.defaultResponse) touched = true;
      const requestValidation = endpoint.requestValidation.map((rule) => {
        const failResponse = clearAssetFromMockResponse(rule.failResponse, id);
        if (failResponse === rule.failResponse) return rule;
        touched = true;
        return { ...rule, failResponse };
      });
      const responseRules = endpoint.responseRules.map((rule) => {
        const response = clearAssetFromMockResponse(rule.response, id);
        if (response === rule.response) return rule;
        touched = true;
        return { ...rule, response };
      });
      if (!touched) return endpoint;
      touchedServer = true;
      return { ...endpoint, defaultResponse, requestValidation, responseRules };
    });
    if (touchedServer) {
      // `source.kind === 'manual'` carries a parallel `endpoints` copy that
      // the manual-source editor reads from; mirror the same touch there.
      const source =
        server.source.kind === 'manual' ? { kind: 'manual' as const, endpoints } : server.source;
      mockServers[serverId] = { ...server, source, endpoints, updatedAt: now };
    }
  }

  // Drop the local-only buffers tied to this asset so reads don't return
  // stale "Uploaded locally" / "Used by N" entries after the delete.
  let local = state.local;
  if (local.pendingFileUploads && local.pendingFileUploads[id]) {
    const nextPending = { ...local.pendingFileUploads };
    delete nextPending[id];
    local = { ...local, pendingFileUploads: nextPending };
  }
  if (local.assetUsageIndex && local.assetUsageIndex[id]) {
    const nextUsage = { ...local.assetUsageIndex };
    delete nextUsage[id];
    local = { ...local, assetUsageIndex: nextUsage };
  }

  // Queue the attachment blob for deletion on the next push IF the asset
  // ever made it to a remote ref. Otherwise the bytes were only ever in
  // local IDB — there's no remote tree entry to delete, so we skip the
  // queue. The push flow emits `{path: '.apicircle/attachments/<slotId>',
  // sha: null}` over `base_tree` for every queued slot id, which GitHub
  // treats as a tree-entry deletion. The eventual PR merge then carries
  // the deletion through to the base branch.
  const existing = files[id];
  const hadRemoteRef = Boolean(existing.workingBranchRef || existing.baseBranchRef);
  if (hadRemoteRef && !(local.pendingAttachmentDeletes ?? []).includes(existing.slotId)) {
    local = {
      ...local,
      pendingAttachmentDeletes: [...(local.pendingAttachmentDeletes ?? []), existing.slotId],
    };
  }

  const synced: WorkspaceSynced = {
    ...state.synced,
    collections: { ...state.synced.collections, requests },
    mockServers,
    globalAssets: { ...state.synced.globalAssets, files: rest },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { synced, local }, changedIds: [id] };
}

function applyGlobalAssetMarkPushed(
  state: WorkspaceState,
  id: string,
  ref: AssetGitRef,
  now: string,
): ApplyMutationResult {
  return mutateAssetRef(state, id, now, (asset) => ({ ...asset, workingBranchRef: ref }));
}

function applyGlobalAssetMarkMerged(
  state: WorkspaceState,
  id: string,
  ref: AssetGitRef,
  now: string,
): ApplyMutationResult {
  return mutateAssetRef(state, id, now, (asset) => ({ ...asset, baseBranchRef: ref }));
}

function applyGlobalAssetCleanupWorkingRef(
  state: WorkspaceState,
  id: string,
  now: string,
): ApplyMutationResult {
  return mutateAssetRef(state, id, now, (asset) => {
    if (!asset.workingBranchRef) return asset;
    return { ...asset, workingBranchRef: null };
  });
}

function applyGlobalAssetInvalidateRef(
  state: WorkspaceState,
  id: string,
  which: 'working' | 'base',
  now: string,
): ApplyMutationResult {
  return mutateAssetRef(state, id, now, (asset) => {
    if (which === 'working') {
      if (!asset.workingBranchRef) return asset;
      return { ...asset, workingBranchRef: null };
    }
    if (!asset.baseBranchRef) return asset;
    return { ...asset, baseBranchRef: null };
  });
}

function mutateAssetRef(
  state: WorkspaceState,
  id: string,
  now: string,
  transform: (asset: GlobalFileAsset) => GlobalFileAsset,
): ApplyMutationResult {
  const files = state.synced.globalAssets.files ?? {};
  const existing = files[id];
  if (!existing) return { next: state, changedIds: [] };
  const updated = transform(existing);
  if (updated === existing) return { next: state, changedIds: [] };
  const next: GlobalFileAsset = { ...updated, updatedAt: now };
  const synced: WorkspaceSynced = {
    ...state.synced,
    globalAssets: {
      ...state.synced.globalAssets,
      files: { ...files, [id]: next },
    },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: [id] };
}

function clearAssetFromRequestBody(body: RequestBody, id: string): RequestBody {
  if (body.type === 'binary' && body.attachment?.globalFileAssetId === id) {
    return { type: 'binary', content: '' };
  }
  if (body.type !== 'form-data' || !body.formRows) return body;
  let touched = false;
  const formRows = body.formRows.map((row): FormDataRow => {
    if (row.kind !== 'file' || row.globalFileAssetId !== id) return row;
    touched = true;
    return { kind: 'file', key: row.key, enabled: row.enabled, slotId: null };
  });
  return touched ? { ...body, formRows } : body;
}

function clearAssetFromMockResponse(response: MockResponseConfig, id: string): MockResponseConfig {
  const body = clearAssetFromMockBody(response.body, id);
  return body === response.body ? response : { ...response, body };
}

function clearAssetFromMockBody(body: MockResponseBody, id: string): MockResponseBody {
  if (body.type === 'binary' && body.attachment?.globalFileAssetId === id) {
    return { type: 'binary', content: '' };
  }
  return body;
}

// ---------------------------------------------------------------------------
// Plan handlers (WorkspaceLocal — never pushed to git)
// ---------------------------------------------------------------------------

function applyPlanUpsert(
  state: WorkspaceState,
  plan: { id: string },
  now: string,
): ApplyMutationResult {
  const existing = state.local.executionPlans[plan.id];
  const merged = existing
    ? { ...existing, ...plan, id: existing.id, createdAt: existing.createdAt, updatedAt: now }
    : { ...plan, updatedAt: now };
  const local: WorkspaceLocal = {
    ...state.local,
    executionPlans: {
      ...state.local.executionPlans,
      [plan.id]: merged as WorkspaceLocal['executionPlans'][string],
    },
  };
  return { next: { ...state, local }, changedIds: [plan.id] };
}

function applyPlanDelete(state: WorkspaceState, id: string): ApplyMutationResult {
  if (!state.local.executionPlans[id]) {
    return { next: state, changedIds: [] };
  }
  const next = { ...state.local.executionPlans };
  delete next[id];
  // Drop history rows too — they'd dangle to a non-existent plan.
  const planRuns = state.local.history.planRuns.filter((r) => r.planId !== id);
  const local: WorkspaceLocal = {
    ...state.local,
    executionPlans: next,
    history: { ...state.local.history, planRuns },
  };
  return { next: { ...state, local }, changedIds: [id] };
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function pushTreeChild(
  tree: FolderNode,
  child: { kind: 'folder' | 'request'; id: string },
): FolderNode {
  return { ...tree, children: [...tree.children, child] };
}

function removeTreeChild(
  tree: FolderNode,
  child: { kind: 'folder' | 'request'; id: string },
): FolderNode {
  return {
    ...tree,
    children: tree.children.filter((c) => !(c.kind === child.kind && c.id === child.id)),
  };
}

// ---------------------------------------------------------------------------
// History handlers (WorkspaceLocal — never pushed to git). Each is pure: drop
// the matching row(s) and return the new state. The MCP host uses these to
// expose "delete a single run" and "purge older than N days" so users can
// keep their local IDB footprint bounded.
// ---------------------------------------------------------------------------

function applyHistoryDeleteRun(state: WorkspaceState, runId: string): ApplyMutationResult {
  const before = state.local.history.requestRuns;
  const after = before.filter((r) => r.id !== runId);
  if (after.length === before.length) {
    return { next: state, changedIds: [] };
  }
  const local: WorkspaceLocal = {
    ...state.local,
    history: { ...state.local.history, requestRuns: after },
  };
  return { next: { ...state, local }, changedIds: [runId] };
}

function applyHistoryDeletePlanRun(state: WorkspaceState, planRunId: string): ApplyMutationResult {
  const before = state.local.history.planRuns;
  const after = before.filter((r) => r.id !== planRunId);
  if (after.length === before.length) {
    return { next: state, changedIds: [] };
  }
  const local: WorkspaceLocal = {
    ...state.local,
    history: { ...state.local.history, planRuns: after },
  };
  return { next: { ...state, local }, changedIds: [planRunId] };
}

// ---------------------------------------------------------------------------
// Snapshot handlers (WorkspaceLocal.snapshots — never pushed to git). Each
// snapshot is a verbatim copy of `synced` plus metadata. Capture pushes a
// new entry and evicts oldest until total size is under `maxBytes`. Restore
// replaces `synced` with the snapshot's stored doc and clears
// `local.sync.lastPulledSnapshot` so the next push surfaces the restore as
// a logical re-fork rather than a no-op.
// ---------------------------------------------------------------------------

function approxJsonByteLength(value: unknown): number {
  // JSON.stringify is the closest proxy to what IDB will persist; encoding
  // costs are ~1 byte/char for ASCII payloads. Multi-byte chars under-count
  // slightly, which is fine — the cap is a soft eviction trigger, not a
  // hard quota.
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function evictSnapshotsToCap(
  entries: WorkspaceSnapshot[],
  maxBytes: number,
): { entries: WorkspaceSnapshot[]; evictedIds: string[] } {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return { entries, evictedIds: [] };
  }
  let total = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  if (total <= maxBytes) return { entries, evictedIds: [] };
  // Sort oldest-first so we drop the front of the list. We rebuild the
  // array rather than mutating it in place.
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const evictedIds: string[] = [];
  while (total > maxBytes && sorted.length > 0) {
    const dropped = sorted.shift()!;
    evictedIds.push(dropped.id);
    total -= dropped.sizeBytes;
  }
  // Restore newest-first ordering so callers' "first entry is most recent"
  // assumption holds (the History panel renders in this order).
  return {
    entries: sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    evictedIds,
  };
}

function applySnapshotCapture(
  state: WorkspaceState,
  args: { trigger: WorkspaceSnapshotTrigger; note?: string; id?: string },
  now: string,
): ApplyMutationResult {
  const id = args.id ?? generateId();
  const snapshot: WorkspaceSnapshot = {
    id,
    createdAt: now,
    triggeredBy: args.trigger,
    note: args.note,
    workspaceSyncedSnapshot: state.synced,
    sizeBytes: approxJsonByteLength(state.synced),
  };
  const ledger = state.local.snapshots;
  // Newest-first so the History panel can iterate without sorting.
  const merged = [snapshot, ...ledger.entries];
  const { entries, evictedIds } = evictSnapshotsToCap(merged, ledger.maxBytes);
  const local: WorkspaceLocal = {
    ...state.local,
    snapshots: { ...ledger, entries },
  };
  return { next: { ...state, local }, changedIds: [id, ...evictedIds] };
}

function applySnapshotDelete(state: WorkspaceState, id: string): ApplyMutationResult {
  const before = state.local.snapshots.entries;
  const after = before.filter((s) => s.id !== id);
  if (after.length === before.length) {
    return { next: state, changedIds: [] };
  }
  const local: WorkspaceLocal = {
    ...state.local,
    snapshots: { ...state.local.snapshots, entries: after },
  };
  return { next: { ...state, local }, changedIds: [id] };
}

function applySnapshotRestore(state: WorkspaceState, id: string, now: string): ApplyMutationResult {
  const target = state.local.snapshots.entries.find((s) => s.id === id);
  if (!target) {
    return { next: state, changedIds: [] };
  }
  // The synced doc replaces wholesale. The snapshot's own meta.updatedAt
  // is preserved so the user can see how stale the restored state was;
  // top-level workspace updatedAt re-stamps to `now` so downstream
  // consumers (the diff summary, last-pull tracker) see the change.
  const synced: WorkspaceSynced = {
    ...target.workspaceSyncedSnapshot,
    meta: { ...target.workspaceSyncedSnapshot.meta, updatedAt: now },
  };
  // Restore is logically a re-fork: anything in the upstream remote will
  // diverge from our restored state. Clear `lastPulledSnapshot` so the
  // diff summary surfaces every restored entry as "new" against remote.
  const local: WorkspaceLocal = {
    ...state.local,
    sync: {
      ...state.local.sync,
      lastPulledSnapshot: null,
      lastPulledSha: null,
    },
  };
  return { next: { synced, local }, changedIds: [id] };
}

function applySnapshotSetMaxBytes(state: WorkspaceState, maxBytes: number): ApplyMutationResult {
  if (maxBytes < 0) maxBytes = 0;
  const ledger = state.local.snapshots;
  const { entries, evictedIds } = evictSnapshotsToCap(ledger.entries, maxBytes);
  const local: WorkspaceLocal = {
    ...state.local,
    snapshots: { entries, maxBytes },
  };
  return { next: { ...state, local }, changedIds: evictedIds };
}

function applyHistoryPurge(state: WorkspaceState, olderThanMs: number): ApplyMutationResult {
  // `olderThanMs` is the cutoff age in milliseconds. Runs whose `startedAt`
  // is older than `now - olderThanMs` get dropped. Pass 0 to clear
  // everything; pass Number.POSITIVE_INFINITY to be a no-op.
  const cutoff = Date.now() - olderThanMs;
  const dropped: string[] = [];
  const requestRuns = state.local.history.requestRuns.filter((r) => {
    const t = Date.parse(r.startedAt);
    if (Number.isFinite(t) && t < cutoff) {
      dropped.push(r.id);
      return false;
    }
    return true;
  });
  const planRuns = state.local.history.planRuns.filter((r) => {
    const t = Date.parse(r.startedAt);
    if (Number.isFinite(t) && t < cutoff) {
      dropped.push(r.id);
      return false;
    }
    return true;
  });
  if (dropped.length === 0) {
    return { next: state, changedIds: [] };
  }
  const local: WorkspaceLocal = {
    ...state.local,
    history: { ...state.local.history, requestRuns, planRuns },
  };
  return { next: { ...state, local }, changedIds: dropped };
}
