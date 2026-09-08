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
}

// Top nav per revisions: 'Workspace' (was Git) → 'Link Workspace' (was API
// Connections) → Editor → Environments → Execution → History → Mocks → MCP →
// Help Center. Settings panel removed; Secret Vault and Theme moved to TopBar.
// Mocks + MCP added in P27 (Phase 2 — mock server runtime + AI client wiring).
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
  { id: 'help', label: 'Help Center', icon: HelpCircle, hasSidebar: true },
];

/**
 * The panels this build actually shows, in tab order.
 *
 * `PANELS` keeps every entry on purpose — `getPanel`, `resolveActivePanel` and
 * the store's `VALID_PANELS` all still have to resolve `'link-workspace'` so a
 * value persisted by an earlier build round-trips instead of crashing the
 * shell. This is the list for anything user-facing.
 *
 * Frozen at module scope rather than filtered per call, because
 * `KeyboardShortcuts` indexes it inside a `useEffect` — a fresh array identity
 * per render would re-subscribe the global keydown listener every render. It is
 * also the single list `PanelTabs` and `KeyboardShortcuts` both read, which is
 * what makes "Ctrl+N always selects the Nth visible tab" true by construction
 * rather than by two places agreeing to count the same way.
 */
export const VISIBLE_PANELS: ReadonlyArray<PanelDef> = Object.freeze(visibleUnderSharing(PANELS));

export function getPanel(id: PanelId): PanelDef {
  const panel = PANELS.find((p) => p.id === id);
  if (!panel) throw new Error(`Unknown panel: ${id}`);
  return panel;
}
