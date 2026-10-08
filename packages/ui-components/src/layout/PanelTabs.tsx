import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Button } from '../primitives/Button';
import { cn } from '../primitives/cn';
import { Z } from '../primitives/floating';
import { Tooltip } from '../primitives/Tooltip';
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

  return (
    <ModeGroups
      tabs={tabs}
      sections={sections}
      activeSectionId={activeSectionId}
      onOpen={setActiveSectionId}
    />
  );
}

/**
 * Two or more sections: the tabs every mode shares, then one group per mode.
 * The active mode's group is unfolded to its own tabs; the others are folded
 * to their header. A shared tab is set off from the groups by a divider, so it
 * reads as belonging to the workspace rather than to the mode on screen.
 *
 * A press of a header, by where it is pressed from:
 *
 * - **another mode's**: open that mode — App moves to the panel it was left
 *   on, and its group unfolds while this one folds;
 * - **the active mode's, from one of its own tabs**: fold its tabs back into
 *   the header. The mode and the panel on screen stay as they are, and the
 *   next press brings the tabs back;
 * - **the active mode's, from a shared tab**: open the mode on the panel it was
 *   left on, as the press would from the other mode.
 */
function ModeGroups({
  tabs,
  sections,
  activeSectionId,
  onOpen,
}: {
  tabs: readonly VisibleTab[];
  sections: readonly SectionDef[];
  activeSectionId: string;
  onOpen: (sectionId: string) => void;
}) {
  const shared = tabs.filter((tab) => tab.shared);
  const own = tabs.filter((tab) => !tab.shared);
  const activeId = resolveActiveSection(activeSectionId, sections)?.id;
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const onOwnTab = own.some((tab) => tab.id === activePanel);

  // The mode and panel the active mode's tabs were folded away on. Folding
  // clears the strip; it must never hide where a move has landed, so it holds
  // only while neither changes: a panel opened any other way (a shortcut, a
  // link in a panel, the other mode's header) shows the tabs again, and coming
  // back to the same panel later does not fold them a second time.
  const [foldedAt, setFoldedAt] = useState<{ sectionId: string; panelId: string } | null>(null);
  const folded =
    foldedAt !== null && foldedAt.sectionId === activeId && foldedAt.panelId === activePanel;
  if (foldedAt !== null && !folded) setFoldedAt(null);

  return (
    <nav className={NAV_CLASS} aria-label="Top navigation" data-tour="panel-nav">
      {shared.map((tab) => (
        <PanelTab key={tab.id} tab={tab} />
      ))}
      {shared.length > 0 ? (
        <span aria-hidden="true" data-tab-divider="" className="mx-1 h-4 w-px shrink-0 bg-border" />
      ) : null}
      {sections.map((section) => {
        const active = section.id === activeId;
        return (
          <SectionGroup
            key={section.id}
            section={section}
            active={active}
            folded={active && folded}
            onOwnTab={active && onOwnTab}
            tabs={own}
            onPress={() => {
              if (active && folded) setFoldedAt(null);
              else if (active && onOwnTab)
                setFoldedAt({ sectionId: section.id, panelId: activePanel });
              else onOpen(section.id);
            }}
          />
        );
      })}
    </nav>
  );
}

