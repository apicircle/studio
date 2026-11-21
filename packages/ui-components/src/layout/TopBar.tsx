import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { LENS_URL } from '../primitives/externalLinks';
import { Tooltip } from '../primitives/Tooltip';
import { AppIcon } from './AppIcon';
import { TOP_BAR_PANELS, type PanelDef } from './panels';
import { SettingsPicker } from './SettingsPicker';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * The header brand. Omit it and the top bar shows the product's name, "API
 * Circle", with Studio's tagline under it. An edition can override the `name`
 * and, via `tagline: null`, drop the sub-line. Leaving `tagline` undefined keeps
 * Studio's default tagline.
 */
export interface BrandDef {
  name: string;
  tagline?: string | null;
}

export function TopBar({
  brand,
  lensLink = false,
  workspaceStatus,
  topBarEnd,
  settingsCommunity = true,
}: {
  brand?: BrandDef;
  /**
   * Whether the far end of the bar starts with a "Lens" link to the website's
   * page about the paid Lens features, opened in a new tab. The standalone app
   * turns it on; an edition that already is Lens leaves it out, and the bar is
   * then exactly as before.
   */
  lensLink?: boolean;
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
  /**
   * Whether the Settings popover ends with Studio's Community section. An
   * additive seam: Studio passes nothing and the section is there.
   */
  settingsCommunity?: boolean;
} = {}) {
  const name = brand?.name ?? 'API Circle';
  const tagline = brand?.tagline === undefined ? 'Built in India. Open to world' : brand.tagline;
  // The bar holds what belongs to the whole app. At its start: the brand, the
  // workspace and its settings. At its far end: what is reached from anywhere
  // and is no stage of the work — the way out to Lens's page (standalone app
  // only), help, then whatever an edition adds there.
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
        <SettingsPicker community={settingsCommunity} />
      </div>
      <div data-top-bar-end="" className="ml-auto flex shrink-0 items-center gap-1 pl-3">
        {lensLink ? <LensLink /> : null}
        {TOP_BAR_PANELS.map((panel) => (
          <TopBarPanelButton key={panel.id} panel={panel} />
        ))}
        {topBarEnd}
      </div>
    </div>
  );
}

/**
 * "Lens": the way out to the website's page about the paid Lens features. A
 * link, not a panel — it opens a new tab on the web, and the desktop shell hands
 * a new-window link to the system browser. Its name is the word on it; the
 * screen-reader suffix and the tooltip say where it goes.
 *
 * Every colour is one that reads on all of the app's themes, measured by
 * `apps/web/src/__tests__/theme-contrast.test.ts`: the label is `text-primary`
 * on its own `surface` fill, its edge and fill stand off the bar, the hover
 * label is the accent's generated readable foreground (`accent-fg`, never the
 * bare accent, which is under 2:1 on Ayu Light), and so is the focus ring.
 */
function LensLink() {
  return (
    <Tooltip content="What Lens adds, on apicircle.dev" side="bottom" align="end">
      <a
        href={LENS_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-lens-link=""
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 text-xs font-medium text-text-primary transition-colors',
          'hover:border-accent/40 hover:bg-accent/10 hover:text-accent-fg',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg',
        )}
      >
        Lens
        <ExternalLink size={12} aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Tooltip>
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
          // Tone-coloured parts take the accent's generated readable colour
          // (`accent-fg`): the bare accent is under 3:1 on its own tint on five
          // themes, and a ring at 70% of it is under 3:1 against the bar on 23.
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg',
          active
            ? 'border-accent/40 bg-accent/10 text-accent-fg'
            : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
        )}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
