import type { PanelId } from '@apicircle/shared';
import {
  Bot,
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

export interface PanelDef {
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
  { id: 'workspace', label: 'Workspace', icon: Workflow, hasSidebar: true },
  { id: 'link-workspace', label: 'Link Workspace', icon: Link2, hasSidebar: true },
  { id: 'editor', label: 'Editor', icon: PencilLine, hasSidebar: true },
  { id: 'env', label: 'Environments', icon: Layers, hasSidebar: true },
  { id: 'execution', label: 'Execution', icon: PlayCircle, hasSidebar: true },
  { id: 'history', label: 'History', icon: History, hasSidebar: true },
  { id: 'mocks', label: 'Mocks', icon: Server, hasSidebar: false },
  { id: 'mcp', label: 'MCP', icon: Bot, hasSidebar: false },
  { id: 'help', label: 'Help Center', icon: HelpCircle, hasSidebar: false },
];

export function getPanel(id: PanelId): PanelDef {
  const panel = PANELS.find((p) => p.id === id);
  if (!panel) throw new Error(`Unknown panel: ${id}`);
  return panel;
}
