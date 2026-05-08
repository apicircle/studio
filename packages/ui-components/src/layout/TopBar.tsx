import { BookOpen, KeyRound, Orbit } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useActiveVariableScope } from '../editors/useVariableScope';
import { VariableHints } from '../editors/VariableHints';
import { ThemePicker } from './ThemePicker';
import { FontPicker } from './FontPicker';
import { SettingsPicker } from './SettingsPicker';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function TopBar() {
  const openSecretVault = useWorkspaceStore((s) => s.openSecretVault);
  const openGlobalAssets = useWorkspaceStore((s) => s.openGlobalAssets);
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const variableScope = useActiveVariableScope();
  // The trigger label nudges the user toward what they'll see: editor scope
  // is request-bound, plan scope is layered by the active plan's env order.
  const variableTriggerLabel = activePanel === 'execution' ? 'Plan variables' : 'Variables';

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-card px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Orbit size={18} className="text-accent" aria-hidden="true" />
          <span className="text-sm font-medium text-text-primary">API Circle Studio</span>
        </div>
        <WorkspaceSwitcher />
        <div className="ml-2 h-5 w-px bg-border-subtle" aria-hidden="true" />
        <button
          type="button"
          onClick={openSecretVault}
          className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
          aria-label="Open Secret Vault"
        >
          <KeyRound size={14} />
          Secret Vault
        </button>
        <button
          type="button"
          onClick={openGlobalAssets}
          className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
          aria-label="Open Global Assets library"
        >
          <BookOpen size={14} />
          Global Assets
        </button>
        <VariableHints scope={variableScope} triggerLabel={variableTriggerLabel} />
      </div>

      <div className="flex items-center gap-2">
        <SettingsPicker />
        <FontPicker />
        <ThemePicker />
      </div>
    </div>
  );
}
