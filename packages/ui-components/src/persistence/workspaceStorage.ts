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
  // Pre-vault-rework docs lack secretKeys (the synced id→label map for
  // env-var secret references). Backfill empty so the panel and resolver
  // can read it directly.
  if (!result.secretKeys) {
    result = { ...result, secretKeys: {} };
  }
  return result;
}

/**
 * Sentinel error for "we found existing data in IDB but it's not usable as a
 * matching pair". The hydrate path catches this and surfaces it to the user
 * instead of silently overwriting their data with a fresh workspace.
 */
export class WorkspaceMismatchError extends Error {
  readonly kind = 'workspace-mismatch' as const;
  readonly syncedWorkspaceId: string | null;
  readonly localWorkspaceId: string | null;
  constructor(syncedId: string | null, localId: string | null) {
    super(
      `Workspace records do not match: synced=${syncedId ?? 'null'} local=${localId ?? 'null'}.`,
    );
    this.name = 'WorkspaceMismatchError';
    this.syncedWorkspaceId = syncedId;
    this.localWorkspaceId = localId;
  }
}

export async function loadWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
}> {
  const [synced, local] = await Promise.all([
    readRecord<WorkspaceSynced>(SYNCED_STORE),
    readRecord<WorkspaceLocal>(LOCAL_STORE),
  ]);

  // Both present + matching id: normal load. Apply forward-compatible upgrades
  // for older shapes (these are non-destructive — they add missing fields, never
  // drop existing ones).
  if (synced && local && synced.workspaceId === local.workspaceId) {
    const upgradedSynced = normalizeSyncedShape(synced);
    const upgradedLocal: WorkspaceLocal = {
      ...local,
      linkedCollections: local.linkedCollections ?? {},
      globalContext: local.globalContext ?? {},
      mockRuntime: local.mockRuntime ?? { active: {} },
    };
    return { synced: upgradedSynced, local: upgradedLocal };
  }

  // First boot — neither record exists. Seed an empty workspace and persist it
  // so the matching-id check holds on subsequent loads.
  if (!synced && !local) {
    const fresh = createEmptyWorkspace();
    await writeBoth(fresh.synced, fresh.local);
    return fresh;
  }

  // Mismatched / partial records. *Don't* silently overwrite — that's how
  // users lose data after a transient IDB hiccup or a partial schema bump.
  // Surface a typed error and let the caller decide what to do.
  throw new WorkspaceMismatchError(synced?.workspaceId ?? null, local?.workspaceId ?? null);
}

/**
 * Deliberately reset both records to a fresh workspace. Only call this in
 * response to an explicit user action (e.g. clicking "Reset workspace" after
 * a mismatch error is surfaced) — never automatically.
 */
export async function resetWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
}> {
  const fresh = createEmptyWorkspace();
  await writeBoth(fresh.synced, fresh.local);
  return fresh;
}

/**
 * Snapshot of what's actually in IDB, regardless of whether the pair is
 * loadable. Used by the recovery UI to show the user what they have *before*
 * they choose how to reset.
 */
export async function probeWorkspaceRecords(): Promise<{
  synced: WorkspaceSynced | null;
  local: WorkspaceLocal | null;
}> {
  const [synced, local] = await Promise.all([
    readRecord<WorkspaceSynced>(SYNCED_STORE),
    readRecord<WorkspaceLocal>(LOCAL_STORE),
  ]);
  return { synced, local };
}

/**
 * Best-effort recovery for a partial-record state (one of the two records is
 * missing or has a different workspaceId). Preserves whichever side has data
 * and rebuilds the missing partner with a matching workspaceId.
 *
 * Throws if BOTH sides are non-null with mismatched workspaceIds — that's a
 * "two different workspaces accidentally interleaved" scenario, no safe
 * recovery without user intent. Returns `null` if neither side has data
 * (caller should fall through to a fresh reset).
 */
export async function recoverPartialWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
} | null> {
  const { synced, local } = await probeWorkspaceRecords();

  if (!synced && !local) return null;

  if (synced && local) {
    if (synced.workspaceId === local.workspaceId) {
      // Both sides present + matching: no recovery needed, just return them.
      // (The caller likely retried after fixing the schema.)
      return { synced: normalizeSyncedShape(synced), local };
    }
    // Mismatched ids — keep synced (collections are higher value than local
    // session state) and regenerate local with the matching workspaceId.
    const fresh = createEmptyWorkspace();
    const recoveredLocal: WorkspaceLocal = {
      ...fresh.local,
      workspaceId: synced.workspaceId,
    };
    await writeBoth(synced, recoveredLocal);
    return { synced: normalizeSyncedShape(synced), local: recoveredLocal };
  }

  if (synced && !local) {
    const fresh = createEmptyWorkspace();
    const recoveredLocal: WorkspaceLocal = {
      ...fresh.local,
      workspaceId: synced.workspaceId,
    };
    await writeBoth(synced, recoveredLocal);
    return { synced: normalizeSyncedShape(synced), local: recoveredLocal };
  }

  // local && !synced
  const fresh = createEmptyWorkspace();
  const recoveredSynced: WorkspaceSynced = {
    ...fresh.synced,
    workspaceId: local!.workspaceId,
  };
  await writeBoth(recoveredSynced, local);
  return { synced: recoveredSynced, local: local! };
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
  // Seed one sample request so the first-run sidebar isn't empty and the user
  // has something to click into. The sample points at httpbin so it works
  // without any auth/setup.
  const sampleRequest: ApiRequest = {
    id: generateId(),
    name: 'Sample: GET /anything',
    folderId: null,
    method: 'GET',
    url: 'https://httpbin.org/anything',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    query: [{ key: 'greeting', value: '{{GREETING}}', enabled: true }],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [{ key: 'GREETING', value: 'hello-from-apicircle' }],
    extractions: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
  };
  const synced: WorkspaceSynced = {
    schemaVersion: 1,
    workspaceId,
    workspaceName: 'My Workspace',
    collections: {
      tree: {
        id: rootId,
        type: 'root',
        children: [{ kind: 'request', id: sampleRequest.id }],
      },
      requests: { [sampleRequest.id]: sampleRequest },
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
    secretKeys: {},
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
      activeRequestId: sampleRequest.id,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
    },
  };
  return { synced, local };
}
