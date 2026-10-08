import { useState } from 'react';
import { cn } from '../primitives/cn';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useExtraPanels } from './extraPanels';
import { resolveSectionPanel, useSections, type SectionDef } from './sections';
import { isShownPanel } from './visibleTabs';

const LANDING_DISMISSED_KEY = 'apicircle:section-landing-done-v1';

function landingDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(LANDING_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function markDismissed(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LANDING_DISMISSED_KEY, 'true');
  } catch {
    /* ignore */
  }
}

/**
 * First-run landing, shown once on first app entry when an edition registers
 * >=2 sections — lets the user pick a starting mode (e.g. Studio vs Lens).
 * Strict no-op in Studio: App only mounts it when `sections.length > 1`, and it
 * renders `null` once dismissed. Picking a card enters that section at the first
 * panel of its own and dismisses the landing; the mode groups in the tab strip
 * switch modes thereafter, returning to the panel each mode was left on.
 */
export function SectionLanding() {
  const { sections, setActiveSectionId } = useSections();
  const extraPanels = useExtraPanels();
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  const [dismissed, setDismissed] = useState(landingDismissed);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    markDismissed();
  };

  const choose = (section: SectionDef) => {
    setActiveSectionId(section.id);
    // A card is a fresh start, not a return trip: open the section at the first
    // panel of its own, whichever panel the shell happened to restore underneath
    // the landing. Nothing remembered is passed, so nothing remembered is used.
    const firstPanel = resolveSectionPanel(section, sections, null, (panelId) =>
      isShownPanel(panelId, extraPanels),
    );
    if (firstPanel) setActivePanel(firstPanel);
    dismiss();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-landing-title"
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-xl">
        <h1 id="section-landing-title" className="mb-1 text-base font-semibold text-text-primary">
          Choose how you want to start
        </h1>
        <p className="mb-5 text-xs text-text-muted">
          You can switch anytime: each one has its own group in the tab bar.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => choose(section)}
                data-section-card={section.id}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-md border border-border bg-surface p-4 text-left transition-colors',
                  'hover:border-accent/50 hover:bg-accent/5',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                )}
              >
                <Icon size={22} className="text-accent" />
                <span className="text-sm font-medium text-text-primary">{section.label}</span>
                {section.description && (
                  <span className="text-xs text-text-muted">{section.description}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-8 items-center rounded-sm px-3 text-xs text-text-muted hover:text-text-primary"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
