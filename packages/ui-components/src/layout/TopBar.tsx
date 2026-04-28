import { BookOpen, KeyRound, Orbit } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ThemePicker } from './ThemePicker';
import { FontPicker } from './FontPicker';

export function TopBar() {
  const openSecretVault = useWorkspaceStore((s) => s.openSecretVault);
  const openGlobalAssets = useWorkspaceStore((s) => s.openGlobalAssets);
  const workspaceName = useWorkspaceStore((s) => s.synced?.workspaceName ?? '');

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-card px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Orbit size={18} className="text-accent" aria-hidden="true" />
          <span className="text-sm font-medium text-text-primary">API Circle Studio</span>
        </div>
        {workspaceName && (
          <span className="hidden text-xs text-text-dim sm:inline">/ {workspaceName}</span>
        )}
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
      </div>

      <div className="flex items-center gap-2">
        <FontPicker />
        <ThemePicker />
      </div>
    </div>
  );
}
