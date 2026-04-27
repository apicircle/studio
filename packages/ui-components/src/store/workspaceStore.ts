import type {
  AttachmentRef,
  Assertion,
  Environment,
  FormDataRow,
  HttpMethod,
  PanelId,
  Request as ApiRequest,
  RequestBody,
  RequestRun,
  ThemeId,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle-v2/shared';
import { generateId } from '@apicircle-v2/shared';
import {
  type AttachmentResolver,
  type ExecutionResult,
  buildScope,
  decryptString,
  encryptString,
  executeRequest as coreExecuteRequest,
  resolveString,
  runAssertions,
  serializePayload,
  tryParsePayload,
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

type WorkspaceStore = {
  ready: boolean;
  synced: WorkspaceSynced | null;
  local: WorkspaceLocal | null;

  activePanel: PanelId;
  secretVaultOpen: boolean;
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

  executeActiveRequest: () => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ready: false,
  synced: null,
  local: null,
  activePanel: readStoredPanel(),
  secretVaultOpen: false,
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
