import type {
  Folder,
  FolderNode,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { WorkspacePatch, WorkspaceState } from './patches';

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
    case 'environment.upsert':
      return applyEnvUpsert(state, patch.environment, now);
    case 'environment.delete':
      return applyEnvDelete(state, patch.name, now);
    case 'environment.setActive':
      return applyEnvSetActive(state, patch.name, now);
    case 'environment.setPriority':
      return applyEnvSetPriority(state, patch.order, now);
    case 'assertion.upsert':
      return applyAssertionUpsert(state, patch.requestId, patch.assertion, now);
    case 'assertion.delete':
      return applyAssertionDelete(state, patch.requestId, patch.assertionId, now);
    case 'mock.upsert':
      return applyMockUpsert(state, patch.mock, now);
    case 'mock.delete':
      return applyMockDelete(state, patch.id, now);
    case 'plan.upsert':
      return applyPlanUpsert(state, patch.plan, now);
    case 'plan.delete':
      return applyPlanDelete(state, patch.id);
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
  // Drop overrides whose key targets this request id.
  const overrideEntries = Object.entries(state.local.overrides.items).filter(
    ([, override]) => override.itemId !== id,
  );
  const local: WorkspaceLocal =
    overrideEntries.length === Object.keys(state.local.overrides.items).length
      ? state.local
      : {
          ...state.local,
          overrides: { items: Object.fromEntries(overrideEntries) },
        };
  return { next: { synced, local }, changedIds: [id] };
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
        isNew && !state.synced.environments.priorityOrder.includes(trimmed)
          ? [...state.synced.environments.priorityOrder, trimmed]
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
      priorityOrder: state.synced.environments.priorityOrder.filter((n) => n !== name),
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
  order: string[],
  now: string,
): ApplyMutationResult {
  const known = new Set(Object.keys(state.synced.environments.items));
  const seen = new Set<string>();
  const filtered = order.filter((n) => {
    if (!known.has(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const synced: WorkspaceSynced = {
    ...state.synced,
    environments: { ...state.synced.environments, priorityOrder: filtered },
    meta: { ...state.synced.meta, updatedAt: now },
  };
  return { next: { ...state, synced }, changedIds: filtered };
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
