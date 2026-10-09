import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TAB_PANELS, VISIBLE_PANELS } from './panels';
import { useExtraPanels, type ExtraPanelDef } from './extraPanels';
import { resolveActiveSection, useSections, type SectionDef } from './sections';

/** One tab of the top-nav strip. */
export interface VisibleTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /**
   * Listed by more than one section: it belongs to the workspace rather than to
   * a mode, sits ahead of the mode groups and stays in the strip across modes.
   */
  shared: boolean;
}

/**
 * The tabs the strip shows, left to right. With no sections: core panels, then
 * the edition's. With sections: the panels every mode shares first, then the
 * active section's own — each run in the shell's panel order.
 *
 * `PanelTabs` renders this list and `KeyboardShortcuts` indexes it, which is
 * what makes "Ctrl+N selects the Nth tab" true by construction in every mode,
 * instead of by two places agreeing to count the same way.
 *
 * A core panel opened from the top bar (Help Center) is never in it, whatever a
 * section lists: its button is in `TopBar`.
 */
export function visibleTabs(
  extraPanels: readonly ExtraPanelDef[],
  sections: readonly SectionDef[],
  activeSectionId: string,
): VisibleTab[] {
  const all = [...TAB_PANELS, ...extraPanels];
  const section = resolveActiveSection(activeSectionId, sections);
  const shown = section ? all.filter((p) => section.panelIds.includes(p.id)) : all;
  const tabs = shown.map(({ id, label, icon }) => ({
    id,
    label,
    icon,
    shared: sections.filter((s) => s.panelIds.includes(id)).length > 1,
  }));
  return [...tabs.filter((tab) => tab.shared), ...tabs.filter((tab) => !tab.shared)];
}

/**
 * `visibleTabs` for the current shell. The list keeps its identity until the
 * panels, the sections or the mode change, so an effect that depends on it
 * does not re-subscribe on every render.
 */
export function useVisibleTabs(): readonly VisibleTab[] {
  const extraPanels = useExtraPanels();
  const { sections, activeSectionId } = useSections();
  return useMemo(
    () => visibleTabs(extraPanels, sections, activeSectionId),
    [extraPanels, sections, activeSectionId],
  );
}

/** Whether the shell has a panel with this id to show — core or edition. */
export function isShownPanel(panelId: string, extraPanels: readonly ExtraPanelDef[]): boolean {
  return VISIBLE_PANELS.some((p) => p.id === panelId) || extraPanels.some((p) => p.id === panelId);
}
