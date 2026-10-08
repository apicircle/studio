import { ChevronDown, ChevronRight } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { Z } from '../primitives/floating';
import { resolveActiveSection, useSections, type SectionDef } from './sections';
import { useVisibleTabs, type VisibleTab } from './visibleTabs';

const NAV_CLASS =
  // overflow-x-auto — at narrow widths the 9-tab strip would push the
  // body content off-screen and create a 980px-wide scroll context
  // (audit gap #13). Letting the nav itself scroll keeps the body
  // bound to the viewport. `whitespace-nowrap` prevents wrap mid-tab.
  'flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border-subtle bg-card px-2';

export function PanelTabs() {
  // With sections registered, the panels every mode shares and then the active
  // section's own; with none (Studio) every panel — byte-identical to before.
  const tabs = useVisibleTabs();
  const { sections, activeSectionId, setActiveSectionId } = useSections();

  // Studio, and an edition with a single section: one flat run of tabs.
  if (sections.length <= 1) {
    return (
      <nav className={NAV_CLASS} aria-label="Top navigation" data-tour="panel-nav">
        {tabs.map((tab) => (
          <PanelTab key={tab.id} tab={tab} />
        ))}
      </nav>
    );
  }

  // Two or more sections: the tabs every mode shares, then one group per mode.
  // The active mode's group is unfolded to its own tabs; the others are folded
  // to their header. A shared tab is set off from the groups by a divider, so it
  // reads as belonging to the workspace rather than to the mode on screen.
  const shared = tabs.filter((tab) => tab.shared);
  const own = tabs.filter((tab) => !tab.shared);
  const active = resolveActiveSection(activeSectionId, sections);
  return (
    <nav className={NAV_CLASS} aria-label="Top navigation" data-tour="panel-nav">
      {shared.map((tab) => (
        <PanelTab key={tab.id} tab={tab} />
      ))}
      {shared.length > 0 ? (
        <span aria-hidden="true" data-tab-divider="" className="mx-1 h-4 w-px shrink-0 bg-border" />
      ) : null}
      {sections.map((section) => (
        <SectionGroup
          key={section.id}
          section={section}
          expanded={section.id === active?.id}
          tabs={own}
          onOpen={() => setActiveSectionId(section.id)}
        />
      ))}
    </nav>
  );
}

/** The id of the element holding a section's own tabs, for `aria-controls`. */
function groupId(sectionId: string): string {
  return `panel-tabs-section-${sectionId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * One mode in the strip: a header that names it and, while it is the active
 * mode, its own tabs beside the header. Pressing the header opens the mode —
 * App moves to the panel it was left on, and the other groups fold. The header
 * is a disclosure button (`aria-expanded`), not a tab: what it shows and hides
 * is a run of tabs, on the same line.
 */
function SectionGroup({
  section,
  expanded,
  tabs,
  onOpen,
}: {
  section: SectionDef;
  expanded: boolean;
  /** The active section's own tabs; rendered only by the group that is unfolded. */
  tabs: readonly VisibleTab[];
  onOpen: () => void;
}) {
  const Icon = section.icon;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // A mode whose every panel is shared has no tabs of its own to unfold.
  const unfolded = expanded && tabs.length > 0;
  return (
    <div
      data-section-group={section.id}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1 rounded-md border px-0.5',
        // The unfolded group is one bordered run, header and tabs together, so
        // which tabs belong to which mode never has to be worked out.
        expanded
          ? 'border-border-subtle bg-surface'
          : // A folded mode is one header, and it must stay in reach: in a window
            // too narrow for the unfolded run the strip scrolls sideways, and the
            // header that leads to the other mode would scroll out of it. Pinned
            // to whichever edge it would cross, over the tabs that pass under it.
            cn('sticky left-0 right-0 border-transparent bg-card', Z.paneSticky),
      )}
    >
      <button
        type="button"
        data-section-toggle={section.id}
        aria-expanded={expanded}
        aria-controls={unfolded ? groupId(section.id) : undefined}
        onClick={onOpen}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-card',
          expanded
            ? 'text-text-primary'
            : 'text-text-muted hover:bg-surface hover:text-text-primary',
        )}
      >
        <Icon size={14} aria-hidden="true" />
        {section.label}
        <Chevron size={12} aria-hidden="true" className="text-text-dim" />
      </button>
      {unfolded ? (
        <div
          id={groupId(section.id)}
          role="group"
          aria-label={`${section.label} panels`}
          className="flex items-center gap-1"
        >
          {tabs.map((tab) => (
            <PanelTab key={tab.id} tab={tab} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PanelTab({ tab }: { tab: VisibleTab }) {
  const { id, label, icon: Icon } = tab;
  const active = useWorkspaceStore((s) => s.activePanel === id);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  return (
    <button
      type="button"
      data-tour={`nav-${id}`}
      onClick={() => setActivePanel(id)}
      // Always-visible focus ring — themes can override `accent`,
      // so we use accent at high opacity to remain visible on every
      // theme palette (audit gap A17).
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-sm px-3 text-xs font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-card',
        active
          ? 'bg-accent/15 text-accent border border-accent/40'
          : 'text-text-muted hover:text-text-primary hover:bg-surface border border-transparent',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
