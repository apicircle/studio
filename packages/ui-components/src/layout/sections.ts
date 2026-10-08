import { createContext, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Extension seam: an edition (built on top of Studio) can group the shell's
 * top-nav panels into top-level **sections** ("modes") — e.g. a "Studio" section
 * alongside an edition's "Lens" section — without forking the shell. Like
 * {@link ./extraPanels} this is **additive and a strict no-op when nothing is
 * registered**: Studio passes no sections, so the default context value is a
 * frozen empty array, the first-run landing + the mode groups never render, and
 * `PanelTabs` shows every panel exactly as before.
 *
 * The edition supplies sections via `<App sections={[…]} />`; App wires them into
 * `SectionsContext` (sourcing the active section from per-workspace persistence),
 * and `PanelTabs` / `SectionLanding` read them from there. Sign-in
 * gating for a section lives inside the edition (it renders its own gate when the
 * section carries `requiresAuth`); the seam only carries the flag, so no
 * entitlement concept leaks into Studio.
 *
 * The active section follows the visible panel. Anything can open a panel
 * through the store — an edition's own navigation calls
 * `setActivePanel('editor')` while its section is active — so when the active
 * panel is one the active section doesn't list, App selects the first section
 * that does and stores it as the workspace's mode, as a toggle click would. A
 * panel no section lists leaves the mode where it is, and following never
 * changes the active panel itself.
 *
 * With two or more sections the tab strip is one line of groups. Each section is
 * a header in it, and the active section's header is followed by that section's
 * own panels; the others stay folded to their header. Pressing a header makes
 * that section the active one, which unfolds it and folds the rest.
 *
 * A panel may be listed by more than one section. It is then **shared**: it
 * belongs to the workspace rather than to a mode, so it sits ahead of every
 * group, set off by a divider, and opening it never moves the mode — the active
 * section already lists it. A panel only one section lists is that section's
 * **own** ({@link ownPanelIds}).
 *
 * Each section remembers which of its own panels was last open, per workspace.
 * Pressing its header returns there instead of to its first panel, so a trip to
 * the other mode and back lands where it started. A shared panel is never what
 * a section remembers: pressing "Studio" from a shared page must open Studio.
 * Opening a panel directly through the store goes to that panel, whatever its
 * section remembered. The first-run landing opens a section at its first own
 * panel.
 */
export interface SectionDef {
  /** Edition-namespaced id, e.g. `lens.studio` / `lens.lens`. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Optional blurb shown on the first-run landing card. */
  description?: string;
  /**
   * Panel ids (core `PanelId`s and/or edition panel ids) that belong to this
   * section. `PanelTabs` shows only the active section's panels; a panel id not
   * listed in any section is simply hidden while that section is active.
   * Opening a panel that another section lists switches the mode to it.
   * The section opens on the first id only it lists, until it has a remembered
   * panel.
   */
  panelIds: readonly string[];
  /**
   * When true, the edition requires sign-in to *enter* this section (it renders
   * its own sign-in gate inside the section's panels). The seam only carries the
   * flag — core never checks entitlement.
   */
  requiresAuth?: boolean;
}

/** Frozen shared identity so the default context value never triggers re-renders. */
export const NO_SECTIONS: readonly SectionDef[] = Object.freeze([]);

export interface SectionsContextValue {
  /** The registered sections — `[]` in Studio, populated in an edition. */
  sections: readonly SectionDef[];
  /** The active section id (per-workspace mode, sourced from the store/App). */
  activeSectionId: string;
  /** Switch the active section (App persists it per-workspace). */
  setActiveSectionId: (id: string) => void;
}

const SectionsContext = createContext<SectionsContextValue>({
  sections: NO_SECTIONS,
  activeSectionId: '',
  setActiveSectionId: () => {},
});

export const SectionsProvider = SectionsContext.Provider;

/** The registered sections + active-mode state — empty/no-op in Studio. */
export function useSections(): SectionsContextValue {
  return useContext(SectionsContext);
}

/**
 * The active `SectionDef`, resolved non-throwing: the section matching
 * `activeSectionId`, else the first registered section, else `null` (no sections
 * registered). Never throws, so a stale persisted mode can't crash the shell.
 */
export function resolveActiveSection(
  activeSectionId: string,
  sections: readonly SectionDef[],
): SectionDef | null {
  return sections.find((s) => s.id === activeSectionId) ?? sections[0] ?? null;
}

// ── per-workspace mode persistence ───────────────────────────────────────────
// Mirrors the store's `readStoredPanel`/`writeStoredPanel` (localStorage, so the
// mode never bloats the workspace doc) but keyed BY workspace id, so each
// workspace remembers its own mode. Per-device, like `activePanel`.

const SECTION_STORAGE_PREFIX = 'apicircle-v2:active-section:';

/**
 * The stored section for a workspace, validated against the registered sections.
 * Returns the first section when unset, unknown/stale, or when <2 sections exist
 * (so a single-section edition and Studio both resolve deterministically).
 */
export function readStoredSection(workspaceId: string, sections: readonly SectionDef[]): string {
  const first = sections[0]?.id ?? '';
  if (sections.length <= 1 || typeof localStorage === 'undefined') return first;
  try {
    const stored = localStorage.getItem(SECTION_STORAGE_PREFIX + workspaceId);
    if (stored && sections.some((s) => s.id === stored)) return stored;
  } catch {
    /* ignore — treat storage errors as "no stored mode" */
  }
  return first;
}

/** Persist the active section for a workspace (no-op without localStorage). */
export function writeStoredSection(workspaceId: string, id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SECTION_STORAGE_PREFIX + workspaceId, id);
  } catch {
    /* ignore */
  }
}

