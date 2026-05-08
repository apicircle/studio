import type {
  FontFamilyId,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { generateId, normalizeAuth } from '@apicircle/shared';
import {
  LOCAL_STORE,
  readRecord,
  readRegistry,
  SYNCED_STORE,
  writeBoth,
  writeRecord,
  writeRegistry,
  deleteWorkspaceRecords,
} from './db';
import type { WorkspaceRegistry, WorkspaceRegistryEntry } from './db';

export type { WorkspaceRegistry, WorkspaceRegistryEntry } from './db';

// Pre-fix font preference lived in localStorage[FONT_STORAGE_KEY] —
// migrate it into the workspace doc on first hydrate, then forget about
// localStorage entirely. Returning null falls back to `'system-mono'`
// at the call site.
const LEGACY_FONT_STORAGE_KEY = 'apicircle-v2:font';
const VALID_FONT_IDS = new Set([
  'system-mono',
  'jetbrains-mono',
  'fira-code',
  'cascadia-code',
  'ibm-plex-mono',
  'system-sans',
  'inter',
]);
function readLegacyFontFromLocalStorage(): FontFamilyId | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const stored = localStorage.getItem(LEGACY_FONT_STORAGE_KEY);
    if (stored && VALID_FONT_IDS.has(stored)) return stored as FontFamilyId;
  } catch {
    /* localStorage may be disabled — fall through */
  }
  return null;
}

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
  let result = out;
  if (!result.globalAssets) {
    result = { ...result, globalAssets: { schemas: {}, graphql: {} } };
  }
  if (!result.mockServers) {
    result = { ...result, mockServers: {} };
  }
  if (!result.secretKeys) {
    result = { ...result, secretKeys: {} };
  }
  if (!result.linkedOverrides) {
    result = { ...result, linkedOverrides: { requests: {}, environmentVars: {} } };
  }
  // Mock-server reshape (Mocks-redesign): legacy MockEndpoint had a flat
  // `{ status, headers, body, delayMs }` shape; the new shape is
  // `{ requestSchema, requestValidation[], responseRules[], defaultResponse }`.
  // Promote the legacy fields into the new defaultResponse + seed empty
  // schema / rules. Idempotent: re-running over an already-migrated doc
  // is a no-op.
  if (result.mockServers) {
    let mockTouched = false;
    const migratedServers: typeof result.mockServers = {};
    for (const [id, server] of Object.entries(result.mockServers)) {
      const endpoints = server.endpoints.map(migrateLegacyEndpoint);
      const sourceUpgraded =
        server.source.kind === 'manual' ? { ...server.source, endpoints } : server.source;
      const same = endpoints.every((e, i) => e === server.endpoints[i]);
      if (!same || sourceUpgraded !== server.source) mockTouched = true;
      migratedServers[id] = { ...server, source: sourceUpgraded, endpoints };
    }
    if (mockTouched) result = { ...result, mockServers: migratedServers };
  }
  return result;
}

// Reshape a legacy MockEndpoint (or already-new shape) into the new
// rules-aware shape. Detects the legacy form by looking for a top-level
// `status` field — the new shape has `defaultResponse.status` instead.
function migrateLegacyEndpoint(
  e: WorkspaceSynced['mockServers'][string]['endpoints'][number],
): WorkspaceSynced['mockServers'][string]['endpoints'][number] {
  const legacy = e as unknown as {
    id: string;
    method: WorkspaceSynced['mockServers'][string]['endpoints'][number]['method'];
    pathPattern: string;
    status?: number;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    delayMs?: number;
    example?: string;
    requestSchema?: unknown;
    requestValidation?: unknown[];
    responseRules?: unknown[];
    defaultResponse?: unknown;
    name?: string;
  };
  if (legacy.defaultResponse !== undefined) return e;
  return {
    id: legacy.id,
    name: legacy.name ?? `${legacy.method} ${legacy.pathPattern}`,
    method: legacy.method,
    pathPattern: legacy.pathPattern,
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: [],
    responseRules: [],
    defaultResponse: {
      status: legacy.status ?? 200,
      headers: (legacy.headers ?? []).map((h) => ({ ...h, enabled: true })),
      body: legacy.body
        ? { type: 'json' as const, content: legacy.body }
        : { type: 'none' as const, content: '' },
      ...(legacy.delayMs !== undefined ? { delayMs: legacy.delayMs } : {}),
    },
    ...(legacy.example !== undefined ? { example: legacy.example } : {}),
  };
}

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

/**
 * Boot path: load the active workspace from the registry, or create a
 * fresh one if no registry exists yet (first run on this device).
 *
 * The registry is the single source of truth for which workspace is
 * active. Pre-B.6 single-workspace data was migrated into the registry
 * by the v3 IDB upgrade — boot just loads whatever the registry says.
 */
