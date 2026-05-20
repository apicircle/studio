import { AppIcon } from './AppIcon';
import { SettingsPicker } from './SettingsPicker';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function TopBar() {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-card px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <AppIcon size={24} className="text-text-secondary" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium leading-none text-text-primary">
              API Circle Studio
            </span>
            <span className="text-[0.625rem] leading-none text-text-dim">
              Built in India. Open to world
            </span>
          </div>
        </div>
        <WorkspaceSwitcher />
        <SettingsPicker />
      </div>

      <div className="flex items-center gap-2">{/* Right side reserved for future actions. */}</div>
    </div>
  );
}
