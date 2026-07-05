import { createContext, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Extension seam: an edition (built on top of Studio) can group the shell's
 * top-nav panels into top-level **sections** ("modes") — e.g. a "Studio" section
 * alongside an edition's "Lens" section — without forking the shell. Like
 * {@link ./extraPanels} this is **additive and a strict no-op when nothing is
 * registered**: Studio passes no sections, so the default context value is a
 * frozen empty array, the first-run landing + the top toggle never render, and
 * `PanelTabs` shows every panel exactly as before.
 *
 * The edition supplies sections via `<App sections={[…]} />`; App wires them into
 * `SectionsContext` (sourcing the active section from per-workspace persistence),
 * and `PanelTabs` / `TopBar` / `SectionLanding` read them from there. Sign-in
 * gating for a section lives inside the edition (it renders its own gate when the
 * section carries `requiresAuth`); the seam only carries the flag, so no
 * entitlement concept leaks into Studio.
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
