import type {
  AttachmentRef,
  Assertion,
  ConnectedRepo,
  Environment,
  FormDataRow,
  GitHubSession,
  HttpMethod,
  PanelId,
  Request as ApiRequest,
  RequestBody,
  RequestRun,
  ThemeId,
  WorkingBranch,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle-v2/shared';
import { type GitHubRepo, GitHubClient, MissingScopeError } from '@apicircle-v2/git';
import { generateId } from '@apicircle-v2/shared';
import {
  type AttachmentResolver,
  type ExecutionResult,
  type PublishReleaseArgs,
  type ResolutionMap,
  type ThreeWayDiff,
  applyMerge,
  buildScope,
  collectAttachmentSlots,
  computeThreeWayDiff,
  decryptString,
  deprecateRelease as deprecateReleaseAction,
  encryptString,
  executeRequest as coreExecuteRequest,
  generateWorkingBranchName,
  publishRelease as publishReleaseAction,
  resolveString,
  runAssertions,
  serializePayload,
  serializeWorkspaceForGit,
  tryParsePayload,
  validateBranchName,
  yankRelease as yankReleaseAction,
} from '@apicircle-v2/core';
import { create } from 'zustand';
import {
  createAttachmentFromFile,
  deleteAttachment,
  deleteManyAttachments,
  getAttachment,
  materializeAttachment,
  putAttachment,
} from '../persistence/attachments';
import { getMasterKey } from '../persistence/secretKey';
import { loadWorkspace, saveLocal, saveSynced } from '../persistence/workspaceStorage';
import { applyTheme } from '../theme/applyTheme';
import { bytesToBase64 } from './attachmentBlobs';
import type { TreeEntryInput } from '@apicircle-v2/git';
import {
  addFolder as addFolderAction,
  addRequest as addRequestAction,
  collectRequestSlotIds,
  removeRequest as removeRequestAction,
  setRequestAssertions as setRequestAssertionsAction,
  setRequestBody as setRequestBodyAction,
  setRequestHeaders as setRequestHeadersAction,
  setRequestMethod as setRequestMethodAction,
  setRequestQuery as setRequestQueryAction,
  setRequestUrl as setRequestUrlAction,
  renameRequest as renameRequestAction,
} from './editorActions';
import {
  addEnvironment as addEnvironmentAction,
  addVariableRow as addVariableRowAction,
  removeEnvironment as removeEnvironmentAction,
  renameEnvironment as renameEnvironmentAction,
  setActiveEnvironment as setActiveEnvironmentAction,
  setPriorityOrder as setPriorityOrderAction,
  setVariables as setVariablesAction,
} from './envActions';
import {
  addSecretEntry as addSecretEntryAction,
  removeSecretEntry as removeSecretEntryAction,
  renameSecretEntry as renameSecretEntryAction,
} from './secretActions';
import { recomputeUsedIn } from './usedInAggregator';
import { deleteSecretPayload, getSecretPayload, putSecretPayload } from '../persistence/secrets';

const attachmentResolver: AttachmentResolver = async (slotId) => {
  const record = await getAttachment(slotId);
  if (!record) return null;
  return { blob: materializeAttachment(record), filename: record.filename };
};

const PANEL_STORAGE_KEY = 'apicircle-v2:active-panel';
const VALID_PANELS: PanelId[] = [
  'workspace',
  'link-workspace',
  'editor',
  'env',
  'execution',
  'history',
  'help',
];
// Cap on the number of request runs kept in local history. Older runs get
// dropped — execution history is a circular buffer to keep IDB writes cheap.
const MAX_REQUEST_RUNS = 500;

function readStoredPanel(): PanelId {
  if (typeof localStorage === 'undefined') return 'editor';
  try {
    const stored = localStorage.getItem(PANEL_STORAGE_KEY);
    if (stored && (VALID_PANELS as string[]).includes(stored)) return stored as PanelId;
  } catch {
    // ignore
  }
  return 'editor';
}

function writeStoredPanel(panel: PanelId): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, panel);
  } catch {
    // ignore
  }
}

export type RefreshOutcome =
  | { status: 'no-remote' }
  | { status: 'up-to-date' }
  | { status: 'merged' }
  | { status: 'conflicts'; diff: ThreeWayDiff };

interface PendingRefresh {
  diff: ThreeWayDiff;
  remote: WorkspaceSynced;
  remoteSha: string;
}

