import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle-v2/shared';
import { generateId } from '@apicircle-v2/shared';
import { LOCAL_STORE, readRecord, SYNCED_STORE, writeBoth, writeRecord } from './db';

export async function loadWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
}> {
  const [synced, local] = await Promise.all([
    readRecord<WorkspaceSynced>(SYNCED_STORE),
    readRecord<WorkspaceLocal>(LOCAL_STORE),
  ]);
  if (synced && local && synced.workspaceId === local.workspaceId) {
    return { synced, local };
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
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
    },
  };
  return { synced, local };
}
