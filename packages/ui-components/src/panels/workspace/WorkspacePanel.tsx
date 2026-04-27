import { GitBranch, KeyRound, ShieldAlert } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';

export function WorkspacePanel() {
  const workspaceName = useWorkspaceStore((s) => s.synced?.workspaceName ?? '');
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const session = useWorkspaceStore((s) => s.local?.sessions.github ?? null);
  const workingBranch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);
  const openSecretVault = useWorkspaceStore((s) => s.openSecretVault);

  const isLocalOnly = session === null;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-medium text-text-primary">Workspace</h1>
        <span
          className={
            isLocalOnly
              ? 'rounded-sm border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted'
              : 'rounded-sm border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-success'
          }
        >
          {isLocalOnly ? 'Local Workspace' : 'GitHub Connected'}
        </span>
      </header>

      <section className="max-w-2xl">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          Identity
        </h2>
        <label htmlFor="workspace-name-input" className="block text-xs text-text-muted">
          Workspace name
        </label>
        <input
          id="workspace-name-input"
          value={workspaceName}
          onChange={(e) => setWorkspaceName(e.target.value)}
          className="mt-1 h-9 w-full rounded-sm border border-border bg-card px-3 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <p className="mt-2 text-xs text-text-dim">
          Persisted to the synced document. Pushed to Git when a working branch is created.
        </p>
      </section>

      <section className="max-w-2xl">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          GitHub Connection
        </h2>

        {isLocalOnly ? (
          <div className="rounded-sm border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-text-primary">
              <ShieldAlert size={14} className="text-amber" />
              No GitHub connection
            </div>
            <p className="mb-3 text-xs text-text-muted">
              You&apos;re working in local-only mode. All changes live in IndexedDB and are never
              pushed anywhere. Connect a GitHub PAT to enable push-to-save and PR creation.
            </p>
            <p className="mb-2 text-xs text-text-muted">
              When you create a token at{' '}
              <span className="text-text-primary">github.com/settings/tokens</span>, grant these
              scopes:
            </p>
            <ul className="mb-4 ml-4 list-disc space-y-0.5 text-xs text-text-muted">
              <li>
                <code className="text-text-primary">repo</code> — read/write workspace.json on the
                working branch
              </li>
              <li>
                <code className="text-text-primary">pull_request</code> — open PRs from working
                branch to base
              </li>
            </ul>
            <button
              type="button"
              onClick={openSecretVault}
              className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent transition-colors hover:bg-accent/20"
            >
              <KeyRound size={14} />
              Connect via Secret Vault → Sessions
            </button>
            <p className="mt-3 text-[11px] text-text-dim">
              Phase 4 wires the connect/auto-branch/push/PR flow.
            </p>
          </div>
        ) : (
          <div className="rounded-sm border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-text-primary">
              <GitBranch size={14} className="text-accent" />
              {session.accountLogin}
            </div>
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
              <dt className="text-text-dim">Repo</dt>
              <dd className="text-text-primary">
                {workingBranch?.repoFullName ?? <em className="text-text-dim">none yet</em>}
              </dd>
              <dt className="text-text-dim">Working branch</dt>
              <dd className="text-text-primary">
                {workingBranch?.name ?? <em className="text-text-dim">none yet</em>}
              </dd>
              <dt className="text-text-dim">Base branch</dt>
              <dd className="text-text-primary">{workingBranch?.baseBranch ?? '—'}</dd>
              <dt className="text-text-dim">Granted scopes</dt>
              <dd className="text-text-primary">
                {session.grantedScopes.length > 0 ? session.grantedScopes.join(', ') : '—'}
              </dd>
              <dt className="text-text-dim">Last verified</dt>
              <dd className="text-text-primary">
                {session.lastVerifiedAt ?? <em className="text-text-dim">never</em>}
              </dd>
            </dl>
            <button
              type="button"
              onClick={openSecretVault}
              className="mt-4 inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <KeyRound size={14} />
              Manage session
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