type WorkspaceStore = {
  ready: boolean;
  synced: WorkspaceSynced | null;
  local: WorkspaceLocal | null;

  activePanel: PanelId;
  secretVaultOpen: boolean;
  /** Stashed during refreshWorkspace when conflicts surface; consumed by commitRefresh. */
  pendingRefresh: PendingRefresh | null;
  // Per-request last-run cache. Not persisted — request runs land in
  // local.history once they complete; this is the live working result for
  // the editor panel.
  lastRun: Record<string, ExecutionResult | null>;
  isExecuting: Record<string, boolean>;

  hydrate: () => Promise<void>;

  setActivePanel: (panel: PanelId) => void;
  setActiveRequestId: (id: string | null) => void;
  toggleSidebarSection: (section: string) => void;
  setThemeId: (themeId: ThemeId) => void;
  setWorkspaceName: (name: string) => void;

  openSecretVault: () => void;
  closeSecretVault: () => void;

  addRequest: (parentFolderId: string | null) => string;
  addFolder: (parentFolderId: string | null, name?: string) => string;
  removeRequest: (id: string) => void;
  renameRequest: (id: string, name: string) => void;
  setRequestMethod: (id: string, method: HttpMethod) => void;
  setRequestUrl: (id: string, url: string) => void;
  setRequestBody: (id: string, body: RequestBody) => void;
  setRequestHeaders: (id: string, headers: ApiRequest['headers']) => void;
  setRequestQuery: (id: string, query: ApiRequest['query']) => void;
  setRequestAssertions: (id: string, assertions: Assertion[]) => void;

  // Form-data: replace the rows array. The store cleans up orphaned
  // attachment blobs (rows whose slotId is no longer present) automatically.
  setRequestFormRows: (id: string, rows: FormDataRow[]) => void;
  // Pick a file for a form-data row. Writes the blob to the attachments DB,
  // updates the row's slotId/filename/size/mimeType. The previous slotId for
  // that row (if any) is freed.
  attachFormFile: (requestId: string, rowIndex: number, file: File) => Promise<void>;
  detachFormFile: (requestId: string, rowIndex: number) => Promise<void>;

  // Binary: pick a file for the request body. Writes the blob to attachments,
  // sets body.attachment to point at it, and frees any previous slot.
  attachBinaryFile: (requestId: string, file: File) => Promise<void>;
  detachBinaryFile: (requestId: string) => Promise<void>;

  // Environments
  addEnvironment: (name: string) => void;
  removeEnvironment: (name: string) => void;
  renameEnvironment: (oldName: string, newName: string) => void;
  setActiveEnvironment: (name: string | null) => void;
  setPriorityOrder: (order: string[]) => void;
  setVariables: (envName: string, variables: Environment['variables']) => void;
  addVariableRow: (envName: string) => void;
  /**
   * Set a variable's value, encrypting it on the way in if `encrypted` is
   * true. Existing encrypted ciphertext is rotated under the same key.
   */
  setVariableValue: (
    envName: string,
    index: number,
    value: string,
    encrypted: boolean,
  ) => Promise<void>;

  // Secret Vault
  /**
   * Create a Secret Vault entry. The plaintext is encrypted under the local
   * master key and persisted in the secrets IDB; the index entry (label,
   * origin, usedIn) lives in `WorkspaceLocal.secretIndex`. Resolves to the
   * generated secret id.
   */
  addSecret: (args: {
    label: string;
    value: string;
    origin?: 'workspace' | 'linked';
    linkedWorkspaceId?: string;
    linkedKeyId?: string;
  }) => Promise<string>;
  /**
   * Replace the encrypted value for an existing secret. Returns true on
   * success, false when the id is unknown.
   */
  setSecretValue: (id: string, value: string) => Promise<boolean>;
  /** Decrypt and return the plaintext value of a vault secret. */
  decryptSecret: (id: string) => Promise<string | null>;
  renameSecret: (id: string, label: string) => void;
  /** Remove the secret index entry and its encrypted payload. */
  removeSecret: (id: string) => Promise<void>;
  /** Force-recompute the `usedIn` index for every secret. */
  recomputeSecretUsage: () => void;

  // GitHub session — see Plan §3.6 + revision #6.
  /**
   * Connect a GitHub PAT. Verifies it via GET /user, encrypts via the master
   * key and stores in the secret vault, captures account login + granted
   * scopes into `local.sessions.github`. Returns the resolved session on
   * success; throws on rejected token or insufficient base scopes.
   */
  connectGitHubSession: (token: string) => Promise<GitHubSession>;
  /**
   * Re-verify the active session against GitHub and refresh granted scopes.
   * Returns the updated scopes or null when no session exists.
   */
  verifyGitHubScopes: () => Promise<string[] | null>;
  /**
   * Replace the PAT for the active session without losing branch/PR state.
   * Re-verifies + refreshes scopes in the same pass.
   */
  updateGitHubToken: (token: string) => Promise<GitHubSession>;
  /** Disconnect: free the encrypted token, clear the session entry. */
  disconnectGitHubSession: () => Promise<void>;

  // Repo + working-branch flow (P4.2)
  /**
   * Validate access to a GitHub repo via `GET /repos/:owner/:name` and
   * persist the connection metadata into `local.connectedRepo`. Throws
   * when no GitHub session is active or the repo is inaccessible.
   */
  connectRepo: (owner: string, name: string) => Promise<ConnectedRepo>;
  /**
   * Drop the connected repo and any working branch tied to it.
   */
  disconnectRepo: () => void;
  /**
   * Auto-create a new branch from `connectedRepo.defaultBranch` (or
   * caller-supplied baseBranch). Generates `apicircle/<slug>-<id>` when
   * no name is supplied. Throws on validation failure or GitHub error.
   */
  createWorkingBranch: (opts?: {
    branchName?: string;
    baseBranch?: string;
  }) => Promise<WorkingBranch>;
  /**
   * Drop the working branch slot without touching the remote ref. The
   * user typically rotates after a PR merges.
   */
  discardWorkingBranch: () => void;

  /**
   * Atomically commit the current synced doc + every referenced
   * attachment as one Git Tree commit on the working branch. Round-trip
   * is: read branch ref → read its tree → upload each new attachment as
   * a blob → create new tree (base_tree + workspace.json inline +
   * `.apicircle/attachments/<slotId>` per attachment) → create commit →
   * fast-forward the ref. On success, updates `workingBranch.headSha`
   * and `lastPushedSha`. Throws on missing-session, missing-repo,
   * missing-branch, or any GitHub error.
   *
   * Attachments whose bytes aren't in local IDB (e.g. pulled but not
   * downloaded) are skipped — `base_tree` keeps the existing entry
   * intact, so they don't get overwritten on the remote.
   */
  pushWorkspace: (commitMessage?: string) => Promise<{ commitSha: string }>;

  /**
   * Open a pull request from the working branch into its base. Requires a
   * prior push (lastPushedSha != null) — there's nothing to merge before
   * the first commit. Defaults: title "APICircle workspace updates",
   * body empty, draft false. On success, persists `openPrUrl` on
   * workingBranch and returns the PR number + URL.
   *
   * Throws MissingScopeError when the token lacks `pull_request` — the UI
   * catches that to prompt the user to update their token without losing
   * branch state (Plan §3.7).
   */
  createPullRequest: (args?: {
    title?: string;
    body?: string;
    draft?: boolean;
  }) => Promise<{ number: number; htmlUrl: string }>;

  /**
   * Pull remote `workspace.json` from the working branch and reconcile
   * it with local via 3-way diff (plan §3.5). Outcomes:
   *   - 'no-remote': the working branch has no workspace.json yet (the
   *     first push hasn't happened) → returned as a no-op.
   *   - 'up-to-date': local + remote agree → only the snapshot/sha is
   *     refreshed.
   *   - 'merged': diff was non-empty but had no conflicts; all
   *     fast-forwards applied and persisted.
   *   - 'conflicts': diff has conflicts. The pending diff + remote doc
   *     are stashed in store state for the resolver modal; the caller
   *     finishes the merge by calling `commitRefresh(resolutions)`.
   */
  refreshWorkspace: () => Promise<RefreshOutcome>;

  /**
   * Apply user-resolved conflicts from the resolver modal. Picks up the
   * pending diff stashed by `refreshWorkspace`, runs `applyMerge`, and
   * persists the merged synced doc + updated sync snapshot.
   */
  commitRefresh: (resolutions: ResolutionMap) => Promise<void>;
  /** Drop the pending refresh without applying anything. */
  cancelRefresh: () => void;

  // --- Releases (workspace-self) ---------------------------------------
  /**
   * Append a new entry to `synced.releases.self.versions` and bump
   * `currentVersion`. The snapshot SHA is computed over the canonical
   * pre-publish workspace.json (plan §5.1). Throws on invalid semver or
   * duplicate version.
   */
  publishRelease: (args: PublishReleaseArgs) => Promise<void>;
  /** Flip `deprecated: true` on a published version. */
  deprecateRelease: (version: string) => void;
  /** Flip `yanked: true` on a published version. Soft destructive. */
  yankRelease: (version: string) => void;

  executeActiveRequest: () => Promise<void>;
};

