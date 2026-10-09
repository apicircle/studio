import type { PanelId } from '@apicircle/shared';
import {
  HelpCircle,
  History,
  Layers,
  Link2,
  PencilLine,
  PlayCircle,
  Server,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { visibleUnderSharing, type SharingTagged } from './workspaceSharing';

export interface PanelDef extends SharingTagged {
  id: PanelId;
  label: string;
  icon: LucideIcon;
  hasSidebar: boolean;
  /**
   * Opened from a button in the top bar instead of a tab in the strip. Such a
   * panel is a place to look something up from anywhere, not a stage of the
   * work, so it has no position among the tabs and no `Ctrl/Cmd + N`.
   */
  topBar?: true;
}

// The panels, in tab order: Workspace → Link Workspace → Editor → Environments
// → Execution → History → Mocks. Help Center is last and is not a tab: it is
// opened from the top bar (`topBar`).
export const PANELS: ReadonlyArray<PanelDef> = [
  { id: 'workspace', label: 'Workspace', icon: Workflow, hasSidebar: false },
  {
    id: 'link-workspace',
    label: 'Link Workspace',
    icon: Link2,
    hasSidebar: false,
    requiresWorkspaceSharing: true,
  },
  { id: 'editor', label: 'Editor', icon: PencilLine, hasSidebar: true },
  { id: 'env', label: 'Environments', icon: Layers, hasSidebar: true },
  { id: 'execution', label: 'Execution', icon: PlayCircle, hasSidebar: true },
  { id: 'history', label: 'History', icon: History, hasSidebar: true },
  { id: 'mocks', label: 'Mocks', icon: Server, hasSidebar: true },
  { id: 'help', label: 'Help Center', icon: HelpCircle, hasSidebar: true, topBar: true },
];

/**
 * The panels this build actually shows — everything a user can open, wherever
 * its entry is.
 *
 * `PANELS` keeps every entry on purpose — `getPanel`, `resolveActivePanel` and
 * the store's `VALID_PANELS` all still have to resolve `'link-workspace'` so a
 * value persisted by an earlier build round-trips instead of crashing the
 * shell. This is the list for anything user-facing.
 *
 * Frozen at module scope rather than filtered per call, so its identity never
 * changes.
 */
export const VISIBLE_PANELS: ReadonlyArray<PanelDef> = Object.freeze(visibleUnderSharing(PANELS));

/**
 * The shown panels that are tabs, in tab order: `VISIBLE_PANELS` without the
 * ones opened from the top bar.
 *
 * `visibleTabs` builds the tab strip from it — the one list `PanelTabs` renders
 * and `KeyboardShortcuts` indexes, which is what makes "Ctrl+N always selects
 * the Nth visible tab" true by construction rather than by two places agreeing
 * to count the same way. Frozen at module scope for the same reason as above.
 */
export const TAB_PANELS: ReadonlyArray<PanelDef> = Object.freeze(
  VISIBLE_PANELS.filter((p) => !p.topBar),
);

/**
 * The shown panels opened from the top bar, in the order their buttons sit.
 * `TopBar` draws one button for each, so tagging a panel `topBar` is all it
 * takes to move it there.
 */
export const TOP_BAR_PANELS: ReadonlyArray<PanelDef> = Object.freeze(
  VISIBLE_PANELS.filter((p) => p.topBar === true),
);

/** Whether `id` is a panel opened from the top bar instead of a tab. */
export function isTopBarPanel(id: string): boolean {
  return TOP_BAR_PANELS.some((p) => p.id === id);
}

export function getPanel(id: PanelId): PanelDef {
  const panel = PANELS.find((p) => p.id === id);
  if (!panel) throw new Error(`Unknown panel: ${id}`);
  return panel;
}
