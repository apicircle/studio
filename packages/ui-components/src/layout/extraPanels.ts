import { createContext, useContext, type ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PANELS, getPanel } from './panels';

/**
 * Extension seam: an edition (built on top of Studio) can contribute extra
 * top-nav panels without forking the shell. This is **additive and a strict
 * no-op when nothing is registered** — Studio itself passes no extras, so the
 * default context value is a frozen empty array and every consumer renders
 * exactly as before.
 *
 * The edition supplies its panels via `<App extraPanels={[…]} />`; App wires
 * them into `ExtraPanelsContext`, and `PanelTabs` / `PanelContent` / `Sidebar`
 * read them from there. Gating (sign-in) lives inside the edition's `Panel`
 * component — the core seam only renders it, so no entitlement concept leaks
 * into Studio.
 */
export interface ExtraPanelDef {
  /** Edition-namespaced id, e.g. `lens.discover`. Must not collide with a core `PanelId`. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Whether the panel shows the standard left sidebar. Defaults to `false`. */
  hasSidebar?: boolean;
  /** Main content component (rendered inside a `PanelErrorBoundary`). */
  Panel: ComponentType;
  /** Optional sidebar body (only used when `hasSidebar`). */
  Sidebar?: ComponentType;
  /** Optional sidebar-header actions (only used when `hasSidebar`). */
  SidebarActions?: ComponentType;
}

/** Frozen shared identity so the default context value never triggers re-renders. */
export const NO_EXTRA_PANELS: readonly ExtraPanelDef[] = Object.freeze([]);

const ExtraPanelsContext = createContext<readonly ExtraPanelDef[]>(NO_EXTRA_PANELS);

export const ExtraPanelsProvider = ExtraPanelsContext.Provider;

/** The registered extra panels — `[]` in Studio, populated in an edition. */
export function useExtraPanels(): readonly ExtraPanelDef[] {
  return useContext(ExtraPanelsContext);
}

export interface ResolvedActivePanel {
  id: string;
  label: string;
  hasSidebar: boolean;
  /** The `ExtraPanelDef` when the active panel is an edition panel, else `null`. */
  extra: ExtraPanelDef | null;
}

/**
 * Resolve the active panel to its display metadata across core panels **then**
 * registered extras — non-throwing (unlike `getPanel`), so an edition panel id
 * or a stale persisted id never crashes the shell. With no extras registered
 * and a core `activePanel` (the only states Studio ever reaches) this returns
 * exactly the matching core `PanelDef`, so the behavior is unchanged.
 */
export function resolveActivePanel(
  activePanel: string,
  extras: readonly ExtraPanelDef[],
): ResolvedActivePanel {
  const core = PANELS.find((p) => p.id === activePanel);
  if (core) return { id: core.id, label: core.label, hasSidebar: core.hasSidebar, extra: null };
  const extra = extras.find((p) => p.id === activePanel);
  if (extra) {
    return { id: extra.id, label: extra.label, hasSidebar: extra.hasSidebar ?? false, extra };
  }
  // Unknown id (e.g. a persisted edition id whose edition isn't loaded). The
  // store's `readStoredPanel` already guards init against this, but resolve
  // defensively to the default panel so the shell never throws.
  const fallback = getPanel('editor');
  return { id: fallback.id, label: fallback.label, hasSidebar: fallback.hasSidebar, extra: null };
}
