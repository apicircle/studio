import type {
  EnvPriorityRef,
  ExecutionPlan,
  Folder,
  FontFamilyId,
  Request as ApiRequest,
  SecretKeyMeta,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import {
  DEFAULT_WORKSPACE_NAME,
  FONT_SIZE_PERCENT_DEFAULT,
  generateId,
  normalizeAuth,
} from '@apicircle/shared';
import { generateSlotSalt } from '@apicircle/core';
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
import { deleteSecretPayload } from './secrets';
import type { GitHubSession } from '@apicircle/shared';

/**
 * Normalize the persisted `sessions.github` shape into the per-purpose
 * model `{ workspace, links }`. Tolerates three input shapes during the
 * transition:
 *
 *   - missing entirely  → `{ workspace: null, links: {} }`
 *   - legacy single value `GitHubSession | null` (pre-per-link)
 *                       → `{ workspace: hydrated, links: {} }`
 *   - already-new shape → pass-through, hydrating each session.
 *
 * Each hydrated session backfills `canCreatePullRequests` from granted
 * scopes when missing — covers pre-feature sessions without forcing a
 * verify call.
 */
function hydrateGithubSessions(
  sessions: WorkspaceLocal['sessions'] | undefined,
): WorkspaceLocal['sessions']['github'] {
  const hydrate = (s: GitHubSession | null | undefined): GitHubSession | null => {
    if (!s) return null;
    return {
      ...s,
      canCreatePullRequests:
        s.canCreatePullRequests === undefined
          ? s.grantedScopes.includes('repo') || s.grantedScopes.includes('pull_request')
            ? true
            : null
          : s.canCreatePullRequests,
    };
  };

  const raw = sessions?.github;
  // Already-new shape carries `workspace` (or `links`) — distinguish from the
  // legacy single-session shape by the presence of those keys.
  if (raw && typeof raw === 'object' && ('workspace' in raw || 'links' in raw)) {
    const newShape = raw as {
      workspace?: GitHubSession | null;
      links?: Record<string, GitHubSession>;
    };
    const links: Record<string, GitHubSession> = {};
    for (const [id, s] of Object.entries(newShape.links ?? {})) {
      const h = hydrate(s);
      if (h) links[id] = h;
    }
    return { workspace: hydrate(newShape.workspace ?? null), links };
  }
  // Legacy or null: treat the value as the workspace session.
  return { workspace: hydrate(raw), links: {} };
}

/**
 * Enumerate every secret payload owned by a workspace and remove it from
 * the shared `apicircle-secret-vault` IDB store. Covers every slot in
 * `local.secretIndex.entries` (env-var slots, linked-workspace inputs)
 * plus the GitHub PAT held under `local.sessions.github.tokenSecretId`.
 * Best-effort: any individual delete failure is swallowed so a single
 * missing payload doesn't block the rest of the workspace teardown.
 */
/**
 * Convert any legacy `envPriorityOrder: string[]` entries on persisted
 * execution plans to the new `EnvPriorityRef[]` shape. Plans created on a
 * different (newer) device may already be in shape — those pass through.
 */
function normalizeExecutionPlans(
  plans: Record<string, ExecutionPlan>,
): Record<string, ExecutionPlan> {
  let touched = false;
  const out: Record<string, ExecutionPlan> = {};
  for (const [id, plan] of Object.entries(plans)) {
    const order = plan.envPriorityOrder as unknown[];
    const next: EnvPriorityRef[] = [];
    let entryTouched = false;
    for (const entry of order) {
      if (typeof entry === 'string') {
        entryTouched = true;
        next.push({ kind: 'local', name: entry });
      } else if (
        entry &&
        typeof entry === 'object' &&
        'kind' in (entry as Record<string, unknown>) &&
        ((entry as { kind?: string }).kind === 'local' ||
          (entry as { kind?: string }).kind === 'linked')
      ) {
        next.push(entry as EnvPriorityRef);
      } else {
        entryTouched = true;
      }
    }
    if (entryTouched) {
      touched = true;
      out[id] = { ...plan, envPriorityOrder: next };
    } else {
      out[id] = plan;
    }
  }
  return touched ? out : plans;
}

/**
 * Migrate legacy `WorkspaceLocal.executionPlans` (per-device) to
 * `WorkspaceSynced.executionPlans` (Git-backed). Plans now travel
 * through Git so a collaborator cloning the repo sees the same plans.
 *
 * Idempotent + non-destructive in the synced direction:
 *   - If `synced.executionPlans` already has entries, nothing is
 *     overwritten (the synced doc is the source of truth post-migration).
 *   - If `synced.executionPlans` is missing/empty AND `local.executionPlans`
 *     has plans, those plans are lifted up. envPriorityOrder is also
 *     normalized in transit so older `string[]` entries become
 *     `EnvPriorityRef[]` shapes.
 *   - Otherwise the synced doc is returned untouched.
 *
 * Caller is responsible for clearing `local.executionPlans` after the
 * lift to avoid re-lifting on subsequent hydrates.
 */
function liftLegacyExecutionPlansToSynced(
  synced: WorkspaceSynced,
  legacyLocalPlans: Record<string, ExecutionPlan> | undefined,
): WorkspaceSynced {
  const syncedPlans = synced.executionPlans ?? {};
  if (Object.keys(syncedPlans).length > 0) return synced;
  if (!legacyLocalPlans || Object.keys(legacyLocalPlans).length === 0) {
    // Synced has no plans, local has none either: ensure the field
    // exists as an empty object so consumers can rely on it.
    return synced.executionPlans ? synced : { ...synced, executionPlans: {} };
  }
  return {
    ...synced,
    executionPlans: normalizeExecutionPlans(legacyLocalPlans),
  };
}

async function purgeWorkspaceSecrets(local: WorkspaceLocal | null): Promise<void> {
  if (!local) return;
  const ids = new Set<string>(Object.keys(local.secretIndex.entries));
  // Workspace session token + every per-link linking-session token. All
  // payloads live in the shared `apicircle-secret-vault` IDB; missing them
  // when the workspace is destroyed leaves stale ciphertext lying around.
  const wsToken = local.sessions.github.workspace?.tokenSecretId;
  if (wsToken) ids.add(wsToken);
  for (const linkSession of Object.values(local.sessions.github.links)) {
    if (linkSession.tokenSecretId) ids.add(linkSession.tokenSecretId);
  }
  for (const id of ids) {
    try {
      await deleteSecretPayload(id);
    } catch {
      /* swallow — a missing payload is fine */
    }
  }
}

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
  // `workspaceName` moved from the git-tracked synced doc to the local
  // registry. Strip any stale field a pre-rename blob still carries so
  // we never silently round-trip it back to disk / git.
  if ('workspaceName' in synced) {
    const { workspaceName: _strip, ...rest } = synced as WorkspaceSynced & {
      workspaceName?: unknown;
    };
    void _strip;
    synced = rest;
  }
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
    result = { ...result, globalAssets: { schemas: {}, graphql: {}, files: {} } };
  } else if (!result.globalAssets.files) {
    result = { ...result, globalAssets: { ...result.globalAssets, files: {} } };
  }
  if (!result.mockServers) {
    result = { ...result, mockServers: {} };
  }
  if (!result.secretKeys) {
    result = { ...result, secretKeys: {} };
  }
  // Salt was added with the per-slot derivation flow. Backfill any pre-salt
  // slot record with a fresh salt so subsequent encrypt/decrypt calls have
  // something to feed PBKDF2. Pre-launch: there's no real ciphertext yet
  // tied to a missing-salt slot, so a fresh salt won't break anything.
  {
    const slots = result.secretKeys ?? {};
    let saltTouched = false;
    const fixedSlots: Record<string, SecretKeyMeta> = {};
    for (const [id, meta] of Object.entries(slots)) {
      if (typeof (meta as { salt?: string }).salt === 'string' && meta.salt.length > 0) {
        fixedSlots[id] = meta;
      } else {
        saltTouched = true;
        fixedSlots[id] = { ...meta, salt: generateSlotSalt() };
      }
    }
    if (saltTouched) result = { ...result, secretKeys: fixedSlots };
  }
  if (!result.linkedOverrides) {
    result = { ...result, linkedOverrides: { requests: {}, environmentVars: {} } };
  }
  // priorityOrder: linked envs as first-class members. Pre-this-change the
  // field was `string[]` (local env names only). Convert legacy entries to
  // `{ kind: 'local', name }`. Already-new entries (objects with `.kind`)
  // pass through. Defensive against rogue shapes:
  //   - missing field entirely (older blob) → seed []
  //   - non-array (corrupt) → seed []
  //   - unrecognized entries → drop (better than crashing)
  {
    const rawOrder = result.environments.priorityOrder;
    if (!Array.isArray(rawOrder)) {
      // Field missing or corrupt — older blobs shipped without
      // priorityOrder altogether. Seed an empty array so the UI's
      // selectors and the resolver have something to iterate.
      result = {
        ...result,
        environments: { ...result.environments, priorityOrder: [] },
      };
    } else {
      let priorityTouched = false;
      const next: EnvPriorityRef[] = [];
      for (const entry of rawOrder as unknown[]) {
        if (typeof entry === 'string') {
          priorityTouched = true;
          next.push({ kind: 'local', name: entry });
        } else if (
          entry &&
          typeof entry === 'object' &&
          'kind' in (entry as Record<string, unknown>) &&
          ((entry as { kind?: string }).kind === 'local' ||
            (entry as { kind?: string }).kind === 'linked')
        ) {
          next.push(entry as EnvPriorityRef);
        } else {
          priorityTouched = true;
          // Drop garbage rather than crash. Pre-launch — no real user data
          // to preserve.
        }
      }
      if (priorityTouched) {
        result = {
          ...result,
          environments: { ...result.environments, priorityOrder: next },
        };
      }
    }
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
  // Plans-on-synced normalization: post-migration, executionPlans is on
  // synced. Run the same envPriorityOrder shape fix here so plans
  // pulled from older Git docs are normalized just like local plans
  // were prior to the move.
  if (result.executionPlans && Object.keys(result.executionPlans).length > 0) {
    const normalized = normalizeExecutionPlans(result.executionPlans);
    if (normalized !== result.executionPlans) {
      result = { ...result, executionPlans: normalized };
    }
  }
  // Collection-orphan self-heal. Two drift cases the sidebar can't render but
  // the unpushed-changes diff still surfaces — root cause was an asymmetric
  // applyMerge that mutated the dict without touching the tree. The merge
  // path is now fixed (see `reconcileTreeForEntry` in threeWayDiff.ts) but
  // existing IDB blobs from before the fix still carry orphans; this normalizer
  // step heals them on next load.
  //
  //   1. Top-level orphan: request/folder has parent === null but is not in
  //      `tree.children`. Recover by appending — the entry belongs at root
  //      and just lost its tree pointer; no data loss possible.
  //
  //   2. Dangling-parent orphan: request.folderId / folder.parentId points
  //      at an id that no longer exists in the corresponding dict. Drop the
  //      entry (matches the user-confirmed Option B — the parent folder was
  //      removed and the orphan would otherwise re-appear unexpectedly at
  //      root via case 1's rescue if we re-nulled the parent).
  result = healCollectionOrphans(result);
  return result;
}

