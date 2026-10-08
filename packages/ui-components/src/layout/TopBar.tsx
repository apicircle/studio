import type { ReactNode } from 'react';
import { AppIcon } from './AppIcon';
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
}: {
  brand?: BrandDef;
  /**
   * Shown beside the workspace switcher — the workspace's status at a glance,
   * such as `WorkspaceStatusChip`. An additive seam: Studio passes nothing and
   * the top bar renders exactly as before.
   */
  workspaceStatus?: ReactNode;
} = {}) {
  const name = brand?.name ?? 'API Circle Studio';
  const tagline = brand?.tagline === undefined ? 'Built in India. Open to world' : brand.tagline;
  // The bar holds what belongs to the whole app: the brand, the workspace and
  // its settings. Which mode is on screen is a navigation question, so an
  // edition's modes are groups in the tab strip below (`PanelTabs`), not a
  // switch up here.
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
    </div>
  );
}