// ── per-section last-panel persistence ───────────────────────────────────────
// The panel last open in a section, keyed by workspace AND section, so every
// workspace remembers where each of its modes was left. Per-device, like the
// mode itself.

const SECTION_PANEL_STORAGE_PREFIX = 'apicircle-v2:section-panel:';

function sectionPanelKey(workspaceId: string, sectionId: string): string {
  return `${SECTION_PANEL_STORAGE_PREFIX}${workspaceId}:${sectionId}`;
}

/** The panel last open in a workspace's section, or `null` when none is stored. */
export function readStoredSectionPanel(workspaceId: string, sectionId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(sectionPanelKey(workspaceId, sectionId));
  } catch {
    return null;
  }
}

/** Remember the panel open in a workspace's section (no-op without localStorage). */
export function writeStoredSectionPanel(
  workspaceId: string,
  sectionId: string,
  panelId: string,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(sectionPanelKey(workspaceId, sectionId), panelId);
  } catch {
    /* ignore */
  }
}

/**
 * The panels only this section lists, in its own order. A panel another section
 * lists too is shared between modes and is left out.
 */
export function ownPanelIds(section: SectionDef, sections: readonly SectionDef[]): string[] {
  return section.panelIds.filter(
    (panelId) =>
      !sections.some((other) => other.id !== section.id && other.panelIds.includes(panelId)),
  );
}

/**
 * The panel a section opens on: the remembered one while it is still one of the
 * section's own and the shell still shows it, else the first of its own panels
 * the shell shows (`undefined` for a section with no panels). `isShown` is what
 * keeps a stale memory from opening a panel that is no longer there, such as an
 * edition panel the account has since lost, and what skips a panel this build
 * hides when picking the first one.
 *
 * A section whose every panel is shared has none of its own; it opens on the
 * panels it lists instead. When the shell shows none of the candidates yet — an
 * edition can contribute a panel after launch — the first one is still named,
 * so the caller can wait for it.
 */
export function resolveSectionPanel(
  section: SectionDef,
  sections: readonly SectionDef[],
  stored: string | null,
  isShown: (panelId: string) => boolean,
): string | undefined {
  const own = ownPanelIds(section, sections);
  const candidates = own.length > 0 ? own : section.panelIds;
  if (stored !== null && candidates.includes(stored) && isShown(stored)) return stored;
  return candidates.find(isShown) ?? candidates[0];
}