export async function loadWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistry;
}> {
  const registry = await readRegistry();

  if (!registry || !registry.activeWorkspaceId || registry.workspaces.length === 0) {
    // First boot — seed an empty workspace, register it as the active one.
    const fresh = createEmptyWorkspace();
    const now = new Date().toISOString();
    const entry: WorkspaceRegistryEntry = {
      id: fresh.synced.workspaceId,
      name: fresh.synced.workspaceName,
      createdAt: now,
      lastOpenedAt: now,
    };
    const seededRegistry: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: entry.id,
      workspaces: [entry],
    };
    await writeBoth(fresh.synced, fresh.local);
    await writeRegistry(seededRegistry);
    return { synced: fresh.synced, local: fresh.local, registry: seededRegistry };
  }

  const activeId = registry.activeWorkspaceId;
  return loadWorkspaceById(activeId, registry);
}

export async function loadWorkspaceById(
  workspaceId: string,
  registry: WorkspaceRegistry,
): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistry;
}> {
  const [synced, local] = await Promise.all([
    readRecord<WorkspaceSynced>(SYNCED_STORE, workspaceId),
    readRecord<WorkspaceLocal>(LOCAL_STORE, workspaceId),
  ]);

  if (synced && local && synced.workspaceId === local.workspaceId) {
    const upgradedSynced = normalizeSyncedShape(synced);
    const upgradedLocal: WorkspaceLocal = {
      ...local,
      linkedCollections: local.linkedCollections ?? {},
      globalContext: local.globalContext ?? {},
      mockRuntime: local.mockRuntime ?? { active: {} },
      // Forward-fill new settings keys when hydrating older workspaces;
      // existing fields are preserved so user choices stick.
      settings: {
        validateOnSend: local.settings?.validateOnSend ?? true,
        monacoConsumesWheel: local.settings?.monacoConsumesWheel ?? false,
      },
      // Snapshot ledger added in Phase 6. Older workspaces hydrate with
      // an empty ledger and the default 50 MB cap.
      snapshots: local.snapshots ?? { entries: [], maxBytes: 50 * 1024 * 1024 },
      // Backfill the workspace-bound font id (added in the
      // font-binding fix). Pre-fix the choice lived in localStorage;
      // first hydrate after the fix migrates that legacy value into
      // local.ui.fontId, falling back to the safe default.
      ui: local.ui.fontId
        ? local.ui
        : { ...local.ui, fontId: readLegacyFontFromLocalStorage() ?? 'system-mono' },
    };
    return { synced: upgradedSynced, local: upgradedLocal, registry };
  }

  // Registry says this workspace exists but its records are missing or
  // mismatched. Treat as a partial-record state — caller decides
  // whether to recover or error.
  throw new WorkspaceMismatchError(synced?.workspaceId ?? null, local?.workspaceId ?? null);
}

/**
 * Mark a workspace as active. Bumps `lastOpenedAt` so it sorts to the
 * top of switcher pickers. Returns the updated registry.
 */
export async function setActiveWorkspace(
  registry: WorkspaceRegistry,
  workspaceId: string,
): Promise<WorkspaceRegistry> {
  const exists = registry.workspaces.some((w) => w.id === workspaceId);
  if (!exists) {
    throw new Error(`Workspace ${workspaceId} not in registry`);
  }
  const now = new Date().toISOString();
  const next: WorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: workspaceId,
    workspaces: registry.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, lastOpenedAt: now } : w,
    ),
  };
  await writeRegistry(next);
  return next;
}

/**
 * Create a new workspace record + register it. The new workspace
 * becomes the active one; callers typically reload state to switch the
 * UI over to it. Returns the seeded synced+local pair and updated
 * registry.
 */
export async function createWorkspace(
  registry: WorkspaceRegistry,
  name: string,
): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistry;
}> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Workspace name is required');
  if (registry.workspaces.some((w) => w.name === trimmed)) {
    throw new Error(`A workspace named "${trimmed}" already exists`);
  }
  const fresh = createEmptyWorkspace();
  const synced: WorkspaceSynced = { ...fresh.synced, workspaceName: trimmed };
  const now = new Date().toISOString();
  const entry: WorkspaceRegistryEntry = {
    id: synced.workspaceId,
    name: trimmed,
    createdAt: now,
    lastOpenedAt: now,
  };
  const nextRegistry: WorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: synced.workspaceId,
    workspaces: [...registry.workspaces, entry],
  };
  await writeBoth(synced, fresh.local);
  await writeRegistry(nextRegistry);
  return { synced, local: fresh.local, registry: nextRegistry };
}

