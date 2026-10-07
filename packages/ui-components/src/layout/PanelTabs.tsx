import { Fragment } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { useVisibleTabs } from './visibleTabs';

export function PanelTabs() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  // With sections registered, only the active section's panels; with none
  // (Studio) every panel — byte-identical to before.
  const tabs = useVisibleTabs();

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
      {tabs.map(({ id, label, icon: Icon, shared }, index) => {
        const active = activePanel === id;
        // A tab every mode keeps is set off from the ones that change with the
        // mode, so it reads as belonging to the workspace rather than to the
        // mode on screen. Studio registers no sections, so nothing is shared
        // and no divider renders.
        const next = tabs[index + 1];
        const endsSharedRun = shared && next !== undefined && !next.shared;
        return (
          <Fragment key={id}>
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
            {endsSharedRun ? (
              <span
                aria-hidden="true"
                data-tab-divider=""
                className="mx-1 h-4 w-px shrink-0 bg-border"
              />
            ) : null}
          </Fragment>
        );
      })}
    </nav>
  );
}
