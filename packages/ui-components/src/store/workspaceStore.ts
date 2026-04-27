import type {
  AttachmentRef,
  Assertion,
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
  executeRequest as coreExecuteRequest,
  runAssertions,
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

  executeActiveRequest: async () => {
    const state = get();
    const id = state.local?.ui.activeRequestId;
    const synced = state.synced;
    if (!id || !synced) return;
    const request = synced.collections.requests[id];
    if (!request) return;

    set((s) => ({ isExecuting: { ...s.isExecuting, [id]: true } }));
    try {
      const result = await coreExecuteRequest(request, { resolveAttachment: attachmentResolver });
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
}
