import type { Request as ApiRequest, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { generateId, normalizeAuth } from '@apicircle/shared';
import { LOCAL_STORE, readRecord, SYNCED_STORE, writeBoth, writeRecord } from './db';

// Forward-compatible upgrades for older synced docs. Pre-P13 docs lack the
// `auth` field on Request; pre-P16 docs lack `extractions`. Fill defaults
// instead of erroring.
function normalizeSyncedShape(synced: WorkspaceSynced): WorkspaceSynced {
  let touched = false;
  const requests: Record<string, ApiRequest> = {};
  for (const [id, req] of Object.entries(synced.collections.requests)) {
    let next = req;
    if (!next.auth) {
      touched = true;
      next = { ...next, auth: normalizeAuth((next as { auth?: unknown }).auth) };
    }
    if (!Array.isArray(next.extractions)) {
      touched = true;
      next = { ...next, extractions: [] };
    }
    requests[id] = next;
  }
  const out: WorkspaceSynced = touched
    ? { ...synced, collections: { ...synced.collections, requests } }
    : synced;
  // Pre-P17 docs lack globalAssets. Backfill an empty library so the
  // Global Assets panel works without requiring a fresh workspace.
  let result = out;
  if (!result.globalAssets) {
    result = { ...result, globalAssets: { schemas: {}, graphql: {} } };
  }
  // Pre-P23 docs lack mockServers. Backfill an empty registry so the
  // Mock Servers panel works without requiring a fresh workspace.
  if (!result.mockServers) {
    result = { ...result, mockServers: {} };
  }
  return result;
}

export async function loadWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
}> {
  const [synced, local] = await Promise.all([
    readRecord<WorkspaceSynced>(SYNCED_STORE),
    readRecord<WorkspaceLocal>(LOCAL_STORE),
  ]);
  if (synced && local && synced.workspaceId === local.workspaceId) {
    const upgradedSynced = normalizeSyncedShape(synced);
    // Forward-compatible shim: add `linkedCollections` to legacy local
    // records that pre-date P5.8. This lets older workspaces load
    // without a hard schema bump while new persistence always writes
    // the field.
    const upgradedLocal: WorkspaceLocal = {
      ...local,
      linkedCollections: local.linkedCollections ?? {},
      globalContext: local.globalContext ?? {},
      mockRuntime: local.mockRuntime ?? { active: {} },
    };
    return { synced: upgradedSynced, local: upgradedLocal };
  }
  // First boot, schema mismatch, or split records — reset to a fresh pair.
  const fresh = createEmptyWorkspace();
  await writeBoth(fresh.synced, fresh.local);
  return fresh;
}

export async function saveSynced(synced: WorkspaceSynced): Promise<void> {
  await writeRecord(SYNCED_STORE, synced);
}

export async function saveLocal(local: WorkspaceLocal): Promise<void> {
  await writeRecord(LOCAL_STORE, local);
}

export async function saveBoth(synced: WorkspaceSynced, local: WorkspaceLocal): Promise<void> {
  await writeBoth(synced, local);
}

export function createEmptyWorkspace(): { synced: WorkspaceSynced; local: WorkspaceLocal } {
  const workspaceId = generateId();
  const now = new Date().toISOString();
  const rootId = generateId();
  const synced: WorkspaceSynced = {
    schemaVersion: 1,
    workspaceId,
    workspaceName: 'My Workspace',
    collections: {
      tree: { id: rootId, type: 'root', children: [] },
      requests: {},
      folders: {},
    },
    environments: {
      items: {},
      activeName: null,
      priorityOrder: [],
    },
    linkedWorkspaces: {},
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
  };
  const local: WorkspaceLocal = {
    schemaVersion: 1,
    workspaceId,
    overrides: { items: {} },
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: null },
    connectedRepo: null,
    workingBranch: null,
    sync: {
      lastPulledSnapshot: null,
      lastPulledSha: null,
      lastPulledAt: null,
      dirtyKeys: [],
    },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
    },
  };
  return { synced, local };
}
