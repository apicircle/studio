import { useWorkspaceStore } from '../../store/workspaceStore';
import { ALL_THEMES } from '../../theme/applyTheme';
import { cn } from '../../primitives/cn';

export function SettingsPanel() {
  const themeId = useWorkspaceStore((s) => s.local?.ui.themeId ?? 'studio-dark');
  const setThemeId = useWorkspaceStore((s) => s.setThemeId);
  const workspaceName = useWorkspaceStore((s) => s.synced?.workspaceName ?? '');
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-medium text-text-primary">Settings</h1>
        <span className="rounded-sm border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">
          Live
        </span>
      </header>

      <section className="max-w-xl">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          Workspace
        </h2>
        <label className="block text-xs text-text-muted">Name</label>
        <input
          value={workspaceName}
          onChange={(e) => setWorkspaceName(e.target.value)}
          className="mt-1 h-9 w-full rounded-sm border border-border bg-card px-3 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <p className="mt-2 text-xs text-text-dim">
          Persisted to the synced document. Will be pushed to Git when a working branch is created.
        </p>
      </section>

      <section className="max-w-xl">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">Theme</h2>
        <div className="grid grid-cols-2 gap-2">
          {ALL_THEMES.map((theme) => {
            const active = theme.id === themeId;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setThemeId(theme.id)}
                className={cn(
                  'flex items-center justify-between rounded-sm border px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'border-accent bg-accent/10 text-text-primary'
                    : 'border-border bg-card text-text-muted hover:border-border-strong hover:text-text-primary',
                )}
              >
                <span>{theme.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-text-dim">
                  {theme.mode}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-text-dim">
          Theme persists in localStorage and reapplies on next boot.
        </p>
      </section>

      <section className="max-w-xl">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          Secret Vault
        </h2>
        <div className="rounded-sm border border-dashed border-border-subtle p-3 text-xs text-text-dim">
          GitHub tokens and encrypted environment variables will live here in Phase 3.
        </div>
      </section>
    </div>
  );
}
