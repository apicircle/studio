import type { PanelId } from '@apicircle-v2/shared';
import {
  Boxes,
  GitBranch,
  HelpCircle,
  History,
  Layers,
  PencilLine,
  PlayCircle,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface PanelDef {
  id: PanelId;
  label: string;
  icon: LucideIcon;
  hasSidebar: boolean;
}

// Same order as v1's top nav: Git → API Connections → Editor → Environments
// → Execution → History → Settings → Help Center.
export const PANELS: ReadonlyArray<PanelDef> = [
  { id: 'git', label: 'Git', icon: GitBranch, hasSidebar: true },
  { id: 'api-connections', label: 'API Connections', icon: Boxes, hasSidebar: true },
  { id: 'editor', label: 'Editor', icon: PencilLine, hasSidebar: true },
  { id: 'env', label: 'Environments', icon: Layers, hasSidebar: true },
  { id: 'execution', label: 'Execution', icon: PlayCircle, hasSidebar: true },
  { id: 'history', label: 'History', icon: History, hasSidebar: true },
  { id: 'settings', label: 'Settings', icon: Settings, hasSidebar: true },
  { id: 'help', label: 'Help Center', icon: HelpCircle, hasSidebar: false },
];

export function getPanel(id: PanelId): PanelDef {
  const panel = PANELS.find((p) => p.id === id);
  if (!panel) throw new Error(`Unknown panel: ${id}`);
  return panel;
}