/** The id of the element holding a section's own tabs, for `aria-controls`. */
function groupId(sectionId: string): string {
  return `panel-tabs-section-${sectionId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * One mode in the strip: a header that names it and, while it is the active
 * mode and not folded, its own tabs beside the header. The header is a
 * disclosure button (`aria-expanded`), not a tab: what it shows and hides is a
 * run of tabs, on the same line.
 *
 * The header is drawn as a button in every state, because it is one in every
 * state, and its chevron points the way a press moves the tabs: right while
 * they are folded (they open out to the right), left while they are showing
 * (they fold back into the header). It is one chevron that turns, so the eye
 * follows the change instead of finding a different icon.
 *
 * - **Unfolded**: a neutral handle at the head of the bordered run. The accent
 *   stays with the tab on screen, so there is still one "you are here".
 * - **Another mode's, folded**: the app's ordinary outlined button.
 * - **The active mode's, folded**: the accent the hidden tab would carry, and
 *   `aria-current` — the header now stands for the page on screen.
 */
function SectionGroup({
  section,
  active,
  folded,
  onOwnTab,
  tabs,
  onPress,
}: {
  section: SectionDef;
  /** The mode on screen. */
  active: boolean;
  /** The active mode with its tabs folded away by a press of its header. */
  folded: boolean;
  /** The active mode with one of its own tabs on screen. */
  onOwnTab: boolean;
  /** The active section's own tabs; rendered only by the group that is unfolded. */
  tabs: readonly VisibleTab[];
  onPress: () => void;
}) {
  const Icon = section.icon;
  // A mode whose every panel is shared has no tabs of its own to unfold.
  const unfolded = active && !folded && tabs.length > 0;
  // The header alone, standing for the mode on screen.
  const current = active && !unfolded;
  return (
    <div
      data-section-group={section.id}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1 rounded-md border px-0.5',
        // The unfolded group is one bordered run, header and tabs together, so
        // which tabs belong to which mode never has to be worked out.
        unfolded
          ? 'border-border-subtle bg-surface'
          : // A folded mode is one header, and it must stay in reach: in a window
            // too narrow for the unfolded run the strip scrolls sideways, and the
            // header that leads to the other mode would scroll out of it. Pinned
            // to whichever edge it would cross, over the tabs that pass under it.
            cn('sticky left-0 right-0 border-transparent bg-card', Z.paneSticky),
      )}
    >
      <Tooltip
        side="bottom"
        content={
          folded
            ? `Show ${section.label} tabs`
            : unfolded && onOwnTab
              ? `Hide ${section.label} tabs`
              : `Open ${section.label}`
        }
      >
        <Button
          data-section-toggle={section.id}
          aria-expanded={active && !folded}
          aria-controls={unfolded ? groupId(section.id) : undefined}
          aria-current={current ? 'true' : undefined}
          onClick={onPress}
          variant={current ? 'primary' : 'ghost'}
          leftIcon={<Icon size={14} aria-hidden="true" className="shrink-0 text-accent" />}
          rightIcon={
            <ChevronRight
              size={14}
              aria-hidden="true"
              data-section-chevron=""
              className={cn(
                'shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
                // A nudge the way a press will move the tabs.
                unfolded
                  ? 'rotate-180 group-hover/mode:-translate-x-0.5'
                  : 'group-hover/mode:translate-x-0.5',
                current ? 'text-accent' : 'text-text-muted group-hover/mode:text-accent',
              )}
            />
          }
          className={cn(
            'group/mode px-2 font-semibold active:bg-accent/30',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-card',
            // Both neutral states carry the same strong outline: it is what
            // says "a mode switch" apart from the tabs, which have none.
            !current && 'border-border-strong hover:bg-accent/10',
            unfolded && 'bg-card text-text-primary',
          )}
        >
          {section.label}
        </Button>
      </Tooltip>
      {unfolded ? (
        <div
          id={groupId(section.id)}
          role="group"
          aria-label={`${section.label} panels`}
          // The tabs open out of the header instead of appearing beside it: the
          // one column grows from nothing to their width as they fade in, and
          // whatever follows in the strip is pushed along rather than jumping.
          // `@starting-style` is where a just-mounted element transitions from;
          // an engine without it draws the tabs in place, as before.
          className={cn(
            'grid grid-cols-[1fr] transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none',
            '[@starting-style]:grid-cols-[0fr] [@starting-style]:opacity-0',
          )}
        >
          {/* Clipped while the column grows. The padding, cancelled by the
              margin, keeps a tab's focus ring inside the clip. */}
          <div className="-m-1 flex min-w-0 items-center gap-1 overflow-hidden p-1">
            {tabs.map((tab) => (
              <PanelTab key={tab.id} tab={tab} />
            ))}
          </div>
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
