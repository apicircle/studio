import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { VISIBLE_PANELS } from './panels';
import { useExtraPanels, type ExtraPanelDef } from './extraPanels';
import { resolveActiveSection, useSections, type SectionDef } from './sections';

/** One tab of the top-nav strip. */
export interface VisibleTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Listed by more than one section, so it stays in the strip across modes. */
  shared: boolean;
}

/**
 * The tabs the strip shows, left to right: core panels first, then the
 * edition's, narrowed to the active section when sections are registered.
 *
 * `PanelTabs` renders this list and `KeyboardShortcuts` indexes it, which is
 * what makes "Ctrl+N selects the Nth tab" true by construction in every mode,
 * instead of by two places agreeing to count the same way.
 */
export function visibleTabs(
  extraPanels: readonly ExtraPanelDef[],
  sections: readonly SectionDef[],
  activeSectionId: string,
): VisibleTab[] {
  const all = [...VISIBLE_PANELS, ...extraPanels];
  const section = resolveActiveSection(activeSectionId, sections);
  const shown = section ? all.filter((p) => section.panelIds.includes(p.id)) : all;
  return shown.map(({ id, label, icon }) => ({
    id,
    label,
    icon,
    shared: sections.filter((s) => s.panelIds.includes(id)).length > 1,
  }));
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
