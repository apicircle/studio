import { AppIcon } from './AppIcon';
import { SettingsPicker } from './SettingsPicker';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { cn } from '../primitives/cn';
import { useSections } from './sections';

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

export function TopBar({ brand }: { brand?: BrandDef } = {}) {
  const name = brand?.name ?? 'API Circle Studio';
  const tagline = brand?.tagline === undefined ? 'Built in India. Open to world' : brand.tagline;
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-card px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <AppIcon size={24} className="text-text-secondary" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium leading-none text-text-primary">{name}</span>
            {tagline !== null ? (
              <span className="text-[0.625rem] leading-none text-text-dim">{tagline}</span>
            ) : null}
          </div>
        </div>
        <WorkspaceSwitcher />
        <SettingsPicker />
      </div>

      <div className="flex items-center gap-2">
        <SectionToggle />
      </div>
    </div>
  );
}

/**
 * Segmented Studio ⇄ edition mode toggle. Renders `null` in Studio (no sections
 * registered) so the top bar is byte-identical; appears only when an edition
 * registers >=2 sections. Switching is handled by the edition-agnostic sections
 * seam (App persists the choice per-workspace and moves the active panel).
 */
function SectionToggle() {
  const { sections, activeSectionId, setActiveSectionId } = useSections();
  if (sections.length <= 1) return null;
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-surface p-0.5"
      role="tablist"
      aria-label="Mode"
    >
      {sections.map((section) => {
        const Icon = section.icon;
        const active = section.id === activeSectionId;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-section-toggle={section.id}
            onClick={() => setActiveSectionId(section.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2.5 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
              active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary',
            )}
          >
            <Icon size={14} />
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
