import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hash,
  KeyRound,
  Lock,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import { type GitHubBranch, type GitHubRepo, GitHubError, MissingScopeError } from '@apicircle/git';
import {
  type DiffEntry,
  type ResolutionMap,
  type UnpushedChange,
  generateWorkingBranchName,
  isValidSemver,
  parseSemver,
  sortVersionsDesc,
  summarizeUnpushedChanges,
  validateBranchName,
} from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { Modal } from '../../primitives/Modal';
import { ReleaseAndTopicsModal } from './ReleaseAndTopicsModal';
import { cn } from '../../primitives/cn';
import { formatRelativeTime } from '../../primitives/relativeTime';

export function WorkspacePanel() {
  const workspaceName = useWorkspaceStore((s) => s.synced?.workspaceName ?? '');
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const session = useWorkspaceStore((s) => s.local?.sessions.github.workspace ?? null);
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

      <section>
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
          className="mt-1 h-9 w-full max-w-md rounded-sm border border-border bg-card px-3 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <p className="mt-2 text-xs text-text-dim">
          Persisted to the synced document. Pushed to Git when a working branch is created.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          GitHub Connection
        </h2>
        {isLocalOnly ? <NoSessionCard /> : <SessionCard />}
      </section>

      {!isLocalOnly && (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
            Repo &amp; Working Branch
          </h2>
          {!connectedRepo ? <ConnectRepoForm /> : <RepoCard />}
          <FirstPullPromptBanner />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          Releases
        </h2>
        <ReleasesCard />
      </section>

      <ConflictResolverModal />
    </div>
  );
}

function ReleasesCard() {
  const releases = useWorkspaceStore((s) => s.synced?.releases.self ?? null);
  const [publishOpen, setPublishOpen] = useState(false);

  const sortedVersions = useMemo(() => {
    if (!releases) return [];
    const order = sortVersionsDesc(releases.versions.map((v) => v.version));
    return order
      .map((v) => releases.versions.find((entry) => entry.version === v))
      .filter((v): v is NonNullable<typeof v> => v !== undefined);
  }, [releases]);

  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <Package size={14} className="text-accent" aria-hidden="true" />
          <span>Release history</span>
          {releases?.currentVersion && (
            <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
              v{releases.currentVersion}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPublishOpen(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
        >
          <Tag size={11} />
          Publish release
        </button>
      </div>
      <p className="mb-3 text-[11px] text-text-dim">
        Each release is a published version of this workspace that linked consumers can pin to.
        Every entry is fingerprinted with a SHA-256 of the workspace contents at publish time so
        consumers can verify what they&apos;re pulling matches what you released.
      </p>

      {sortedVersions.length === 0 ? (
        <p className="text-[11px] text-text-dim">No releases yet. Publish v0.1.0 to get started.</p>
      ) : (
        <ul className="space-y-1.5">
          {sortedVersions.map((v) => (
            <ReleaseRow key={v.version} entry={v} />
          ))}
        </ul>
      )}

      <PublishReleaseModal open={publishOpen} onClose={() => setPublishOpen(false)} />
    </div>
  );
}

function ReleaseRow({
  entry,
}: {
  entry: {
    version: string;
    publishedAt: string;
    notes: string;
    deprecated: boolean;
    yanked: boolean;
    workspaceSnapshot: string;
  };
}) {
  const deprecateRelease = useWorkspaceStore((s) => s.deprecateRelease);
  const yankRelease = useWorkspaceStore((s) => s.yankRelease);
  const [deprecateOpen, setDeprecateOpen] = useState(false);
  const [yankOpen, setYankOpen] = useState(false);

  return (
    <li className="rounded-sm border border-border bg-surface p-2">
      <div className="flex items-center gap-2">
        <code className="text-xs text-text-primary">v{entry.version}</code>
        {entry.deprecated && (
          <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warning">
            deprecated
          </span>
        )}
        {entry.yanked && (
          <span
            className="rounded-sm border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger"
            title="This version was withdrawn — consumers are warned away from it."
          >
            withdrawn
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-dim">
          {new Date(entry.publishedAt).toLocaleString()}
        </span>
      </div>
      {entry.notes && (
        <p className="mt-1 whitespace-pre-wrap text-[11px] text-text-muted">{entry.notes}</p>
      )}
      <p className="mt-1 font-mono text-[10px] text-text-dim" title={entry.workspaceSnapshot}>
        snapshot {entry.workspaceSnapshot.slice(0, 12)}…
      </p>
      <div className="mt-1.5 flex gap-2">
        {!entry.deprecated && !entry.yanked && (
          <button
            type="button"
            onClick={() => setDeprecateOpen(true)}
            className="inline-flex h-6 items-center rounded-sm border border-border bg-card px-2 text-[10px] text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Deprecate
          </button>
        )}
        {!entry.yanked && (
          <button
            type="button"
            onClick={() => setYankOpen(true)}
            title="Withdraw this version — consumers will be warned to upgrade or downgrade away from it."
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-danger/30 bg-danger/5 px-2 text-[10px] text-danger hover:bg-danger/10"
          >
            <AlertTriangle size={10} />
            Withdraw
          </button>
        )}
      </div>

      <ConfirmDialog
        open={deprecateOpen}
        title={`Deprecate v${entry.version}?`}
        description={
          <p>
            Marks v{entry.version} as deprecated. Consumers see a warning but the version stays
            installable.
          </p>
        }
        confirmLabel="Deprecate"
        onCancel={() => setDeprecateOpen(false)}
        onConfirm={() => {
          deprecateRelease(entry.version);
          setDeprecateOpen(false);
        }}
      />
      <ConfirmDialog
        open={yankOpen}
        title={`Withdraw v${entry.version}?`}
        tone="danger"
        confirmLabel="Withdraw"
        typedConfirm={`WITHDRAW v${entry.version}`}
        description={
          <p>
            Withdrawing signals the version is broken or unsafe. Consumers will be warned to upgrade
            or downgrade away from it. Type the exact phrase below to confirm.
          </p>
        }
        onCancel={() => setYankOpen(false)}
        onConfirm={() => {
          yankRelease(entry.version);
          setYankOpen(false);
        }}
      />
    </li>
  );
}

function PublishReleaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const releases = useWorkspaceStore((s) => s.synced?.releases.self ?? null);
  const publishRelease = useWorkspaceStore((s) => s.publishRelease);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedVersion = version.trim();
  const versionTaken = !!releases?.versions.find((v) => v.version === trimmedVersion);
  const validation = !trimmedVersion
    ? 'Enter a version'
    : !isValidSemver(trimmedVersion)
      ? 'Must be valid semver (e.g. 1.0.0)'
      : versionTaken
        ? `v${trimmedVersion} is already published`
        : null;

  const reset = () => {
    setVersion('');
    setNotes('');
    setError(null);
  };

  const onSubmit = () => {
    if (validation) return;
    setError(null);
    setConfirmOpen(true);
  };

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      // Publish only writes the ledger entry — Git tag + GitHub Release
      // creation moved to the Repo card's "Release & topics" modal so
      // tags can target main HEAD post-merge instead of an unmerged
      // working-branch commit. (See #6.)
      await publishRelease({
        version: trimmedVersion,
        notes,
      });
      setConfirmOpen(false);
      reset();
      onClose();
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : 'Publish failed — unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Publish release">
        <div className="space-y-3">
          {releases?.currentVersion && (
            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[11px] text-text-muted">
              <span className="text-text-dim">Latest published</span>
              <code className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-text-primary">
                v{releases.currentVersion}
              </code>
              {(() => {
                // Suggest the next semver bump in three flavors so the
                // user can click instead of typing. Defaults populate the
                // input — the user can still type something custom.
                const parts = parseSemver(releases.currentVersion);
                if (!parts) return null;
                const nextPatch = `${parts.major}.${parts.minor}.${parts.patch + 1}`;
                const nextMinor = `${parts.major}.${parts.minor + 1}.0`;
                const nextMajor = `${parts.major + 1}.0.0`;
                return (
                  <span className="ml-auto flex items-center gap-1 text-text-dim">
                    <span>Next:</span>
                    {[
                      { label: 'patch', val: nextPatch },
                      { label: 'minor', val: nextMinor },
                      { label: 'major', val: nextMajor },
                    ].map(({ label, val }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setVersion(val)}
                        title={`Set version to v${val} (${label} bump)`}
                        className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-[10px] font-mono text-text-muted hover:border-accent hover:text-text-primary"
                      >
                        {val}
                      </button>
                    ))}
                  </span>
                );
              })()}
            </div>
          )}
          <div>
            <label htmlFor="release-version-input" className="block text-[11px] text-text-dim">
              Version (semver)
            </label>
            <input
              id="release-version-input"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="0.1.0"
              aria-label="Release version"
              className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="release-notes-input" className="block text-[11px] text-text-dim">
              Notes (markdown)
            </label>
            <textarea
              id="release-notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              aria-label="Release notes"
              className="mt-1 w-full resize-y rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <p className="rounded-sm border border-border-subtle bg-surface p-2 text-[11px] leading-snug text-text-dim">
            Publish writes the version + notes to <code>workspace.json</code> and pushes to your
            working branch. To create a Git tag (or a GitHub Release) for this version, merge the PR
            first, then use <strong>Release &amp; topics</strong> on the Repo card — that path tags{' '}
            <code>main</code>&apos;s commit, not the unmerged working branch.
          </p>
          {validation && <p className="text-[11px] text-warning">{validation}</p>}
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!!validation || submitting}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              <Tag size={11} />
              {submitting ? 'Publishing…' : 'Review & publish'}
            </button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title={`Publish v${trimmedVersion}?`}
        confirmLabel="Publish"
        description={
          <p>
            About to append v{trimmedVersion} to <code>releases.self.versions</code> and bump
            <code> currentVersion</code>. Push to save the change to your working branch.
          </p>
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}

function ConflictResolverModal() {
  const pending = useWorkspaceStore((s) => s.pendingRefresh);
  const commitRefresh = useWorkspaceStore((s) => s.commitRefresh);
  const cancelRefresh = useWorkspaceStore((s) => s.cancelRefresh);

  const [resolutions, setResolutions] = useState<ResolutionMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflicts = useMemo(() => pending?.diff.conflicts ?? [], [pending]);
  const allResolved = useMemo(
    () => conflicts.every((c) => resolutions[`${c.bucket}:${c.key}`]),
    [conflicts, resolutions],
  );

  const onClose = () => {
    cancelRefresh();
    setResolutions({});
    setError(null);
  };

  const onCommit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await commitRefresh(resolutions);
      setResolutions({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply merge');
    } finally {
      setSubmitting(false);
    }
  };

  if (!pending) return null;

  return (
    <Modal open={true} onClose={onClose} title="Resolve conflicts" className="max-w-3xl">
      <div className="space-y-3">
        <p className="text-[11px] text-text-dim">
          Local and remote both edited the entries below. Pick a side for each one before merging.
          Cancel keeps the local doc untouched.
        </p>
        <ul className="space-y-2">
          {conflicts.map((c) => (
            <ConflictRow
              key={`${c.bucket}:${c.key}`}
              entry={c}
              resolution={resolutions[`${c.bucket}:${c.key}`] ?? null}
              onPick={(r) => setResolutions((prev) => ({ ...prev, [`${c.bucket}:${c.key}`]: r }))}
            />
          ))}
        </ul>
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onCommit()}
            disabled={submitting || !allResolved}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <GitMerge size={11} />
            {submitting ? 'Merging…' : 'Apply merge'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConflictRow({
  entry,
  resolution,
  onPick,
}: {
  entry: DiffEntry;
  resolution: 'mine' | 'theirs' | null;
  onPick: (r: 'mine' | 'theirs') => void;
}) {
  return (
    <li className="rounded-sm border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">
          <code className="text-text-muted">{entry.bucket}</code>
          {entry.key && <span className="text-text-dim"> · {entry.key}</span>}
          <span className="ml-2">{entry.label}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <ConflictSide
          title="Mine (local)"
          selected={resolution === 'mine'}
          value={entry.local}
          onSelect={() => onPick('mine')}
        />
        <ConflictSide
          title="Theirs (remote)"
          selected={resolution === 'theirs'}
          value={entry.remote}
          onSelect={() => onPick('theirs')}
        />
      </div>
    </li>
  );
}

function ConflictSide({
  title,
  selected,
  value,
  onSelect,
}: {
  title: string;
  selected: boolean;
  value: unknown;
  onSelect: () => void;
}) {
  const preview = value === undefined ? '(deleted)' : JSON.stringify(value, null, 2).slice(0, 240);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col items-stretch gap-1 rounded-sm border px-2 py-2 text-left transition-colors',
        selected
          ? 'border-accent bg-accent/10 text-text-primary'
          : 'border-border bg-card text-text-muted hover:border-border-strong',
      )}
    >
      <span className="text-[10px] uppercase tracking-wider text-text-dim">{title}</span>
      <pre className="whitespace-pre-wrap break-words font-mono text-[10px]">{preview}</pre>
    </button>
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
  const openRightDockTab = useWorkspaceStore((s) => s.openRightDockTab);
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
        onClick={() => openRightDockTab('vault')}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent transition-colors hover:bg-accent/20"
      >
        <KeyRound size={14} />
        Connect via Secret Vault → Sessions
      </button>
    </div>
  );
}

function SessionCard() {
  const session = useWorkspaceStore((s) => s.local!.sessions.github.workspace!);
  const openRightDockTab = useWorkspaceStore((s) => s.openRightDockTab);
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
      {session.canCreatePullRequests === false && (
        <p className="mt-3 rounded-sm border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
          This token can&apos;t create pull requests. Push will work; PR creation from the app will
          fail until the token is updated with the <code>pull_request</code> permission
          (fine-grained PATs) or the full <code>repo</code> scope (classic PATs).
        </p>
      )}
      <button
        type="button"
        onClick={() => openRightDockTab('vault')}
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
  const listAccessibleRepos = useWorkspaceStore((s) => s.listAccessibleRepos);
  const surfaceMissingScope = useWorkspaceStore((s) => s.surfaceMissingScope);

  const [manualMode, setManualMode] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [filter, setFilter] = useState('');
  const [showRepoList, setShowRepoList] = useState(false);

  useEffect(() => {
    if (manualMode) return;
    let cancelled = false;
    setLoadingRepos(true);
    setReposError(null);
    setRepos(null);
    listAccessibleRepos()
      .then((list) => {
        if (cancelled) return;
        setRepos(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MissingScopeError) {
          surfaceMissingScope(err.missingScopes);
          setReposError(`Missing required scopes: ${err.missingScopes.join(', ')}`);
        } else if (err instanceof Error) {
          setReposError(err.message);
        } else {
          setReposError('Failed to load repos');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRepos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manualMode, listAccessibleRepos, surfaceMissingScope]);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    const trimmed = filter.trim().toLowerCase();
    if (trimmed.length === 0) return repos.slice(0, 50);
    return repos
      .filter(
        (r) =>
          r.fullName.toLowerCase().includes(trimmed) ||
          r.name.toLowerCase().includes(trimmed) ||
          r.owner.toLowerCase().includes(trimmed),
      )
      .slice(0, 50);
  }, [repos, filter]);

  const connectByOwnerName = async (owner: string, name: string, label: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await connectRepo(owner, name);
      setValue('');
      setFilter('');
      setShowRepoList(false);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`Token is missing scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof GitHubError && err.status === 404) {
        setError(`Repo \`${label}\` not found, or your token can't see it.`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to connect — unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitManual = async () => {
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
    await connectByOwnerName(owner, name, trimmed);
  };

  return (
    <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <label className="block text-xs text-text-muted">Connect a repo on GitHub</label>
        <button
          type="button"
          onClick={() => {
            setManualMode((v) => !v);
            setError(null);
          }}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[10px] text-text-muted hover:border-border-strong hover:text-text-primary"
          aria-label={manualMode ? 'Switch to repo browser' : 'Switch to manual entry'}
        >
          <Pencil size={10} />
          {manualMode ? 'Browse repos' : 'Manual entry'}
        </button>
      </div>

      {manualMode ? (
        <div className="flex gap-2">
          <input
            id="repo-fullname-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="owner/name"
            aria-label="Repo full name"
            className="h-8 flex-1 rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting) void submitManual();
            }}
          />
          <button
            type="button"
            onClick={() => void submitManual()}
            disabled={submitting || !value.trim()}
            className="inline-flex h-8 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Connect repo'}
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            id="repo-fullname-combobox"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              if (!showRepoList) setShowRepoList(true);
            }}
            onFocus={() => setShowRepoList(true)}
            onBlur={() => {
              window.setTimeout(() => setShowRepoList(false), 150);
            }}
            placeholder={
              loadingRepos
                ? 'Loading your repositories…'
                : 'Filter accessible repos by name or owner…'
            }
            aria-label="Filter accessible repos"
            aria-controls="connect-repo-options"
            aria-expanded={showRepoList}
            role="combobox"
            disabled={loadingRepos || submitting}
            className="h-8 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
          />
          {showRepoList && filteredRepos.length > 0 && (
            <ul
              id="connect-repo-options"
              role="listbox"
              className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-sm border border-border bg-card shadow-elevated"
            >
              {filteredRepos.map((r) => (
                <li key={r.fullName}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void connectByOwnerName(r.owner, r.name, r.fullName)}
                    role="option"
                    aria-label={`Connect ${r.fullName}`}
                    disabled={submitting}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface hover:text-text-primary disabled:opacity-50"
                  >
                    <code className="flex-1 truncate font-mono">{r.fullName}</code>
                    <span className="shrink-0 rounded-sm border border-border bg-surface px-1 py-0.5 text-[10px] text-text-dim">
                      {r.visibility}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showRepoList &&
            !loadingRepos &&
            filteredRepos.length === 0 &&
            filter.trim().length > 0 && (
              <p className="mt-1 text-[11px] text-text-dim">No repos match.</p>
            )}
          {reposError && (
            <p className="mt-1 text-[11px] text-danger" role="alert">
              {reposError}
            </p>
          )}
          {submitting && <p className="mt-1 text-[11px] text-text-dim">Verifying…</p>}
        </div>
      )}

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <p className="text-[11px] text-text-dim">
        Pick from your accessible repos, or use Manual entry for repos that don&apos;t show up. We
        call <code>GET /repos/&lt;owner&gt;/&lt;name&gt;</code> with your stored PAT to validate
        access and read the default branch. Nothing is written.
      </p>
    </div>
  );
}

function RepoCard() {
  const repo = useWorkspaceStore((s) => s.local!.connectedRepo!);
  const branch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);
  const disconnectRepo = useWorkspaceStore((s) => s.disconnectRepo);
  const [releaseAndTopicsOpen, setReleaseAndTopicsOpen] = useState(false);

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

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => setReleaseAndTopicsOpen(true)}
          title={`Create a Git tag for the latest published version, pointing at ${repo.defaultBranch}'s HEAD. Optionally creates a matching GitHub Release.`}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
        >
          <Tag size={11} aria-hidden="true" />
          Tag release
        </button>
        <button
          type="button"
          onClick={() => setReleaseAndTopicsOpen(true)}
          title="Add or remove GitHub topics on this repo. Topics drive marketplace discoverability for public workspaces."
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-accent hover:text-accent"
        >
          <Hash size={11} aria-hidden="true" />
          Edit topics
        </button>
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
      <ReleaseAndTopicsModal
        open={releaseAndTopicsOpen}
        onClose={() => setReleaseAndTopicsOpen(false)}
      />
    </div>
  );
}