function healCollectionOrphans(synced: WorkspaceSynced): WorkspaceSynced {
  const folders = synced.collections.folders;
  const folderIds = new Set(Object.keys(folders));

  // Pass 1: drop dict entries whose parent id is dangling.
  const requestsAfterDrop: Record<string, ApiRequest> = {};
  let droppedRequests = 0;
  for (const [id, req] of Object.entries(synced.collections.requests)) {
    if (req.folderId !== null && !folderIds.has(req.folderId)) {
      droppedRequests += 1;
      continue;
    }
    requestsAfterDrop[id] = req;
  }
  const foldersAfterDrop: Record<string, Folder> = {};
  let droppedFolders = 0;
  for (const [id, folder] of Object.entries(folders)) {
    if (folder.parentId !== null && !folderIds.has(folder.parentId)) {
      droppedFolders += 1;
      continue;
    }
    foldersAfterDrop[id] = folder;
  }

  // Pass 2: re-attach top-level orphans (parent === null but missing from
  // tree.children).
  const treeChildIds = new Set(synced.collections.tree.children.map((c) => `${c.kind}:${c.id}`));
  const additions: Array<{ kind: 'folder' | 'request'; id: string }> = [];
  for (const req of Object.values(requestsAfterDrop)) {
    if (req.folderId === null && !treeChildIds.has(`request:${req.id}`)) {
      additions.push({ kind: 'request', id: req.id });
    }
  }
  for (const folder of Object.values(foldersAfterDrop)) {
    if (folder.parentId === null && !treeChildIds.has(`folder:${folder.id}`)) {
      additions.push({ kind: 'folder', id: folder.id });
    }
  }

  // Pass 3: drop tree.children entries pointing at ids that no longer exist.
  const validRequestIds = new Set(Object.keys(requestsAfterDrop));
  const validFolderIds = new Set(Object.keys(foldersAfterDrop));
  const cleanedChildren = synced.collections.tree.children.filter((c) => {
    if (c.kind === 'request') return validRequestIds.has(c.id);
    return validFolderIds.has(c.id);
  });

  const needsRewrite =
    droppedRequests > 0 ||
    droppedFolders > 0 ||
    additions.length > 0 ||
    cleanedChildren.length !== synced.collections.tree.children.length;
  if (!needsRewrite) return synced;

  if (droppedRequests > 0 || droppedFolders > 0 || additions.length > 0) {
    // Best-effort visibility for dev/devtools — the user-facing toast happens
    // upstream in App.tsx when this reports drift.
    console.warn(
      `[workspace.normalize] healed orphans: dropped ${droppedRequests} request(s) + ${droppedFolders} folder(s) with dangling parents, re-attached ${additions.length} top-level orphan(s)`,
    );
  }

  return {
    ...synced,
    collections: {
      ...synced.collections,
      requests: requestsAfterDrop,
      folders: foldersAfterDrop,
      tree: {
        ...synced.collections.tree,
        children: [...cleanedChildren, ...additions],
      },
    },
  };
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
      name: DEFAULT_WORKSPACE_NAME,
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
    let upgradedSynced = normalizeSyncedShape(synced);
    // Migration: lift legacy `local.executionPlans` into
    // `synced.executionPlans`. Plans now travel through Git so a
    // collaborator cloning the repo sees them. Only runs when the
    // synced doc has no plans yet AND the local doc has some — the
    // common upgrade path. Once migrated, the local field is cleared
    // below so subsequent hydrates skip the lift.
    upgradedSynced = liftLegacyExecutionPlansToSynced(upgradedSynced, local.executionPlans);
    // Backfill `canCreatePullRequests` onto a hydrated github session.
    // Pre-feature sessions don't have the field; we conservatively assume
    // `true` if the session has `repo` granted (covers PR ops on classic
    // PATs — the dominant case) so existing users don't see a spurious
    // warning until their next verify/probe runs. Sessions that genuinely
    // can't create PRs will be re-classified on the next session/repo
    // verify.
    // Two backfills happen here:
    //
    //  1. canCreatePullRequests on each GitHub session — pre-feature
    //     sessions don't have it; assume true if `repo` is granted so
    //     users don't see a spurious warning until the next verify/probe.
    //  2. The session shape itself changed from a single
    //     `sessions.github: GitHubSession | null` to per-purpose
    //     `sessions.github: { workspace, links }`. Old fixtures and any
    //     IDB blobs from before the per-link split are normalized here so
    //     the rest of the app can assume the new shape.
    const hydratedGithub = hydrateGithubSessions(local.sessions);
    const upgradedLocal: WorkspaceLocal = {
      ...local,
      sessions: { ...local.sessions, github: hydratedGithub },
      // Backfill the seeded-scaffold sha (added with the empty-repo seed
      // flow). Older workspaces hydrate with `null` — they predate the
      // feature and have nothing to suppress.
      seededWorkspaceSha: local.seededWorkspaceSha ?? null,
      // Backfill retiredBranch (added with the post-merge / branch-deleted
      // detection). Older workspaces hydrate with `null` — there's no
      // historic retirement to surface, and the next refresh will populate
      // it if the working branch turns out to be over.
      retiredBranch: local.retiredBranch ?? null,
      linkedCollections: local.linkedCollections ?? {},
      attachmentCache: local.attachmentCache ?? {},
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
      // Plans were moved from `WorkspaceLocal` to `WorkspaceSynced` in
      // this version. The lift above (`liftLegacyExecutionPlansToSynced`)
      // moved any legacy local plans into `synced.executionPlans`; we
      // clear the local field here so subsequent hydrates don't keep
      // re-lifting and the field stays empty going forward (kept in
      // the type for one schema version for backwards compatibility).
      executionPlans: {},
      // Backfill the workspace-bound font id (added in the
      // font-binding fix). Pre-fix the choice lived in localStorage;
      // first hydrate after the fix migrates that legacy value into
      // local.ui.fontId, falling back to the safe default.
      // `fontSizePercent` was added later and is null-coalesced to the
      // 100% default for any pre-existing on-disk workspace.
      ui: {
        ...local.ui,
        fontId: local.ui.fontId ?? readLegacyFontFromLocalStorage() ?? 'system-sans',
        fontSizePercent: local.ui.fontSizePercent ?? FONT_SIZE_PERCENT_DEFAULT,
      },
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
  // Case-insensitive uniqueness, matching the CLI's
  // `apicircle workspaces create` guard at packages/cli/src/util/resolveWorkspace.ts.
  // The desktop's previous case-sensitive check was looser than the CLI
  // and let `My Workspace` + `my workspace` coexist — both indistinguishable
  // in the workspace switcher because rendering normalises whitespace.
  const trimmedLower = trimmed.toLowerCase();
  if (registry.workspaces.some((w) => w.name.toLowerCase() === trimmedLower)) {
    throw new Error(`A workspace named "${trimmed}" already exists`);
  }
  const fresh = createEmptyWorkspace();
  const now = new Date().toISOString();
  const entry: WorkspaceRegistryEntry = {
    id: fresh.synced.workspaceId,
    name: trimmed,
    createdAt: now,
    lastOpenedAt: now,
  };
  const nextRegistry: WorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: fresh.synced.workspaceId,
    workspaces: [...registry.workspaces, entry],
  };
  await writeBoth(fresh.synced, fresh.local);
  await writeRegistry(nextRegistry);
  return { synced: fresh.synced, local: fresh.local, registry: nextRegistry };
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
  // Read the local doc BEFORE deleting it so we can enumerate the workspace's
  // secret payload ids (`secretIndex.entries` keys + GitHub PAT tokenSecretId)
  // and remove each from the shared secret vault. Otherwise stale ciphertext
  // would linger in IDB after the workspace itself is gone.
  const localToPurge = await readRecord<WorkspaceLocal>(LOCAL_STORE, workspaceId);
  await purgeWorkspaceSecrets(localToPurge);
  await deleteWorkspaceRecords(workspaceId);
  if (remaining.length === 0) {
    // Last workspace deleted — seed a fresh empty one so the app keeps
    // a usable state rather than hanging on a no-active-workspace shell.
    const fresh = createEmptyWorkspace();
    const now = new Date().toISOString();
    const entry: WorkspaceRegistryEntry = {
      id: fresh.synced.workspaceId,
      name: DEFAULT_WORKSPACE_NAME,
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
 * Update the workspace's local display name in the registry. The name is
 * registry-only (never git-synced) so each user / machine names their
 * local copy independently.
 */
export async function updateRegistryEntryName(
  registry: WorkspaceRegistry,
  workspaceId: string,
  newName: string,
): Promise<WorkspaceRegistry> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Workspace name is required');
  // Same case-insensitive uniqueness guard as `createWorkspace` —
  // renaming "Workspace A" to a name that already exists must error
  // out, otherwise the switcher ends up with two indistinguishable
  // rows. Exclude the workspace being renamed so a no-op rename
  // (same name, same id) is a clean pass.
  const trimmedLower = trimmed.toLowerCase();
  const clash = registry.workspaces.some(
    (w) => w.id !== workspaceId && w.name.toLowerCase() === trimmedLower,
  );
  if (clash) {
    throw new Error(`A workspace named "${trimmed}" already exists`);
  }
  const next: WorkspaceRegistry = {
    ...registry,
    workspaces: registry.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, name: trimmed } : w,
    ),
  };
  await writeRegistry(next);
  return next;
}