/**
 * Required base scopes for the connect flow. Push-to-save needs `repo`;
 * `pull_request` is required only for PR creation, surfaced as a warning
 * at connect time via the UI guidance copy. The verify step on connect
 * throws MissingScopeError when REQUIRED_BASE_SCOPES are missing.
 */
const REQUIRED_BASE_SCOPES = ['repo'] as const;
const GITHUB_TOKEN_LABEL_PREFIX = 'github-token:';

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ready: false,
  synced: null,
  local: null,
  activePanel: readStoredPanel(),
  secretVaultOpen: false,
  pendingRefresh: null,
  lastRun: {},
  isExecuting: {},

  hydrate: async () => {
    const { synced, local } = await loadWorkspace();
    applyTheme(local.ui.themeId);
    set({ ready: true, synced, local });
  },

  setActivePanel: (panel) => {
    writeStoredPanel(panel);
    set({ activePanel: panel });
  },

  setActiveRequestId: (id) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, ui: { ...local.ui, activeRequestId: id } };
    set({ local: next });
    void saveLocal(next);
  },

  toggleSidebarSection: (section) => {
    const local = get().local;
    if (!local) return;
    const expanded = local.ui.sidebarExpandedSections;
    const isOpen = expanded.includes(section);
    const nextExpanded = isOpen ? expanded.filter((s) => s !== section) : [...expanded, section];
    const next: WorkspaceLocal = {
      ...local,
      ui: { ...local.ui, sidebarExpandedSections: nextExpanded },
    };
    set({ local: next });
    void saveLocal(next);
  },

  setThemeId: (themeId) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, ui: { ...local.ui, themeId } };
    applyTheme(themeId);
    set({ local: next });
    void saveLocal(next);
  },

  setWorkspaceName: (name) => {
    const synced = get().synced;
    if (!synced) return;
    const nextSynced: WorkspaceSynced = {
      ...synced,
      workspaceName: name,
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: nextSynced });
    void saveSynced(nextSynced);
  },

  openSecretVault: () => set({ secretVaultOpen: true }),
  closeSecretVault: () => set({ secretVaultOpen: false }),

  addRequest: (parentFolderId) => {
    const synced = get().synced;
    if (!synced) return '';
    const { synced: nextSynced, request } = addRequestAction(synced, parentFolderId);
    set({ synced: nextSynced });
    void saveSynced(nextSynced);
    // Auto-select the new request.
    get().setActiveRequestId(request.id);
    return request.id;
  },

  addFolder: (parentFolderId, name) => {
    const synced = get().synced;
    if (!synced) return '';
    const { synced: nextSynced, folder } = addFolderAction(synced, parentFolderId, name);
    set({ synced: nextSynced });
    void saveSynced(nextSynced);
    return folder.id;
  },

  removeRequest: (id) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[id];
    const next = removeRequestAction(synced, id);
    if (next === synced) return;
    set({ synced: next });
    void saveSynced(next);
    if (existing) {
      const slotIds = collectRequestSlotIds(existing);
      if (slotIds.length > 0) void deleteManyAttachments(slotIds);
    }
    if (get().local?.ui.activeRequestId === id) get().setActiveRequestId(null);
  },

  renameRequest: (id, name) => commitSynced(set, get, (s) => renameRequestAction(s, id, name)),
  setRequestMethod: (id, method) =>
    commitSynced(set, get, (s) => setRequestMethodAction(s, id, method)),
  setRequestUrl: (id, url) => commitSynced(set, get, (s) => setRequestUrlAction(s, id, url)),
  setRequestBody: (id, body) => commitSynced(set, get, (s) => setRequestBodyAction(s, id, body)),
  setRequestHeaders: (id, headers) =>
    commitSynced(set, get, (s) => setRequestHeadersAction(s, id, headers)),
  setRequestQuery: (id, query) =>
    commitSynced(set, get, (s) => setRequestQueryAction(s, id, query)),
  setRequestAssertions: (id, assertions) =>
    commitSynced(set, get, (s) => setRequestAssertionsAction(s, id, assertions)),

  setRequestFormRows: (id, rows) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[id];
    if (!existing) return;
    const before =
      existing.body.type === 'form-data' && existing.body.formRows ? existing.body.formRows : [];
    const beforeSlots = new Set(
      before.flatMap((r) => (r.kind === 'file' && r.slotId ? [r.slotId] : [])),
    );
    const afterSlots = new Set(
      rows.flatMap((r) => (r.kind === 'file' && r.slotId ? [r.slotId] : [])),
    );
    const orphaned = [...beforeSlots].filter((s) => !afterSlots.has(s));
    const nextBody: RequestBody = { ...existing.body, type: 'form-data', formRows: rows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, id, nextBody));
    if (orphaned.length > 0) void deleteManyAttachments(orphaned);
  },

  attachFormFile: async (requestId, rowIndex, file) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'form-data' || !existing.body.formRows) return;
    const oldRow = existing.body.formRows[rowIndex];
    if (!oldRow) return;
    const previousSlot = oldRow.kind === 'file' && oldRow.slotId ? oldRow.slotId : null;

    const slotId = generateId();
    const record = await createAttachmentFromFile(file, slotId);
    await putAttachment(record);

    const nextRow: FormDataRow = {
      kind: 'file',
      key: oldRow.key,
      enabled: oldRow.enabled,
      slotId,
      filename: record.filename,
      size: record.size,
      mimeType: record.mimeType,
      sha256: record.sha256,
    };
    const nextRows = existing.body.formRows.map((r, i) => (i === rowIndex ? nextRow : r));
    const nextBody: RequestBody = { ...existing.body, formRows: nextRows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  detachFormFile: async (requestId, rowIndex) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'form-data' || !existing.body.formRows) return;
    const oldRow = existing.body.formRows[rowIndex];
    if (!oldRow || oldRow.kind !== 'file') return;
    const previousSlot = oldRow.slotId;

    const nextRow: FormDataRow = {
      kind: 'file',
      key: oldRow.key,
      enabled: oldRow.enabled,
      slotId: null,
    };
    const nextRows = existing.body.formRows.map((r, i) => (i === rowIndex ? nextRow : r));
    const nextBody: RequestBody = { ...existing.body, formRows: nextRows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  attachBinaryFile: async (requestId, file) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing) return;
    const previousSlot =
      existing.body.type === 'binary' ? (existing.body.attachment?.slotId ?? null) : null;

    const slotId = generateId();
    const record = await createAttachmentFromFile(file, slotId);
    await putAttachment(record);

    const ref: AttachmentRef = {
      slotId,
      filename: record.filename,
      size: record.size,
      mimeType: record.mimeType,
      sha256: record.sha256,
    };
    const nextBody: RequestBody = { type: 'binary', content: '', attachment: ref };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  detachBinaryFile: async (requestId) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'binary') return;
    const previousSlot = existing.body.attachment?.slotId ?? null;

    const nextBody: RequestBody = { type: 'binary', content: '' };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  // --- environments ------------------------------------------------------

  addEnvironment: (name) => commitSynced(set, get, (s) => addEnvironmentAction(s, name)),
  removeEnvironment: (name) => commitSynced(set, get, (s) => removeEnvironmentAction(s, name)),
  renameEnvironment: (oldName, newName) =>
    commitSynced(set, get, (s) => renameEnvironmentAction(s, oldName, newName)),
  setActiveEnvironment: (name) =>
    commitSynced(set, get, (s) => setActiveEnvironmentAction(s, name)),
  setPriorityOrder: (order) => commitSynced(set, get, (s) => setPriorityOrderAction(s, order)),
  setVariables: (envName, variables) =>
    commitSynced(set, get, (s) => setVariablesAction(s, envName, variables)),
  addVariableRow: (envName) => commitSynced(set, get, (s) => addVariableRowAction(s, envName)),

  setVariableValue: async (envName, index, value, encrypted) => {
    const synced = get().synced;
    if (!synced) return;
    const env = synced.environments.items[envName];
    if (!env) return;
    const existing = env.variables[index];
    if (!existing) return;

    let storedValue = value;
    if (encrypted) {
      const key = await getMasterKey();
      const payload = await encryptString(value, key);
      storedValue = serializePayload(payload);
    }
    const nextVars: Environment['variables'] = env.variables.map((v, i) =>
      i === index ? { ...v, value: storedValue, encrypted } : v,
    );
    commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
  },

  // --- Secret Vault ------------------------------------------------------

  addSecret: async ({ label, value, origin, linkedWorkspaceId, linkedKeyId }) => {
    const local = get().local;
    if (!local) return '';
    const id = generateId();
    const key = await getMasterKey();
    const payload = await encryptString(value, key);
    await putSecretPayload(id, payload);
    const next = addSecretEntryAction(local, {
      id,
      label,
      origin,
      linkedWorkspaceId,
      linkedKeyId,
    });
    if (next === local) {
      // Reducer rejected (duplicate / empty label) — clean up the orphan blob.
      await deleteSecretPayload(id);
      return '';
    }
    set({ local: next });
    void saveLocal(next);
    get().recomputeSecretUsage();
    return id;
  },

  setSecretValue: async (id, value) => {
    const local = get().local;
    if (!local || !local.secretIndex.entries[id]) return false;
    const key = await getMasterKey();
    const payload = await encryptString(value, key);
    await putSecretPayload(id, payload);
    return true;
  },

  decryptSecret: async (id) => {
    const local = get().local;
    if (!local || !local.secretIndex.entries[id]) return null;
    const payload = await getSecretPayload(id);
    if (!payload) return null;
    try {
      const key = await getMasterKey();
      return await decryptString(payload, key);
    } catch {
      return null;
    }
  },

  renameSecret: (id, label) => {
    const local = get().local;
    if (!local) return;
    const next = renameSecretEntryAction(local, id, label);
    if (next === local) return;
    set({ local: next });
    void saveLocal(next);
  },

  removeSecret: async (id) => {
    const local = get().local;
    if (!local || !local.secretIndex.entries[id]) return;
    await deleteSecretPayload(id);
    const next = removeSecretEntryAction(local, id);
    set({ local: next });
    void saveLocal(next);
  },

  recomputeSecretUsage: () => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const next = recomputeUsedIn(synced, local);
    if (next === local) return;
    set({ local: next });
    void saveLocal(next);
  },

  // --- GitHub session ----------------------------------------------------

  connectGitHubSession: async (token) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Token is required');

    // Verify via GET /user; throws MissingScopeError when base scopes are missing.
    const client = new GitHubClient();
    const { viewer, scopes } = await client.getViewer(trimmed, {
      requiredScopes: [...REQUIRED_BASE_SCOPES],
    });
    const missingBase = REQUIRED_BASE_SCOPES.filter((s) => !scopes.granted.includes(s));
    if (missingBase.length > 0) {
      throw new MissingScopeError(
        `Token is missing required base scopes: ${missingBase.join(', ')}.`,
        403,
        [...missingBase],
        scopes.granted,
      );
    }

    // Persist the PAT in the secret vault (re-using the master-key flow).
    const tokenSecretId = generateId();
    const masterKey = await getMasterKey();
    const payload = await encryptString(trimmed, masterKey);
    await putSecretPayload(tokenSecretId, payload);
    const indexed = addSecretEntryAction(local, {
      id: tokenSecretId,
      label: `${GITHUB_TOKEN_LABEL_PREFIX}${viewer.login}`,
    });
    if (indexed === local) {
      // Label collision (already a session for this account?) — clean up.
      await deleteSecretPayload(tokenSecretId);
      throw new Error(`A session for ${viewer.login} already exists`);
    }

    const session: GitHubSession = {
      accountLogin: viewer.login,
      tokenSecretId,
      grantedScopes: scopes.granted,
      addedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = { ...indexed, sessions: { github: session } };
    set({ local: next });
    void saveLocal(next);
    return session;
  },

  verifyGitHubScopes: async () => {
    const local = get().local;
    const session = local?.sessions.github ?? null;
    if (!local || !session) return null;
    const payload = await getSecretPayload(session.tokenSecretId);
    if (!payload) return null;
    const masterKey = await getMasterKey();
    const token = await decryptString(payload, masterKey);
    const client = new GitHubClient();
    const { scopes } = await client.getViewer(token);
    const updated: GitHubSession = {
      ...session,
      grantedScopes: scopes.granted,
      lastVerifiedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = { ...local, sessions: { github: updated } };
    set({ local: next });
    void saveLocal(next);
    return scopes.granted;
  },

  updateGitHubToken: async (token) => {
    const local = get().local;
    const session = local?.sessions.github ?? null;
    if (!local || !session) throw new Error('No active session to update');
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Token is required');

    const client = new GitHubClient();
    const { viewer, scopes } = await client.getViewer(trimmed);
    if (viewer.login !== session.accountLogin) {
      throw new Error(
        `Token belongs to ${viewer.login} but the active session is for ${session.accountLogin}. Disconnect first.`,
      );
    }
    // Rotate the ciphertext under the existing slot id; branch/PR state
    // (working branch, ahead/behind, etc) is preserved verbatim.
    const masterKey = await getMasterKey();
    const payload = await encryptString(trimmed, masterKey);
    await putSecretPayload(session.tokenSecretId, payload);
    const updated: GitHubSession = {
      ...session,
      grantedScopes: scopes.granted,
      lastVerifiedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = { ...local, sessions: { github: updated } };
    set({ local: next });
    void saveLocal(next);
    return updated;
  },

  disconnectGitHubSession: async () => {
    const local = get().local;
    const session = local?.sessions.github ?? null;
    if (!local || !session) return;
    await deleteSecretPayload(session.tokenSecretId);
    const indexCleared = removeSecretEntryAction(local, session.tokenSecretId);
    const next: WorkspaceLocal = {
      ...indexCleared,
      sessions: { github: null },
      // Disconnecting the session also drops the repo + branch — they're
      // unusable without an authenticated client.
      connectedRepo: null,
      workingBranch: null,
    };
    set({ local: next });
    void saveLocal(next);
  },

  // --- Repo + working-branch (P4.2) -------------------------------------

  connectRepo: async (owner, name) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const token = await decryptSessionToken(local);

    const client = new GitHubClient();
    const repo: GitHubRepo = await client.getRepo(token, owner.trim(), name.trim());

    const connected: ConnectedRepo = {
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
      visibility: repo.visibility,
      isPrivate: repo.isPrivate,
      pushable: repo.pushable,
      connectedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = {
      ...local,
      connectedRepo: connected,
      // If the user re-connects to a different repo, drop any branch tied
      // to the old one — pushing to the wrong repo would be a disaster.
      workingBranch:
        local.workingBranch?.repoFullName === connected.fullName ? local.workingBranch : null,
    };
    set({ local: next });
    void saveLocal(next);
    return connected;
  },

  disconnectRepo: () => {
    const local = get().local;
    if (!local) return;
    if (!local.connectedRepo && !local.workingBranch) return;
    const next: WorkspaceLocal = {
      ...local,
      connectedRepo: null,
      workingBranch: null,
    };
    set({ local: next });
    void saveLocal(next);
  },

  createWorkingBranch: async (opts) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const repo = local.connectedRepo;
    if (!repo) throw new Error('Connect a repo before creating a working branch');

    const baseBranch = opts?.baseBranch?.trim() || repo.defaultBranch;
    const branchName =
      opts?.branchName?.trim() ||
      generateWorkingBranchName({ workspaceName: synced.workspaceName });

    const validationError = validateBranchName(branchName);
    if (validationError) throw new Error(validationError);

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();

    // Read the base branch HEAD, then create the new ref.
    const head = await client.getBranchHead(token, repo.owner, repo.name, baseBranch);
    const created = await client.createBranch(
      token,
      repo.owner,
      repo.name,
      branchName,
      head.commitSha,
    );

    const branch: WorkingBranch = {
      name: created.name,
      baseBranch,
      repoFullName: repo.fullName,
      repoOwner: repo.owner,
      repoName: repo.name,
      headSha: created.commitSha,
      createdAt: new Date().toISOString(),
      lastPushedSha: null,
      diffSummary: null,
      openPrUrl: null,
    };
    const next: WorkspaceLocal = { ...local, workingBranch: branch };
    set({ local: next });
    void saveLocal(next);
    return branch;
  },

  discardWorkingBranch: () => {
    const local = get().local;
    if (!local || !local.workingBranch) return;
    const next: WorkspaceLocal = { ...local, workingBranch: null };
    set({ local: next });
    void saveLocal(next);
  },

  pushWorkspace: async (commitMessage) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch before pushing');
    const repo = local.connectedRepo;
    if (!repo) throw new Error('No repo connected');

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const owner = branch.repoOwner;
    const name = branch.repoName;

    // 1. Read the branch's current head SHA.
    const head = await client.getRef(token, owner, name, branch.name);
    // 2. Read its tree SHA.
    const headCommit = await client.getCommit(token, owner, name, head.sha);
    // 3. Upload every locally-cached attachment as a blob. Slots whose
    //    bytes aren't in local IDB are skipped — base_tree keeps the
    //    remote entry intact (or absent, on first push).
    const slots = collectAttachmentSlots(synced);
    const attachmentEntries: TreeEntryInput[] = [];
    for (const slot of slots) {
      const record = await getAttachment(slot.slotId);
      if (!record) continue;
      const blob = await client.createBlob(token, owner, name, {
        content: bytesToBase64(record.bytes),
        encoding: 'base64',
      });
      attachmentEntries.push({
        path: `.apicircle/attachments/${slot.slotId}`,
        sha: blob.sha,
      });
    }
    // 4. Build the new tree, layering workspace.json + attachments over base_tree.
    const content = serializeWorkspaceForGit(synced);
    const newTree = await client.createTree(token, owner, name, {
      baseTreeSha: headCommit.treeSha,
      entries: [{ path: 'workspace.json', content }, ...attachmentEntries],
    });
    // 5. Create the commit.
    const message = (commitMessage ?? '').trim() || 'chore: sync workspace via API Circle Studio';
    const newCommit = await client.createCommit(token, owner, name, {
      message,
      treeSha: newTree.sha,
      parents: [head.sha],
    });
    // 6. Fast-forward the branch ref.
    await client.updateRef(token, owner, name, {
      branch: branch.name,
      sha: newCommit.sha,
    });

    // 7. Persist the new local branch state.
    const updatedBranch: WorkingBranch = {
      ...branch,
      headSha: newCommit.sha,
      lastPushedSha: newCommit.sha,
    };
    const next: WorkspaceLocal = { ...get().local!, workingBranch: updatedBranch };
    set({ local: next });
    void saveLocal(next);
    return { commitSha: newCommit.sha };
  },

  publishRelease: async (args) => {
    const synced = get().synced;
    if (!synced) return;
    const next = await publishReleaseAction(synced, args);
    set({ synced: next });
    void saveSynced(next);
  },

  deprecateRelease: (version) => {
    commitSynced(set, get, (s) => deprecateReleaseAction(s, version));
  },

  yankRelease: (version) => {
    commitSynced(set, get, (s) => yankReleaseAction(s, version));
  },

  refreshWorkspace: async () => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch before refreshing');

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const file = await client.getContents(
      token,
      branch.repoOwner,
      branch.repoName,
      'workspace.json',
      branch.name,
    );
    if (file === null) {
      // Branch has no workspace.json yet — first push hasn't happened.
      return { status: 'no-remote' };
    }

    const remote = JSON.parse(file.content) as WorkspaceSynced;
    const base = local.sync.lastPulledSnapshot;
    const diff = computeThreeWayDiff(base, synced, remote);

    if (diff.entries.length === 0) {
      // Local + remote agree — nothing to merge, just refresh the snapshot.
      const next: WorkspaceLocal = {
        ...get().local!,
        sync: {
          ...local.sync,
          lastPulledSnapshot: remote,
          lastPulledSha: file.sha,
          lastPulledAt: new Date().toISOString(),
        },
      };
      set({ local: next });
      void saveLocal(next);
      return { status: 'up-to-date' };
    }

    if (diff.conflicts.length === 0) {
      // No conflicts — auto-merge.
      const merged = applyMerge(synced, remote, diff, {});
      await persistMerged(set, get, merged, file.sha);
      return { status: 'merged' };
    }

    // Conflicts — stash the diff and let the modal drive commitRefresh.
    set({ pendingRefresh: { diff, remote, remoteSha: file.sha } });
    return { status: 'conflicts', diff };
  },

  commitRefresh: async (resolutions) => {
    const pending = get().pendingRefresh;
    const synced = get().synced;
    if (!pending || !synced) throw new Error('No pending refresh to commit');
    const merged = applyMerge(synced, pending.remote, pending.diff, resolutions);
    await persistMerged(set, get, merged, pending.remoteSha);
    set({ pendingRefresh: null });
  },

  cancelRefresh: () => set({ pendingRefresh: null }),

  createPullRequest: async (args) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch first');
    if (!branch.lastPushedSha) {
      throw new Error('Push to save before opening a PR');
    }
    if (branch.openPrUrl) {
      throw new Error('A pull request is already open for this branch');
    }

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const pr = await client.createPullRequest(token, branch.repoOwner, branch.repoName, {
      title: args?.title?.trim() || 'APICircle workspace updates',
      body: args?.body ?? '',
      head: branch.name,
      base: branch.baseBranch,
      draft: args?.draft ?? false,
    });

    const updatedBranch: WorkingBranch = { ...branch, openPrUrl: pr.htmlUrl };
    const next: WorkspaceLocal = { ...get().local!, workingBranch: updatedBranch };
    set({ local: next });
    void saveLocal(next);
    return { number: pr.number, htmlUrl: pr.htmlUrl };
  },

  executeActiveRequest: async () => {
    const state = get();
    const id = state.local?.ui.activeRequestId;
    const synced = state.synced;
    if (!id || !synced) return;
    const request = synced.collections.requests[id];
    if (!request) return;

    set((s) => ({ isExecuting: { ...s.isExecuting, [id]: true } }));
    try {
      const resolved = await resolveRequest(request, synced, get().local);
      const result = await coreExecuteRequest(resolved, {
        resolveAttachment: attachmentResolver,
      });
      const assertionResults = runAssertions(request.assertions, result);
      const run: RequestRun = {
        id: generateId(),
        requestId: id,
        startedAt: result.startedAt,
        durationMs: result.durationMs,
        status: result.status,
        ok: result.ok,
        error: result.error,
        assertions: assertionResults,
      };
      const local = get().local;
      if (local) {
        const trimmed = [run, ...local.history.requestRuns].slice(0, MAX_REQUEST_RUNS);
        const next: WorkspaceLocal = {
          ...local,
          history: { ...local.history, requestRuns: trimmed },
        };
        set({ local: next });
        void saveLocal(next);
      }
      set((s) => ({ lastRun: { ...s.lastRun, [id]: result } }));
    } finally {
      set((s) => ({ isExecuting: { ...s.isExecuting, [id]: false } }));
    }
  },
}));

