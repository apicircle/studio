import type { ReactNode } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { Tooltip } from '../primitives/Tooltip';
import { AppIcon } from './AppIcon';
import { TOP_BAR_PANELS, type PanelDef } from './panels';
import { SettingsPicker } from './SettingsPicker';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * The header brand. An additive seam (no-op in Studio): omit it and the top bar is
 * byte-identical — "API Circle Studio" + the tagline. An edition can override the
 * product `name` (e.g. the umbrella "API Circle") and, via `tagline: null`, drop the
 * sub-line. Leaving `tagline` undefined keeps Studio's default tagline.
 */
export interface BrandDef {
  name: string;
  tagline?: string | null;
}

export function TopBar({
  brand,
  workspaceStatus,
  topBarEnd,
}: {
  brand?: BrandDef;
  /**
   * Shown beside the workspace switcher — the workspace's status at a glance,
   * such as `WorkspaceStatusChip`. An additive seam: Studio passes nothing and
   * the top bar renders exactly as before.
   */
  workspaceStatus?: ReactNode;
  /**
   * Shown at the far end of the bar, after Help — an edition's account menu.
   * An additive seam: Studio passes nothing, and Help is then the last thing in
   * the bar.
   */
  topBarEnd?: ReactNode;
} = {}) {
  const name = brand?.name ?? 'API Circle Studio';
  const tagline = brand?.tagline === undefined ? 'Built in India. Open to world' : brand.tagline;
  // The bar holds what belongs to the whole app. At its start: the brand, the
  // workspace and its settings. At its far end: what is reached from anywhere
  // and is no stage of the work — help, then whatever an edition adds there.
  // Which mode is on screen is a navigation question, so an edition's modes are
  // groups in the tab strip below (`PanelTabs`), not a switch up here.
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-border-subtle bg-card px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <AppIcon size={24} className="text-text-primary" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium leading-none text-text-primary">{name}</span>
            {tagline !== null ? (
              <span className="text-[0.625rem] leading-none text-text-dim">{tagline}</span>
            ) : null}
          </div>
        </div>
        <WorkspaceSwitcher />
        {workspaceStatus}
        <SettingsPicker />
      </div>
      <div data-top-bar-end="" className="ml-auto flex shrink-0 items-center gap-1 pl-3">
        {TOP_BAR_PANELS.map((panel) => (
          <TopBarPanelButton key={panel.id} panel={panel} />
        ))}
        {topBarEnd}
      </div>
    </div>
  );
}

/**
 * The way in to a panel that is not a tab (`PanelDef.topBar`): an icon alone,
 * named by the panel's label. It opens the same panel a tab would, and carries
 * `aria-current` while that panel is the one on screen — no tab does then.
 */
function TopBarPanelButton({ panel }: { panel: PanelDef }) {
  const { id, label, icon: Icon } = panel;
  const active = useWorkspaceStore((s) => s.activePanel === id);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  return (
    <Tooltip content={`Open the ${label}`} side="bottom" align="end">
      <button
        type="button"
        // The same hook a tab carries, so the onboarding tour finds its target
        // wherever a panel's entry is.
        data-tour={`nav-${id}`}
        onClick={() => setActivePanel(id)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-sm border transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
          active
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
        )}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