export async function migrateWorkspaceId(
  registry: WorkspaceRegistry,
  oldId: string,
  newId: string,
): Promise<WorkspaceRegistry> {
  const next: WorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: registry.activeWorkspaceId === oldId ? newId : registry.activeWorkspaceId,
    workspaces: registry.workspaces.map((w) => (w.id === oldId ? { ...w, id: newId } : w)),
  };
  await writeRegistry(next);
  return next;
}

export async function resetWorkspace(): Promise<{
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
  registry: WorkspaceRegistry;
}> {
  // Wipe every active workspace's secrets before re-seeding — `resetWorkspace`
  // is the "blow it all away" path, so leaving stale vault payloads around
  // would leak across the boundary.
  const existingRegistry = await readRegistry();
  if (existingRegistry) {
    for (const w of existingRegistry.workspaces) {
      const oldLocal = await readRecord<WorkspaceLocal>(LOCAL_STORE, w.id);
      await purgeWorkspaceSecrets(oldLocal);
    }
  }
  const fresh = createEmptyWorkspace();
  const now = new Date().toISOString();
  const entry: WorkspaceRegistryEntry = {
    id: fresh.synced.workspaceId,
    name: DEFAULT_WORKSPACE_NAME,
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
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    secretKeys: {},
    meta: { createdAt: now, updatedAt: now, appVersion: '1.0.0' },
  };
  const local: WorkspaceLocal = {
    schemaVersion: 1,
    workspaceId,
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: null, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: {
      lastPulledSnapshot: null,
      lastPulledSha: null,
      lastPulledAt: null,
      dirtyKeys: [],
    },
    linkedCollections: {},
    attachmentCache: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: sampleRequest.id,
      sidebarExpandedSections: [],
      themeId: 'one-dark-pro',
      fontId: 'system-sans',
      fontSizePercent: FONT_SIZE_PERCENT_DEFAULT,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
  return { synced, local };
}
