import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { PANELS } from './panels';
import { useExtraPanels } from './extraPanels';
import { useSections, resolveActiveSection } from './sections';

export function PanelTabs() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  const extraPanels = useExtraPanels();
  const { sections, activeSectionId } = useSections();

  const allPanels = [...PANELS, ...extraPanels];
  // With sections registered, show only the active section's panels; with none
  // (Studio) show every panel — byte-identical to before.
  const section = resolveActiveSection(activeSectionId, sections);
  const visiblePanels =
    sections.length > 0 && section
      ? allPanels.filter((p) => section.panelIds.includes(p.id))
      : allPanels;

  return (
    <nav
      // overflow-x-auto — at narrow widths the 9-tab strip would push the
      // body content off-screen and create a 980px-wide scroll context
      // (audit gap #13). Letting the nav itself scroll keeps the body
      // bound to the viewport. `whitespace-nowrap` prevents wrap mid-tab.
      className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border-subtle bg-card px-2"
      aria-label="Top navigation"
      data-tour="panel-nav"
    >
      {visiblePanels.map(({ id, label, icon: Icon }) => {
        const active = activePanel === id;
        return (
          <button
            key={id}
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
      })}
    </nav>
  );
}