type SetState = (
  partial: Partial<WorkspaceStore> | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
) => void;
type GetState = () => WorkspaceStore;

/**
 * Decrypt the active GitHub PAT via the master key. Throws when no session
 * exists or the encrypted payload is missing — both surface in the UI as
 * "no GitHub connection."
 */
/**
 * Persist a 3-way-merged synced doc + roll the sync snapshot forward.
 * Both the synced and local stores are touched in one transactional pair
 * — the sync snapshot is meaningless if the synced doc can't be saved.
 */
async function persistMerged(
  set: SetState,
  get: GetState,
  merged: WorkspaceSynced,
  remoteSha: string,
): Promise<void> {
  const local = get().local;
  if (!local) return;
  const nextLocal: WorkspaceLocal = {
    ...local,
    sync: {
      ...local.sync,
      lastPulledSnapshot: merged,
      lastPulledSha: remoteSha,
      lastPulledAt: new Date().toISOString(),
    },
  };
  set({ synced: merged, local: nextLocal });
  await Promise.all([saveSynced(merged), saveLocal(nextLocal)]);
}

async function decryptSessionToken(local: WorkspaceLocal): Promise<string> {
  const session = local.sessions.github;
  if (!session) throw new Error('No GitHub session — connect a PAT first');
  const payload = await getSecretPayload(session.tokenSecretId);
  if (!payload) throw new Error('Stored token is missing — reconnect to refresh');
  const masterKey = await getMasterKey();
  return decryptString(payload, masterKey);
}

