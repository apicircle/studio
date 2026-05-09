// Right-side dock — workspace inspector tabs (Variables / Vault /
// Assets). The dock is rendered inline in the main shell's horizontal
// PanelGroup so the user can drag its width; persistence is handled by
// `react-resizable-panels` via the parent's `autoSaveId`. When no tab is
// active (`rightDock.tab === null`) the parent skips rendering the
// dock's Panel entirely so the editor reclaims the full row.

import { useEffect, useRef, type ReactNode } from 'react';
import { BookOpen, KeyRound, PanelRightClose, PanelRightOpen, Variable, X } from 'lucide-react';
import type { RightDockTab } from '../store/workspaceStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { VariablesDockPanel } from './dock/VariablesDockPanel';
import { SecretVaultDockPanel } from './dock/SecretVaultDockPanel';
import { GlobalAssetsDockPanel } from './dock/GlobalAssetsDockPanel';

interface TabDef {
  id: RightDockTab;
  label: string;
  icon: ReactNode;
  ariaLabel: string;
}

const TABS: ReadonlyArray<TabDef> = [
  {
    id: 'variables',
    label: 'Variables',
    icon: <Variable size={13} aria-hidden="true" />,
    ariaLabel: 'Show variables tab',
  },
  {
    id: 'vault',
    label: 'Vault',
    icon: <KeyRound size={13} aria-hidden="true" />,
    ariaLabel: 'Show secret vault tab',
  },
  {
    id: 'assets',
    label: 'Assets',
    icon: <BookOpen size={13} aria-hidden="true" />,
    ariaLabel: 'Show global assets tab',
  },
];

export function RightDock() {
  const tab = useWorkspaceStore((s) => s.rightDock.tab);
  const mode = useWorkspaceStore((s) => s.rightDock.mode);
  const setTab = useWorkspaceStore((s) => s.setRightDockTab);
  const setMode = useWorkspaceStore((s) => s.setRightDockMode);
  const closeDock = useWorkspaceStore((s) => s.closeRightDock);
  const dockRef = useRef<HTMLElement | null>(null);

  // Overlay-mode dismiss-on-outside-click. Docked mode stays put — it's
  // part of the layout, not a popover. The rail is excluded so the
  // toggle-tab buttons keep their existing semantics; clicks inside the
  // dock itself (interacting with vault rows, schema editor, etc.) also
  // shouldn't dismiss. We listen on `pointerdown` so dismissal happens
  // before any click handlers on the target run.
  useEffect(() => {
    if (mode !== 'overlay' || tab === null) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (dockRef.current?.contains(target)) return;
      const rail = document.querySelector('nav[aria-label="Workspace inspector rail"]');
      if (rail?.contains(target)) return;
      closeDock();
    };
    // Defer one tick so the same pointerdown that opened the overlay
    // (e.g. clicking the rail icon) doesn't immediately close it.
    const handle = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointer);
    }, 0);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [mode, tab, closeDock]);

  // The parent layout chooses not to render the dock at all when tab is
  // null. Defensive null-guard keeps the component safe if called
  // unconditionally — simpler test surface.
  if (tab === null) return null;

  // `w-full` makes the dock fill its container in both modes:
  // - Docked: container is a `Panel` from react-resizable-panels with
  //   explicit width, so 100% = that width.
  // - Overlay: container is the absolutely-positioned 400px wrapper in
  //   App.tsx, so 100% = 400px.
  // Overlay also gets a drop shadow to read as floating; docked is flush.
  const surfaceClass =
    mode === 'overlay'
      ? 'flex h-full min-h-0 w-full flex-col border-l border-border bg-surface shadow-elevated'
      : 'flex h-full min-h-0 w-full flex-col border-l border-border bg-surface';

  return (
    <aside
      ref={dockRef}
      role="complementary"
      aria-label="Workspace inspector"
      className={surfaceClass}
    >
      <div className="flex h-9 shrink-0 items-stretch border-b border-border-subtle bg-card">
        <div role="tablist" aria-label="Workspace inspector tabs" className="flex flex-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`right-dock-panel-${t.id}`}
              id={`right-dock-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex h-full items-center gap-1.5 border-b-2 px-3 text-[11px] transition-colors',
                tab === t.id
                  ? 'border-accent bg-surface text-text-primary'
                  : 'border-transparent text-text-muted hover:bg-surface hover:text-text-primary',
              )}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMode(mode === 'overlay' ? 'docked' : 'overlay')}
          aria-label={mode === 'overlay' ? 'Dock to side panel' : 'Float as overlay'}
          aria-pressed={mode === 'docked'}
          title={
            mode === 'overlay'
              ? 'Dock — pin to the side and reclaim layout space'
              : 'Float — release back to overlay'
          }
          className="inline-flex h-full w-9 items-center justify-center text-text-muted hover:bg-surface hover:text-text-primary"
        >
          {mode === 'overlay' ? (
            <PanelRightOpen size={14} aria-hidden="true" />
          ) : (
            <PanelRightClose size={14} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={closeDock}
          aria-label="Close workspace inspector"
          title="Close (the right-edge rail re-opens it)"
          className="inline-flex h-full w-9 items-center justify-center text-text-muted hover:bg-surface hover:text-text-primary"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div
        role="tabpanel"
        id={`right-dock-panel-${tab}`}
        aria-labelledby={`right-dock-tab-${tab}`}
        className="min-h-0 flex-1"
      >
        {tab === 'variables' ? (
          <VariablesDockPanel />
        ) : tab === 'vault' ? (
          <SecretVaultDockPanel />
        ) : (
          <GlobalAssetsDockPanel />
        )}
      </div>
    </aside>
  );
}
