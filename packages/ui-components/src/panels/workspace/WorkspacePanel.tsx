import { useState } from 'react';
import { GitBranch, GitMerge, KeyRound, Lock, Plus, ShieldAlert, X } from 'lucide-react';
import { GitHubError, MissingScopeError } from '@apicircle-v2/git';
import { generateWorkingBranchName, validateBranchName } from '@apicircle-v2/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';

export function WorkspacePanel() {
  const workspaceName = useWorkspaceStore((s) => s.synced?.workspaceName ?? '');
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const session = useWorkspaceStore((s) => s.local?.sessions.github ?? null);
  const connectedRepo = useWorkspaceStore((s) => s.local?.connectedRepo ?? null);
  const workingBranch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);

  const isLocalOnly = session === null;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-medium text-text-primary">Workspace</h1>
        <StateBadge
          isLocalOnly={isLocalOnly}
          hasRepo={!!connectedRepo}
          hasBranch={!!workingBranch}
        />
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
        {isLocalOnly ? <NoSessionCard /> : <SessionCard />}
      </section>

      {!isLocalOnly && (
        <section className="max-w-2xl">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
            Repo &amp; Working Branch
          </h2>
          {!connectedRepo ? <ConnectRepoForm /> : <RepoCard />}
        </section>
      )}

      <p className="max-w-2xl text-[11px] text-text-dim">
        Push to save, refresh, and PR creation arrive in the next P4 slices. The session, repo, and
        working-branch state above is what those flows will operate on.
      </p>
    </div>
  );
}

function StateBadge({
  isLocalOnly,
  hasRepo,
  hasBranch,
}: {
  isLocalOnly: boolean;
  hasRepo: boolean;
  hasBranch: boolean;
}) {
  let label: string;
  let className: string;
  if (isLocalOnly) {
    label = 'Local Workspace';
    className = 'border-border bg-card text-text-muted';
  } else if (hasBranch) {
    label = 'Branch ready';
    className = 'border-success/40 bg-success/10 text-success';
  } else if (hasRepo) {
    label = 'Repo connected';
    className = 'border-accent/40 bg-accent/10 text-accent';
  } else {
    label = 'GitHub Connected';
    className = 'border-success/40 bg-success/10 text-success';
  }
  return (
    <span
      className={cn(
        'rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wider',
        className,
      )}
    >
      {label}
    </span>
  );
}

function NoSessionCard() {
  const openSecretVault = useWorkspaceStore((s) => s.openSecretVault);
  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-text-primary">
        <ShieldAlert size={14} className="text-amber" />
        No GitHub connection
      </div>
      <p className="mb-3 text-xs text-text-muted">
        You&apos;re working in local-only mode. All changes live in IndexedDB and are never pushed
        anywhere. Connect a GitHub PAT to enable push-to-save and PR creation.
      </p>
      <p className="mb-2 text-xs text-text-muted">Required scopes when creating the PAT:</p>
      <ul className="mb-4 ml-4 list-disc space-y-0.5 text-xs text-text-muted">
        <li>
          <code className="text-text-primary">repo</code> — read/write workspace.json on the working
          branch
        </li>
        <li>
          <code className="text-text-primary">pull_request</code> — open PRs from working branch to
          base
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
    </div>
  );
}

function SessionCard() {
  const session = useWorkspaceStore((s) => s.local!.sessions.github!);
  const openSecretVault = useWorkspaceStore((s) => s.openSecretVault);
  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-text-primary">
        <GitBranch size={14} className="text-accent" />
        {session.accountLogin}
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
        <dt className="text-text-dim">Granted scopes</dt>
        <dd className="text-text-primary">
          {session.grantedScopes.length > 0 ? session.grantedScopes.join(', ') : '—'}
        </dd>
        <dt className="text-text-dim">Last verified</dt>
        <dd className="text-text-primary">
          {session.lastVerifiedAt ? (
            new Date(session.lastVerifiedAt).toLocaleString()
          ) : (
            <em className="text-text-dim">never</em>
          )}
        </dd>
      </dl>
      {!session.grantedScopes.includes('pull_request') && (
        <p className="mt-3 rounded-sm border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
          Token does not include the <code>pull_request</code> scope. Push will work; PR creation
          from the app will fail until the token is updated.
        </p>
      )}
      <button
        type="button"
        onClick={openSecretVault}
        className="mt-4 inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
      >
        <KeyRound size={14} />
        Manage session
      </button>
    </div>
  );
}