function BranchSection() {
  const branch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);
  if (branch) return <BranchCard />;
  return (
    <>
      <RetiredBranchBanner />
      <CreateBranchForm />
    </>
  );
}

function BranchCard() {
  const branch = useWorkspaceStore((s) => s.local!.workingBranch!);
  const session = useWorkspaceStore((s) => s.local?.sessions.github.workspace ?? null);
  const lastPulledAt = useWorkspaceStore((s) => s.local?.sync.lastPulledAt ?? null);
  const discardWorkingBranch = useWorkspaceStore((s) => s.discardWorkingBranch);
  const pushWorkspace = useWorkspaceStore((s) => s.pushWorkspace);
  const refreshWorkspace = useWorkspaceStore((s) => s.refreshWorkspace);
  // Inputs for the pre-push diff summary (B.3): the canonical-pulled
  // snapshot from the last successful pull, plus the consumer's
  // currently-edited synced doc. The summary is recomputed via useMemo
  // when either input changes — typically only on store mutations.
  const lastPulledSnapshot = useWorkspaceStore((s) => s.local?.sync.lastPulledSnapshot ?? null);
  const syncedDoc = useWorkspaceStore((s) => s.synced);

  const surfaceMissingScope = useWorkspaceStore((s) => s.surfaceMissingScope);
  const syncAttachments = useWorkspaceStore((s) => s.syncAttachments);
  const [message, setMessage] = useState('');
  const [showMessageField, setShowMessageField] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justPushedSha, setJustPushedSha] = useState<string | null>(null);
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const unpushed = useMemo(
    () =>
      syncedDoc
        ? summarizeUnpushedChanges(lastPulledSnapshot, syncedDoc)
        : { added: 0, modified: 0, removed: 0, total: 0, changes: [], computedAt: '' },
    [lastPulledSnapshot, syncedDoc],
  );

  const onSyncAttachments = async () => {
    setSyncing(true);
    setError(null);
    setRefreshNotice(null);
    try {
      const result = await syncAttachments();
      if (result.fetched === 0 && result.alreadyPresent === 0 && result.failed === 0) {
        setRefreshNotice('No attachments referenced.');
      } else {
        setRefreshNotice(
          `Attachments: ${result.fetched} fetched, ${result.alreadyPresent} already present` +
            (result.failed > 0 ? `, ${result.failed} failed` : '') +
            '.',
        );
      }
    } catch (err) {
      if (err instanceof MissingScopeError) {
        surfaceMissingScope(err.missingScopes);
      } else if (err instanceof GitHubError) {
        setError(`GitHub ${err.status}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setRefreshNotice(null);
    try {
      const result = await refreshWorkspace();
      switch (result.status) {
        case 'no-remote':
          setRefreshNotice('No workspace.json on the working branch yet — push first.');
          break;
        case 'up-to-date':
          setRefreshNotice('Up to date with the remote.');
          break;
        case 'merged':
          setRefreshNotice('Pulled remote changes — fast-forward merge applied.');
          break;
        case 'conflicts':
          // The Conflict Resolver modal renders in response to pendingRefresh.
          break;
        case 'retired':
          // Refresh discovered the working branch is over (PR merged or
          // branch deleted on GitHub). The store has already cleared
          // workingBranch + populated retiredBranch — the panel re-renders
          // to show CreateBranchForm with the retirement banner above it,
          // so we don't need a transient toast notice here.
          break;
      }
    } catch (err) {
      if (err instanceof MissingScopeError) {
        surfaceMissingScope(err.missingScopes);
      } else if (err instanceof GitHubError) {
        setError(`GitHub ${err.status}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Refresh failed — unknown error');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const onPush = async () => {
    setPushing(true);
    setError(null);
    setJustPushedSha(null);
    try {
      const { commitSha } = await pushWorkspace(message || undefined);
      setJustPushedSha(commitSha);
      setMessage('');
      setShowMessageField(false);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        surfaceMissingScope(err.missingScopes);
      } else if (err instanceof GitHubError) {
        setError(`GitHub ${err.status}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Push failed — unknown error');
      }
    } finally {
      setPushing(false);
    }
  };

  const isClean = branch.headSha === branch.lastPushedSha;
  // Block Create PR only when capability has been positively disproven
  // (probe returned 403). `null` means the probe hasn't run yet — leave
  // the button enabled and let the API call surface MissingScopeError if
  // it fails. The common case (classic PATs with `repo`) resolves to
  // `true` at session connect, so the button enables as soon as a push
  // has landed.
  const prCapability = session?.canCreatePullRequests ?? null;
  const canCreatePr =
    branch.lastPushedSha !== null && branch.openPrUrl === null && prCapability !== false;

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
      <p className="mt-1 text-[11px] text-text-dim">
        Last pushed:{' '}
        {branch.lastPushedSha ? (
          <code className="text-text-primary">{branch.lastPushedSha.slice(0, 7)}</code>
        ) : (
          <em>never</em>
        )}
        {isClean && branch.lastPushedSha && <span className="ml-1 text-success">· up to date</span>}
      </p>
      {lastPulledAt && (
        <p className="text-[11px] text-text-dim" title={new Date(lastPulledAt).toLocaleString()}>
          Last pulled: <span className="text-text-primary">{formatRelativeTime(lastPulledAt)}</span>
          . Refresh to pull remote changes.
        </p>
      )}
      <UnpushedChangesStrip summary={unpushed} onOpen={() => setDiffOpen(true)} />
      <UnpushedChangesModal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        summary={unpushed}
        baseLabel={
          lastPulledAt
            ? `last pulled ${formatRelativeTime(lastPulledAt)}`
            : 'first push (no upstream)'
        }
      />

      {showMessageField && (
        <div className="mt-2">
          <label htmlFor="commit-message-input" className="block text-[11px] text-text-dim">
            Commit message (optional)
          </label>
          <input
            id="commit-message-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="chore: sync workspace via API Circle Studio"
            aria-label="Commit message"
            className="mt-1 h-7 w-full rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {justPushedSha && !error && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-success">
          <CheckCircle2 size={11} aria-hidden="true" />
          Pushed <code>{justPushedSha.slice(0, 7)}</code>
        </p>
      )}
      {refreshNotice && !error && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-text-muted">
          <RefreshCw size={11} aria-hidden="true" />
          {refreshNotice}
        </p>
      )}

      {branch.openPrUrl && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent">
          <GitPullRequest size={11} aria-hidden="true" />
          PR open:{' '}
          <a
            href={branch.openPrUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 underline hover:text-accent/80"
          >
            {branch.openPrUrl.replace(/^https:\/\/github\.com\//, '')}
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onPush()}
          disabled={pushing}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          <Upload size={11} />
          {pushing ? 'Pushing…' : 'Push to save'}
        </button>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          title="Pulls the working branch and reconciles changes. Conflicts open the resolver."
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={() => void onSyncAttachments()}
          disabled={syncing}
          title="Downloads any attachment blobs referenced by workspace.json that aren't yet in your local IDB."
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
        >
          <Download size={11} className={syncing ? 'animate-spin' : undefined} />
          {syncing ? 'Syncing…' : 'Sync attachments'}
        </button>
        <button
          type="button"
          onClick={() => setPrModalOpen(true)}
          disabled={!canCreatePr}
          title={
            !branch.lastPushedSha
              ? 'Push to save before opening a PR'
              : branch.openPrUrl
                ? 'A PR is already open for this branch'
                : undefined
          }
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GitPullRequest size={11} />
          Create PR
        </button>
        <button
          type="button"
          onClick={() => setShowMessageField((v) => !v)}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          {showMessageField ? 'Hide message' : 'Custom commit message'}
        </button>
        <button
          type="button"
          onClick={discardWorkingBranch}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary"
          aria-label="Discard working branch"
        >
          <X size={10} />
          Discard branch
        </button>
      </div>

      <CreatePrModal open={prModalOpen} onClose={() => setPrModalOpen(false)} />
    </div>
  );
}

function UnpushedChangesStrip({
  summary,
  onOpen,
}: {
  summary: { added: number; modified: number; removed: number; total: number };
  onOpen: () => void;
}) {
  if (summary.total === 0) {
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-success">
        <CheckCircle2 size={11} aria-hidden="true" />
        No unpushed changes — workspace matches the last pull.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Show unpushed changes preview"
      className="mt-1 inline-flex items-center gap-2 rounded-sm border border-warning/40 bg-warning/5 px-2 py-1 text-[11px] text-warning hover:bg-warning/10"
    >
      <FileDiff size={11} aria-hidden="true" />
      <span>
        {summary.added > 0 && <span className="text-success">+{summary.added}</span>}
        {summary.added > 0 && (summary.modified > 0 || summary.removed > 0) && ' '}
        {summary.modified > 0 && <span className="text-warning">~{summary.modified}</span>}
        {summary.modified > 0 && summary.removed > 0 && ' '}
        {summary.removed > 0 && <span className="text-danger">-{summary.removed}</span>}
        {' unpushed change'}
        {summary.total === 1 ? '' : 's'} · click to preview
      </span>
    </button>
  );
}

function UnpushedChangesModal({
  open,
  onClose,
  summary,
  baseLabel,
}: {
  open: boolean;
  onClose: () => void;
  summary: {
    added: number;
    modified: number;
    removed: number;
    total: number;
    changes: UnpushedChange[];
  };
  baseLabel: string;
}) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Unpushed changes preview" className="max-w-3xl">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-text-dim">
          Diff against {baseLabel}. Push to save commits these changes to the working branch.
        </p>
        <div className="flex gap-2 text-[11px]">
          <span className="rounded-sm border border-success/40 bg-success/10 px-2 py-0.5 text-success">
            +{summary.added} added
          </span>
          <span className="rounded-sm border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
            ~{summary.modified} modified
          </span>
          <span className="rounded-sm border border-danger/40 bg-danger/10 px-2 py-0.5 text-danger">
            -{summary.removed} removed
          </span>
        </div>
        {summary.total === 0 ? (
          <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
            Nothing to push.
          </p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto" aria-label="Unpushed changes">
            {summary.changes.map((c) => (
              <UnpushedChangeRow key={`${c.bucket}:${c.key}`} change={c} />
            ))}
          </ul>
        )}
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UnpushedChangeRow({ change }: { change: UnpushedChange }) {
  const [open, setOpen] = useState(false);
  const tone =
    change.kind === 'added'
      ? 'border-success/40 bg-success/5 text-success'
      : change.kind === 'modified'
        ? 'border-warning/40 bg-warning/5 text-warning'
        : 'border-danger/40 bg-danger/5 text-danger';
  return (
    <li className="rounded-sm border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs"
        aria-expanded={open}
        aria-label={`Toggle ${change.kind} ${change.label}`}
      >
        <span
          className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
        >
          {change.kind}
        </span>
        <span className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-[10px] text-text-dim">
          {change.bucket}
        </span>
        <code className="flex-1 truncate text-text-primary">{change.label}</code>
        <span className="text-[10px] text-text-dim">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-border-subtle p-2 text-[10px]">
          <div>
            <p className="mb-1 text-text-dim">Before (last pull)</p>
            <pre className="max-h-40 overflow-y-auto rounded-sm border border-border bg-card p-1.5 font-mono text-text-muted">
              {change.base === undefined
                ? '— (did not exist)'
                : JSON.stringify(change.base, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-text-dim">After (current)</p>
            <pre className="max-h-40 overflow-y-auto rounded-sm border border-border bg-card p-1.5 font-mono text-text-primary">
              {change.local === undefined ? '— (deleted)' : JSON.stringify(change.local, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}

function CreatePrModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const branch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);
  const createPullRequest = useWorkspaceStore((s) => s.createPullRequest);
  const surfaceMissingScope = useWorkspaceStore((s) => s.surfaceMissingScope);

  const [title, setTitle] = useState('APICircle workspace updates');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!branch) return null;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await createPullRequest({ title, body });
      onClose();
      setTitle('APICircle workspace updates');
      setBody('');
    } catch (err) {
      if (err instanceof MissingScopeError) {
        onClose();
        surfaceMissingScope(err.missingScopes);
      } else if (err instanceof GitHubError) {
        setError(`GitHub ${err.status}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('PR creation failed — unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Open pull request">
      <div className="space-y-3">
        <p className="text-[11px] text-text-dim">
          From <code className="text-text-muted">{branch.name}</code> →{' '}
          <code className="text-text-muted">{branch.baseBranch}</code> on{' '}
          <code className="text-text-muted">{branch.repoFullName}</code>.
        </p>
        <div>
          <label htmlFor="pr-title-input" className="block text-[11px] text-text-dim">
            Title
          </label>
          <input
            id="pr-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="PR title"
            className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="pr-body-input" className="block text-[11px] text-text-dim">
            Description (markdown)
          </label>
          <textarea
            id="pr-body-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="PR body"
            rows={6}
            className="mt-1 w-full resize-y rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !title.trim()}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <GitPullRequest size={11} />
            {submitting ? 'Creating PR…' : 'Open PR'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CreateBranchForm() {
  const repo = useWorkspaceStore((s) => s.local!.connectedRepo!);
  const workspaceName = useWorkspaceStore((s) => s.synced?.workspaceName ?? 'workspace');
  const createWorkingBranch = useWorkspaceStore((s) => s.createWorkingBranch);
  const listRepoBranches = useWorkspaceStore((s) => s.listRepoBranches);
  const seedInitialCommit = useWorkspaceStore((s) => s.seedInitialCommit);
  const surfaceMissingScope = useWorkspaceStore((s) => s.surfaceMissingScope);

  const [name, setName] = useState(() => generateWorkingBranchName({ workspaceName }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<GitHubBranch[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string>(repo.defaultBranch);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingBranches(true);
    setBranchesError(null);
    setBranches(null);
    listRepoBranches(repo.owner, repo.name)
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
        const preferred =
          list.find((b) => b.name === repo.defaultBranch)?.name ?? list[0]?.name ?? '';
        if (preferred) setBaseBranch(preferred);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MissingScopeError) {
          surfaceMissingScope(err.missingScopes);
          setBranchesError(`Missing required scopes: ${err.missingScopes.join(', ')}`);
        } else if (err instanceof Error) {
          setBranchesError(err.message);
        } else {
          setBranchesError('Failed to load branches');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.owner, repo.name, repo.defaultBranch, listRepoBranches, surfaceMissingScope]);

  const onSeed = async () => {
    setSeeding(true);
    setSeedError(null);
    try {
      const result = await seedInitialCommit();
      // Optimistically populate the branch list with the just-seeded branch.
      // GitHub's `/branches` endpoint has eventual consistency relative to a
      // fresh content write — re-fetching here would often still return [],
      // leaving the empty-repo warning visible. We trust the seed result
      // (the branch demonstrably exists) and skip the round-trip.
      setBranches([{ name: result.branchName, commitSha: result.scaffoldSha }]);
      setBaseBranch(result.branchName);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        surfaceMissingScope(err.missingScopes);
      } else if (err instanceof Error) {
        setSeedError(err.message);
      } else {
        setSeedError('Failed to seed initial commit');
      }
    } finally {
      setSeeding(false);
    }
  };

  const validation = validateBranchName(name);
  const noBranches = branches !== null && branches.length === 0;

  const submit = async () => {
    if (validation) {
      setError(validation);
      return;
    }
    if (!baseBranch) {
      setError('Pick a base branch to create from.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createWorkingBranch({ branchName: name, baseBranch });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422) {
        setError(`Branch \`${name}\` already exists on GitHub. Pick a different name.`);
      } else if (err instanceof GitHubError && err.status === 404) {
        setError(
          `Base branch \`${baseBranch}\` no longer exists on ${repo.fullName}. Pick a different base branch.`,
        );
      } else if (err instanceof MissingScopeError) {
        surfaceMissingScope(err.missingScopes);
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
        Create a working branch from an existing branch. Auto-named for you; editable. The first
        push to save will commit <code>workspace.json</code> here.
      </p>

      <label htmlFor="base-branch-select" className="block text-[11px] text-text-dim">
        Base branch
      </label>
      {loadingBranches ? (
        <p className="text-[11px] text-text-dim">Loading branches…</p>
      ) : branchesError ? (
        <p className="text-[11px] text-danger" role="alert">
          {branchesError}
        </p>
      ) : noBranches ? (
        <div className="space-y-2 rounded-sm border border-warning/30 bg-warning/5 p-2.5">
          <p className="text-[11px] text-warning">
            This repo is empty. Seed an initial commit with a scaffold{' '}
            <code className="font-mono">workspace.json</code> on{' '}
            <code className="font-mono">{repo.defaultBranch}</code> — your local content is
            unchanged and lands on the working branch when you push.
          </p>
          {seedError && (
            <p className="text-[11px] text-danger" role="alert">
              {seedError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void onSeed()}
            disabled={seeding}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-warning/40 bg-warning/10 px-3 text-[11px] text-warning hover:bg-warning/20 disabled:opacity-50"
          >
            <Plus size={11} />
            {seeding ? 'Seeding…' : `Seed ${repo.defaultBranch}`}
          </button>
        </div>
      ) : (
        <div className="relative">
          <select
            id="base-branch-select"
            value={baseBranch}
            onChange={(e) => {
              setBaseBranch(e.target.value);
              setError(null);
            }}
            aria-label="Base branch"
            className="h-7 w-full appearance-none rounded-sm border border-border bg-surface px-2 pr-7 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            {branches?.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.name === repo.defaultBranch ? ' · default' : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-faint"
          />
        </div>
      )}

      <label htmlFor="branch-name-input" className="block text-[11px] text-text-dim">
        New branch name
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
          disabled={submitting || !!validation || loadingBranches || noBranches || !baseBranch}
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

/**
 * Surfaced above CreateBranchForm when `refreshWorkspace` discovered the
 * previous working branch is over — the PR was merged, or the branch ref
 * was deleted on GitHub. The banner tells the user *why* their branch is
 * gone (so the disappearance isn't surprising) and points them at the
 * still-visible CreateBranchForm below to start fresh. Auto-dismissed
 * when the user successfully creates a new working branch.
 */
function RetiredBranchBanner() {
  const retired = useWorkspaceStore((s) => s.local?.retiredBranch ?? null);
  const dismiss = useWorkspaceStore((s) => s.dismissRetiredBranch);
  if (!retired) return null;

  const isMerged = retired.reason === 'pr-merged';
  const headline = isMerged
    ? `PR #${retired.prNumber ?? '—'} was merged`
    : `Branch ${retired.branchName} was deleted on GitHub`;
  const detail = isMerged
    ? `The branch ${retired.branchName} has been retired. Create a new working branch below to continue.`
    : 'Create a new working branch below to continue.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 flex items-start gap-2 rounded-sm border border-success/40 bg-success/5 p-3 text-xs"
    >
      <GitMerge size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium text-text-primary">{headline}</p>
        <p className="mt-0.5 text-text-muted">{detail}</p>
        {retired.prUrl && (
          <a
            href={retired.prUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
          >
            <GitPullRequest size={11} aria-hidden="true" />
            View PR
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss retired branch notice"
        className="shrink-0 rounded-sm p-1 text-text-faint hover:bg-surface hover:text-text-muted"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Surfaced after `createWorkingBranch` if the new branch already had a
 * `workspace.json` upstream. Prevents the user from accidentally
 * overwriting populated remote content with their local seed.
 */
function FirstPullPromptBanner() {
  const prompt = useWorkspaceStore((s) => s.firstPullPrompt);
  const acknowledge = useWorkspaceStore((s) => s.acknowledgeFirstPull);
  const refreshWorkspace = useWorkspaceStore((s) => s.refreshWorkspace);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!prompt) return null;

  const onPull = async () => {
    setPulling(true);
    setError(null);
    try {
      await refreshWorkspace();
      // Refresh routes through the conflict resolver if it finds local
      // mods that diverge — that flow handles the rest. Either way,
      // dismiss the banner now that the user has chosen.
      acknowledge();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pull failed');
    } finally {
      setPulling(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 flex flex-col gap-2 rounded-sm border border-warning/40 bg-warning/5 p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <Download size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-medium text-warning">This branch already has content</p>
          <p className="mt-0.5 text-text-muted">
            <code className="font-mono">workspace.json</code> exists on{' '}
            <code className="font-mono">{prompt.branchName}</code>. Pull it now to see the diff
            against your local state before pushing — otherwise your first push will overwrite
            whatever was there.
          </p>
        </div>
      </div>
      {error && (
        <p
          className="rounded-sm border border-danger/30 bg-danger/5 p-1.5 text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={acknowledge}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Skip — I&apos;ll push my local first
        </button>
        <button
          type="button"
          onClick={() => void onPull()}
          disabled={pulling}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-warning/40 bg-warning/10 px-3 text-[11px] text-warning hover:bg-warning/20 disabled:opacity-50"
        >
          <Download size={11} />
          {pulling ? 'Pulling…' : 'Pull first'}
        </button>
      </div>
    </div>
  );
}
