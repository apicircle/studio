import type { PanelId, ThemeId, WorkspaceLocal, WorkspaceSynced } from '@apicircle-v2/shared';
import { create } from 'zustand';
import { loadWorkspace, saveLocal, saveSynced } from '../persistence/workspaceStorage';
import { applyTheme } from '../theme/applyTheme';

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

  // UI-only state lives in the store but not in the persisted local doc.
  activePanel: PanelId;
  secretVaultOpen: boolean;

  hydrate: () => Promise<void>;

  setActivePanel: (panel: PanelId) => void;
  setActiveRequestId: (id: string | null) => void;
  toggleSidebarSection: (section: string) => void;
  setThemeId: (themeId: ThemeId) => void;
  setWorkspaceName: (name: string) => void;

  openSecretVault: () => void;
  closeSecretVault: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ready: false,
  synced: null,
  local: null,
  activePanel: readStoredPanel(),
  secretVaultOpen: false,

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
}));
