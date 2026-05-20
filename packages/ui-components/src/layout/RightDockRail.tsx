// Persistent vertical rail on the right edge of the body row. Provides
// always-visible entry points to the three workspace inspector tabs
// (Variables / Vault / Assets). Clicking an icon opens the dock as a
// floating overlay (the default) or, if the user previously docked it,
// reopens it in docked mode. Clicking the icon for the active tab a
// second time closes the dock — same toggle semantics the old top-bar
// chips had.
//
// Width is intentionally narrow (40px) — the rail is a tool, not a
// destination. Tooltips on hover label each icon for discoverability.

import { BookOpen, KeyRound, Variable } from 'lucide-react';
import type { RightDockTab } from '../store/workspaceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';

interface RailButton {
  tab: RightDockTab;
  label: string;
  icon: React.ReactNode;
}

const BUTTONS: ReadonlyArray<RailButton> = [
  { tab: 'variables', label: 'Variables', icon: <Variable size={16} aria-hidden="true" /> },
  { tab: 'vault', label: 'Secret Vault', icon: <KeyRound size={16} aria-hidden="true" /> },
  { tab: 'assets', label: 'Global Assets', icon: <BookOpen size={16} aria-hidden="true" /> },
];

export function RightDockRail() {
  const activeTab = useWorkspaceStore((s) => s.rightDock.tab);
  const toggle = useWorkspaceStore((s) => s.toggleRightDockTab);

  return (
    <nav
      aria-label="Workspace inspector rail"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border-subtle bg-card py-2"
    >
      {BUTTONS.map((b) => {
        const active = activeTab === b.tab;
        return (
          <button
            key={b.tab}
            type="button"
            data-tour={`dock-${b.tab}`}
            onClick={() => toggle(b.tab)}
            aria-label={`${active ? 'Close' : 'Open'} ${b.label}`}
            aria-pressed={active}
            title={b.label}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-sm border transition-colors',
              active
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
            )}
          >
            {b.icon}
          </button>
        );
      })}
    </nav>
  );
}