function commitSynced(
  set: SetState,
  get: GetState,
  reducer: (s: WorkspaceSynced) => WorkspaceSynced,
): void {
  const synced = get().synced;
  if (!synced) return;
  const next = reducer(synced);
  if (next === synced) return;
  set({ synced: next });
  void saveSynced(next);
  // Refresh the secret usedIn map whenever synced state moves; aggregator
  // is O(refs × secrets) and a no-op when nothing the secrets reference
  // changed, so this is cheap to do unconditionally.
  const local = get().local;
  if (local && Object.keys(local.secretIndex.entries).length > 0) {
    const updatedLocal = recomputeUsedIn(next, local);
    if (updatedLocal !== local) {
      set({ local: updatedLocal });
      void saveLocal(updatedLocal);
    }
  }
}

/**
 * Apply variable substitution + secret decryption to a request before it
 * goes to the executor. URL, query params, headers, body content, and
 * (for json/text/xml/graphql) the raw body string are all resolved against
 * the workspace scope (context vars > active env > priority list > secrets).
 *
 * Encrypted env-var values are decrypted in this single pass — the master
 * key is fetched once, decryption runs in parallel for the variables that
 * need it, and the resulting plaintext-only env map feeds the resolver.
 */
async function resolveRequest(
  request: ApiRequest,
  synced: WorkspaceSynced,
  local: WorkspaceLocal | null,
): Promise<ApiRequest> {
  const envs = await decryptEnvironments(synced.environments.items);
  const secrets = local ? await decryptVaultSecrets(local) : {};

  const contextVars = request.contextVars;
  const scope = buildScope({
    contextVars,
    environments: envs,
    activeEnvName: synced.environments.activeName,
    priorityOrder: synced.environments.priorityOrder,
    secrets,
  });

  const url = resolveString(request.url, scope).value;
  const headers = request.headers.map((h) => ({
    ...h,
    key: resolveString(h.key, scope).value,
    value: resolveString(h.value, scope).value,
  }));
  const query = request.query.map((q) => ({
    ...q,
    key: resolveString(q.key, scope).value,
    value: resolveString(q.value, scope).value,
  }));

  let body: RequestBody = request.body;
  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'graphql' ||
    body.type === 'urlencoded'
  ) {
    body = { ...body, content: resolveString(body.content, scope).value };
  } else if (body.type === 'form-data' && body.formRows) {
    body = {
      ...body,
      formRows: body.formRows.map((row) => {
        if (row.kind === 'text') {
          return {
            ...row,
            key: resolveString(row.key, scope).value,
            value: resolveString(row.value, scope).value,
          };
        }
        return { ...row, key: resolveString(row.key, scope).value };
      }),
    };
  }

  return { ...request, url, headers, query, body };
}

