import { useMemo, useState } from 'react';
import { GitBranch, Link2, Package, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { GitHubError, MissingScopeError } from '@apicircle-v2/git';
import { sortVersionsDesc } from '@apicircle-v2/core';
import type { LinkedWorkspace } from '@apicircle-v2/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { Modal } from '../../primitives/Modal';

export function LinkWorkspacePanel() {
  const session = useWorkspaceStore((s) => s.local?.sessions.github ?? null);
  const links = useWorkspaceStore((s) => s.synced?.linkedWorkspaces ?? {});

  const linkArray = Object.values(links);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-medium text-text-primary">Link Workspace</h1>
        <span className="rounded-sm border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
          {linkArray.length} linked
        </span>
      </header>

      <p className="max-w-2xl text-xs text-text-muted">
        Pull collections, environments, and releases from another workspace. Each linked workspace
        is pinned to a specific version — pin changes always require explicit confirmation. Public
        marketplace search arrives in a later slice; private links work today.
      </p>

      {session === null ? (
        <NoSessionCard />
      ) : (
        <>
          <LinkPrivateForm />
          {linkArray.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wider text-text-dim">
                Linked workspaces
              </h2>
              {linkArray.map((link) => (
                <LinkCard key={link.id} link={link} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function NoSessionCard() {
  const openSecretVault = useWorkspaceStore((s) => s.openSecretVault);
  return (
    <div className="max-w-2xl rounded-sm border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-text-primary">
        <ShieldAlert size={14} className="text-amber" aria-hidden="true" />
        Connect GitHub first
      </div>
      <p className="mb-3 text-xs text-text-muted">
        Linking another workspace fetches its <code>workspace.json</code> via the GitHub API. You
        need an active session in the Secret Vault → Sessions tab.
      </p>
      <button
        type="button"
        onClick={openSecretVault}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
      >
        Open Secret Vault → Sessions
      </button>
    </div>
  );
}

function LinkPrivateForm() {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-2xl">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
      >
        <Link2 size={13} />
        Link a private workspace
      </button>
      <LinkPrivateModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function LinkPrivateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const linkPrivateWorkspace = useWorkspaceStore((s) => s.linkPrivateWorkspace);
  const [repoFullName, setRepoFullName] = useState('');
  const [branch, setBranch] = useState('main');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reset = () => {
    setRepoFullName('');
    setBranch('main');
    setPin('');
    setError(null);
  };

  const onSubmit = () => {
    if (!repoFullName.trim() || !branch.trim()) {
      setError('Repo and branch are required');
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      await linkPrivateWorkspace({
        repoFullName,
        branch,
        pinnedVersion: pin.trim() || undefined,
      });
      setConfirmOpen(false);
      reset();
      onClose();
    } catch (err) {
      setConfirmOpen(false);
      if (err instanceof MissingScopeError) {
        setError(`Token missing scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof GitHubError) {
        setError(`GitHub ${err.status}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Link failed — unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Link a private workspace">
        <div className="space-y-3">
          <p className="text-[11px] text-text-dim">
            Reads <code>workspace.json</code> from the source branch using your active GitHub
            session. The cached release ledger is stored under <code>releases.perLink[id]</code>.
          </p>
          <div>
            <label htmlFor="link-repo-input" className="block text-[11px] text-text-dim">
              Repo full name
            </label>
            <input
              id="link-repo-input"
              value={repoFullName}
              onChange={(e) => setRepoFullName(e.target.value)}
              placeholder="org/payments-api"
              aria-label="Linked repo full name"
              className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="link-branch-input" className="block text-[11px] text-text-dim">
                Branch
              </label>
              <input
                id="link-branch-input"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                aria-label="Linked branch"
                className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="link-pin-input" className="block text-[11px] text-text-dim">
                Pin version (optional)
              </label>
              <input
                id="link-pin-input"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="1.0.0"
                aria-label="Pin version"
                className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
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
              onClick={onSubmit}
              disabled={submitting || !repoFullName.trim()}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              <Link2 size={11} />
              Review &amp; link
            </button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title="Link this workspace?"
        confirmLabel="Link"
        description={
          <p>
            About to link <code>{repoFullName}</code>@<code>{branch}</code>
            {pin.trim() ? (
              <>
                {' '}
                pinned at <code>v{pin.trim()}</code>
              </>
            ) : (
              ' (pin defaults to source currentVersion)'
            )}
            .
          </p>
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onConfirm}
      />
    </>
  );
}

function LinkCard({ link }: { link: LinkedWorkspace }) {
  const ledger = useWorkspaceStore((s) => s.synced?.releases.perLink[link.id] ?? null);
  const refreshLinkedWorkspace = useWorkspaceStore((s) => s.refreshLinkedWorkspace);
  const unlinkWorkspace = useWorkspaceStore((s) => s.unlinkWorkspace);
  const pinLinkedVersion = useWorkspaceStore((s) => s.pinLinkedVersion);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [pendingPin, setPendingPin] = useState<string | null | undefined>(undefined);

  const sortedVersions = useMemo(
    () => (ledger ? sortVersionsDesc(ledger.versions.map((v) => v.version)) : []),
    [ledger],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshLinkedWorkspace(link.id);
    } catch (err) {
      if (err instanceof Error) setRefreshError(err.message);
      else setRefreshError('Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const updatesAvailable =
    ledger?.currentVersion !== undefined &&
    ledger?.currentVersion !== null &&
    ledger.currentVersion !== link.pinnedVersion;

  return (
    <div className="max-w-2xl rounded-sm border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-text-primary">
        <Package size={14} className="text-accent" aria-hidden="true" />
        <span className="font-medium">{link.name}</span>
        <span className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
          {link.kind}
        </span>
        {updatesAvailable && (
          <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warning">
            update available · v{ledger?.currentVersion}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
        <dt className="text-text-dim">Source</dt>
        <dd className="font-mono text-text-primary">
          <GitBranch size={11} className="mr-1 inline align-text-bottom" />
          {link.source.repoFullName}@{link.source.branch}
        </dd>
        <dt className="text-text-dim">Pinned version</dt>
        <dd className="flex items-center gap-2 text-text-primary">
          <select
            aria-label={`Pin ${link.name} version`}
            value={link.pinnedVersion ?? '__unpinned__'}
            onChange={(e) => {
              const v = e.target.value;
              setPendingPin(v === '__unpinned__' ? null : v);
            }}
            disabled={sortedVersions.length === 0}
            className="h-7 rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
          >
            <option value="__unpinned__">Unpinned (track latest)</option>
            {sortedVersions.map((v) => {
              const entry = ledger?.versions.find((x) => x.version === v);
              return (
                <option key={v} value={v}>
                  v{v}
                  {entry?.deprecated ? ' · deprecated' : ''}
                  {entry?.yanked ? ' · yanked' : ''}
                </option>
              );
            })}
          </select>
          {sortedVersions.length === 0 && (
            <span className="text-[11px] text-text-dim">no cached versions yet</span>
          )}
        </dd>
        <dt className="text-text-dim">Cached versions</dt>
        <dd className="text-text-primary">{ledger?.versions.length ?? 0}</dd>
        <dt className="text-text-dim">Linked at</dt>
        <dd className="text-text-primary">{new Date(link.linkedAt).toLocaleString()}</dd>
      </dl>
      {refreshError && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {refreshError}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh ledger'}
        </button>
        <button
          type="button"
          onClick={() => setUnlinkOpen(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-danger/30 bg-danger/5 px-3 text-xs text-danger hover:bg-danger/10"
        >
          <Trash2 size={11} />
          Unlink
        </button>
      </div>

      <ConfirmDialog
        open={pendingPin !== undefined}
        title={
          pendingPin === null ? `Unpin ${link.name}?` : `Pin ${link.name} to v${pendingPin ?? ''}?`
        }
        confirmLabel={pendingPin === null ? 'Unpin' : 'Pin'}
        description={
          <p>
            {pendingPin === null ? (
              <>
                Will track the source workspace's latest published version. Future updates need a
                new pin to lock in.
              </>
            ) : (
              <>
                Switch from{' '}
                {link.pinnedVersion ? <code>v{link.pinnedVersion}</code> : <em>unpinned</em>} to{' '}
                <code>v{pendingPin}</code>. Local context vars referencing the previous version will
                resolve against the new one.
              </>
            )}
          </p>
        }
        onCancel={() => setPendingPin(undefined)}
        onConfirm={() => {
          if (pendingPin === undefined) return;
          try {
            pinLinkedVersion(link.id, pendingPin);
          } finally {
            setPendingPin(undefined);
          }
        }}
      />

      <ConfirmDialog
        open={unlinkOpen}
        title={`Unlink ${link.name}?`}
        tone="danger"
        confirmLabel="Unlink"
        description={
          <p>
            Removes the link entry and its cached release ledger from this workspace. The source
            workspace itself is untouched. Workspace requests / environments that referenced this
            link will lose the source data on next refresh.
          </p>
        }
        onCancel={() => setUnlinkOpen(false)}
        onConfirm={() => {
          unlinkWorkspace(link.id);
          setUnlinkOpen(false);
        }}
      />
    </div>
  );
}
