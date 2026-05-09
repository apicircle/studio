import { Orbit } from 'lucide-react';
import { SettingsPicker } from './SettingsPicker';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function TopBar() {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-card px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Orbit size={18} className="text-accent" aria-hidden="true" />
          <span className="text-sm font-medium text-text-primary">API Circle Studio</span>
        </div>
        <WorkspaceSwitcher />
        <SettingsPicker />
      </div>

      <div className="flex items-center gap-2">{/* Right side reserved for future actions. */}</div>
    </div>
  );
}