/**
 * Decrypt every encrypted variable in the workspace's env map and return a
 * plaintext map keyed by env name. Plain (non-encrypted) values pass through
 * verbatim. Decryption failures fall back to the ciphertext literal so the
 * user can see something went wrong rather than silently sending garbage.
 */
/**
 * Decrypt every Secret Vault entry into a flat label → plaintext map. The
 * resolver scope's `secrets` layer reads from this. Decryption failures
 * (lost master key, tampered ciphertext) drop the entry — the resolver
 * falls back to leaving the placeholder verbatim, which surfaces the
 * problem to the user rather than silently sending an empty value.
 */
async function decryptVaultSecrets(local: WorkspaceLocal): Promise<Record<string, string>> {
  const ids = Object.keys(local.secretIndex.entries);
  if (ids.length === 0) return {};
  const key = await getMasterKey();
  const out: Record<string, string> = {};
  for (const id of ids) {
    const entry = local.secretIndex.entries[id];
    const payload = await getSecretPayload(id);
    if (!payload) continue;
    try {
      out[entry.label] = await decryptString(payload, key);
    } catch {
      // skip on decrypt failure
    }
  }
  return out;
}

async function decryptEnvironments(
  items: Record<string, Environment>,
): Promise<Record<string, Record<string, string>>> {
  const needsKey = Object.values(items).some((env) =>
    env.variables.some((v) => v.encrypted && tryParsePayload(v.value)),
  );
  const key = needsKey ? await getMasterKey() : null;
  const out: Record<string, Record<string, string>> = {};
  for (const [name, env] of Object.entries(items)) {
    const flat: Record<string, string> = {};
    for (const v of env.variables) {
      if (!v.key) continue;
      if (v.encrypted && key) {
        const payload = tryParsePayload(v.value);
        if (payload) {
          try {
            flat[v.key] = await decryptString(payload, key);
            continue;
          } catch {
            // fall through to ciphertext literal
          }
        }
      }
      flat[v.key] = v.value;
    }
    out[name] = flat;
  }
  return out;
}