function ConnectRepoForm() {
  const connectRepo = useWorkspaceStore((s) => s.connectRepo);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Enter `owner/name`');
      return;
    }
    const [owner, name, ...rest] = trimmed.split('/');
    if (!owner || !name || rest.length > 0) {
      setError('Format must be `owner/name`');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await connectRepo(owner, name);
      setValue('');
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`Token is missing scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof GitHubError && err.status === 404) {
        setError(`Repo \`${trimmed}\` not found, or your token can't see it.`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to connect — unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-4">
      <label htmlFor="repo-fullname-input" className="block text-xs text-text-muted">
        Connect a repo on GitHub
      </label>
      <div className="flex gap-2">
        <input
          id="repo-fullname-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="owner/name"
          aria-label="Repo full name"
          className="h-8 flex-1 rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) void submit();
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !value.trim()}
          className="inline-flex h-8 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {submitting ? 'Verifying…' : 'Connect repo'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <p className="text-[11px] text-text-dim">
        We call <code>GET /repos/&lt;owner&gt;/&lt;name&gt;</code> with your stored PAT to validate
        access and read the default branch. Nothing is written.
      </p>
    </div>
  );
}

function RepoCard() {
  const repo = useWorkspaceStore((s) => s.local!.connectedRepo!);
  const branch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);
  const disconnectRepo = useWorkspaceStore((s) => s.disconnectRepo);

  return (
    <div className="space-y-3 rounded-sm border border-success/30 bg-success/5 p-4">
      <div className="flex items-center gap-2 text-sm text-text-primary">
        <GitMerge size={14} className="text-success" aria-hidden="true" />
        <span className="font-medium">{repo.fullName}</span>
        {repo.isPrivate && (
          <span
            title="Private repo"
            className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted"
          >
            <Lock size={9} aria-hidden="true" />
            {repo.visibility}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
        <dt className="text-text-dim">Default branch</dt>
        <dd className="text-text-primary">{repo.defaultBranch}</dd>
        <dt className="text-text-dim">Pushable</dt>
        <dd className={repo.pushable ? 'text-text-primary' : 'text-warning'}>
          {repo.pushable ? 'Yes' : 'No (read-only access)'}
        </dd>
        <dt className="text-text-dim">Connected</dt>
        <dd className="text-text-primary">{new Date(repo.connectedAt).toLocaleString()}</dd>
      </dl>

      <BranchSection />

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={disconnectRepo}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Disconnect repo
        </button>
      </div>
      {!branch && !repo.pushable && (
        <p className="rounded-sm border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
          You don&apos;t have push access to this repo. Working branches can&apos;t be created.
          Reconnect with a token that grants push access (typically the <code>repo</code> scope on a
          token owned by a collaborator).
        </p>
      )}
    </div>
  );
}

function BranchSection() {
  const branch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);
  if (branch) return <BranchCard />;
  return <CreateBranchForm />;
}

function BranchCard() {
  const branch = useWorkspaceStore((s) => s.local!.workingBranch!);
  const discardWorkingBranch = useWorkspaceStore((s) => s.discardWorkingBranch);
  return (
    <div className="rounded-sm border border-border bg-card p-3">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <GitBranch size={12} className="text-accent" aria-hidden="true" />
        <span className="font-mono text-text-primary">{branch.name}</span>
      </div>
      <p className="text-[11px] text-text-dim">
        Created from <code>{branch.baseBranch}</code> at <code>{branch.headSha.slice(0, 7)}</code>{' '}
        on {new Date(branch.createdAt).toLocaleString()}.
      </p>
      <button
        type="button"
        onClick={discardWorkingBranch}
        className="mt-2 inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary"
        aria-label="Discard working branch"
      >
        <X size={10} />
        Discard branch
      </button>
    </div>
  );
}

function CreateBranchForm() {
  const repo = useWorkspaceStore((s) => s.local!.connectedRepo!);
  const workspaceName = useWorkspaceStore((s) => s.synced?.workspaceName ?? 'workspace');
  const createWorkingBranch = useWorkspaceStore((s) => s.createWorkingBranch);

  const [name, setName] = useState(() => generateWorkingBranchName({ workspaceName }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = validateBranchName(name);

  const submit = async () => {
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createWorkingBranch({ branchName: name });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422) {
        setError(`Branch \`${name}\` already exists on GitHub. Pick a different name.`);
      } else if (err instanceof MissingScopeError) {
        setError(`Token missing scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create branch — unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-sm border border-border bg-card p-3">
      <p className="text-xs text-text-muted">
        Create a working branch off <code>{repo.defaultBranch}</code>. Auto-named for you; editable.
        The first push to save will commit <code>workspace.json</code> here.
      </p>
      <label htmlFor="branch-name-input" className="block text-[11px] text-text-dim">
        Branch name
      </label>
      <input
        id="branch-name-input"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        aria-label="Branch name"
        className="h-7 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
      />
      {validation && <p className="text-[11px] text-warning">{validation}</p>}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !!validation}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          <Plus size={12} />
          {submitting ? 'Creating…' : 'Create working branch'}
        </button>
        <button
          type="button"
          onClick={() => setName(generateWorkingBranchName({ workspaceName }))}
          className="text-[11px] text-text-dim hover:text-text-muted"
          aria-label="Regenerate branch name"
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}