/**
 * Delete a workspace and its records. If the deleted workspace was
 * active, switches to the most-recently-opened remaining workspace
 * (or seeds a fresh one if the registry is now empty).
 */
export async function deleteWorkspace(
  registry: WorkspaceRegistry,
  workspaceId: string,
): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistry;
}> {
  const remaining = registry.workspaces.filter((w) => w.id !== workspaceId);
  await deleteWorkspaceRecords(workspaceId);
  if (remaining.length === 0) {
    // Last workspace deleted — seed a fresh empty one so the app keeps
    // a usable state rather than hanging on a no-active-workspace shell.
    const fresh = createEmptyWorkspace();
    const now = new Date().toISOString();
    const entry: WorkspaceRegistryEntry = {
      id: fresh.synced.workspaceId,
      name: fresh.synced.workspaceName,
      createdAt: now,
      lastOpenedAt: now,
    };
    const nextRegistry: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: entry.id,
      workspaces: [entry],
    };
    await writeBoth(fresh.synced, fresh.local);
    await writeRegistry(nextRegistry);
    return { synced: fresh.synced, local: fresh.local, registry: nextRegistry };
  }
  // Pick the most-recently-opened of the remaining as the new active.
  const sorted = [...remaining].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  const newActive = sorted[0];
  const nextRegistry: WorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: newActive.id,
    workspaces: remaining,
  };
  await writeRegistry(nextRegistry);
  // Load the new active workspace's records.
  return loadWorkspaceById(newActive.id, nextRegistry);
}

/**
 * Sync the workspaceName change back into the registry entry so the
 * switcher UI reflects renames without a full reload.
 */
export async function updateRegistryEntryName(
  registry: WorkspaceRegistry,
  workspaceId: string,
  newName: string,
): Promise<WorkspaceRegistry> {
  const next: WorkspaceRegistry = {
    ...registry,
    workspaces: registry.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, name: newName } : w,
    ),
  };
  await writeRegistry(next);
  return next;
}

export async function resetWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistry;
}> {
  const fresh = createEmptyWorkspace();
  const now = new Date().toISOString();
  const entry: WorkspaceRegistryEntry = {
    id: fresh.synced.workspaceId,
    name: fresh.synced.workspaceName,
    createdAt: now,
    lastOpenedAt: now,
  };
  const registry: WorkspaceRegistry = {
    schemaVersion: 1,
    activeWorkspaceId: entry.id,
    workspaces: [entry],
  };
  await writeBoth(fresh.synced, fresh.local);
  await writeRegistry(registry);
  return { synced: fresh.synced, local: fresh.local, registry };
}

export async function probeWorkspaceRecords(): Promise<{
  registry: WorkspaceRegistry | null;
}> {
  const registry = await readRegistry();
  return { registry };
}

/**
 * Best-effort recovery for a partial-record state on the active
 * workspace (one of the two records is missing or has a different id).
 * Preserves whichever side has data and rebuilds the missing partner.
 */
export async function recoverPartialWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistry;
} | null> {
  const registry = await readRegistry();
  if (!registry || !registry.activeWorkspaceId) return null;
  const id = registry.activeWorkspaceId;
  const [synced, local] = await Promise.all([
    readRecord<WorkspaceSynced>(SYNCED_STORE, id),
    readRecord<WorkspaceLocal>(LOCAL_STORE, id),
  ]);
  if (!synced && !local) return null;
  if (synced && local && synced.workspaceId === local.workspaceId) {
    return { synced: normalizeSyncedShape(synced), local, registry };
  }
  if (synced && !local) {
    const fresh = createEmptyWorkspace();
    const recoveredLocal: WorkspaceLocal = { ...fresh.local, workspaceId: synced.workspaceId };
    await writeBoth(synced, recoveredLocal);
    return { synced: normalizeSyncedShape(synced), local: recoveredLocal, registry };
  }
  if (!synced && local) {
    const fresh = createEmptyWorkspace();
    const recoveredSynced: WorkspaceSynced = { ...fresh.synced, workspaceId: local.workspaceId };
    await writeBoth(recoveredSynced, local);
    return { synced: recoveredSynced, local, registry };
  }
  return null;
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
  const sampleRequest: ApiRequest = {
    id: generateId(),
    name: 'Sample: GET /anything',
    folderId: null,
    method: 'GET',
    url: 'https://httpbin.org/anything',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    query: [{ key: 'greeting', value: '{{GREETING}}', enabled: true }],
    body: { type: 'none', content: '' },
    auth: { type: 'inherit' },
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
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    secretKeys: {},
    meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
  };
  const local: WorkspaceLocal = {
    schemaVersion: 1,
    workspaceId,
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
      fontId: 'system-mono',
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
  return { synced, local };
}
