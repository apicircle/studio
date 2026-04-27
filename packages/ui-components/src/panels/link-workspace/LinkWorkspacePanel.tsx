import { useMemo, useState } from 'react';
import {
  GitBranch,
  Globe,
  Key,
  Link2,
  Notebook,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
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
          <div className="flex flex-wrap gap-2">
            <LinkPrivateForm />
            <MarketplaceSearchForm />
          </div>
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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
      >
        <Link2 size={13} />
        Link a private workspace
      </button>
      <LinkPrivateModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MarketplaceSearchForm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-card px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
      >
        <Globe size={13} />
        Search marketplace
      </button>
      <MarketplaceSearchModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MarketplaceSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const searchMarketplace = useWorkspaceStore((s) => s.searchMarketplace);
  const linkPublicWorkspace = useWorkspaceStore((s) => s.linkPublicWorkspace);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    Array<{
      fullName: string;
      owner: string;
      name: string;
      description: string;
      topics: string[];
      stargazers: number;
      defaultBranch: string;
    }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<(typeof results)[number] | null>(null);

  const onSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const items = await searchMarketplace(query);
      setResults(items);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`Token missing scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof GitHubError) {
        setError(`GitHub ${err.status}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Search failed');
      }
    } finally {
      setSearching(false);
    }
  };

  const onConfirmLink = async () => {
    if (!confirmTarget) return;
    setLinking(confirmTarget.fullName);
    try {
      await linkPublicWorkspace({
        repoFullName: confirmTarget.fullName,
        branch: confirmTarget.defaultBranch,
        marketplace: {
          listedAs: confirmTarget.fullName,
          tags: confirmTarget.topics,
          summary: confirmTarget.description,
        },
      });
      setConfirmTarget(null);
      onClose();
      setQuery('');
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setLinking(null);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Search marketplace" className="max-w-2xl">
        <div className="space-y-3">
          <p className="text-[11px] text-text-dim">
            Searches public GitHub repos tagged <code>topic:apicircle-marketplace</code>. Linking
            uses the repo&apos;s default branch.
          </p>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="payments, weather, …"
              aria-label="Marketplace query"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSearch();
              }}
              className="h-8 flex-1 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void onSearch()}
              disabled={searching || !query.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              <Search size={11} />
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          {results.length > 0 && (
            <ul className="max-h-96 space-y-1.5 overflow-y-auto">
              {results.map((repo) => (
                <li key={repo.fullName} className="rounded-sm border border-border bg-surface p-2">
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-text-primary">{repo.fullName}</code>
                    <span className="inline-flex items-center gap-1 text-[10px] text-text-dim">
                      <Star size={9} aria-hidden="true" />
                      {repo.stargazers}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(repo)}
                      disabled={linking !== null}
                      className="ml-auto inline-flex h-6 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[10px] text-accent hover:bg-accent/20 disabled:opacity-50"
                    >
                      <Link2 size={10} />
                      Link
                    </button>
                  </div>
                  {repo.description && (
                    <p className="mt-1 text-[11px] text-text-muted">{repo.description}</p>
                  )}
                  {repo.topics.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1 text-[10px] text-text-dim">
                      {repo.topics.map((t) => (
                        <span
                          key={t}
                          className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-text-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!searching && results.length === 0 && query && !error && (
            <p className="text-[11px] text-text-dim">No results.</p>
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

      <ConfirmDialog
        open={confirmTarget !== null}
        title={`Link ${confirmTarget?.fullName ?? ''}?`}
        confirmLabel="Link"
        description={
          <p>
            About to link <code>{confirmTarget?.fullName}</code>@
            <code>{confirmTarget?.defaultBranch}</code> as a <strong>public</strong> workspace.
            Defaults to the source&apos;s currentVersion; you can pin to a specific version after
            linking.
          </p>
        }
        onCancel={() => setConfirmTarget(null)}
        onConfirm={onConfirmLink}
      />
    </>
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
  const [changelogOpen, setChangelogOpen] = useState(false);

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

      <RequiredKeysSection link={link} />

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
          onClick={() => setChangelogOpen(true)}
          disabled={sortedVersions.length === 0}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
        >
          <Notebook size={11} />
          Changelog
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

      <LinkedChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
        link={link}
      />

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

function LinkedChangelogModal({
  open,
  onClose,
  link,
}: {
  open: boolean;
  onClose: () => void;
  link: LinkedWorkspace;
}) {
  const ledger = useWorkspaceStore((s) => s.synced?.releases.perLink[link.id] ?? null);
  const sortedEntries = useMemo(() => {
    if (!ledger) return [];
    const order = sortVersionsDesc(ledger.versions.map((v) => v.version));
    return order
      .map((v) => ledger.versions.find((entry) => entry.version === v))
      .filter((v): v is NonNullable<typeof v> => v !== undefined);
  }, [ledger]);

  return (
    <Modal open={open} onClose={onClose} title={`${link.name} — changelog`} className="max-w-2xl">
      <div className="space-y-2">
        <p className="text-[11px] text-text-dim">
          Cached from{' '}
          <code>
            {link.source.repoFullName}@{link.source.branch}
          </code>{' '}
          at the last refresh. Refresh the ledger to pull newly-published versions.
        </p>
        {sortedEntries.length === 0 ? (
          <p className="text-[11px] text-text-dim">No published versions in the cached ledger.</p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {sortedEntries.map((entry) => {
              const isPinned = entry.version === link.pinnedVersion;
              return (
                <li key={entry.version} className="rounded-sm border border-border bg-surface p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs text-text-primary">v{entry.version}</code>
                    {isPinned && (
                      <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                        pinned
                      </span>
                    )}
                    {entry.deprecated && (
                      <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warning">
                        deprecated
                      </span>
                    )}
                    {entry.yanked && (
                      <span className="rounded-sm border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger">
                        yanked
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-text-dim">
                      {new Date(entry.publishedAt).toLocaleString()}
                    </span>
                  </div>
                  {entry.notes ? (
                    <p className="mt-1 whitespace-pre-wrap text-[11px] text-text-muted">
                      {entry.notes}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-text-dim italic">no release notes</p>
                  )}
                  <p
                    className="mt-1 font-mono text-[10px] text-text-dim"
                    title={entry.workspaceSnapshot}
                  >
                    snapshot {entry.workspaceSnapshot.slice(0, 12)}…
                  </p>
                </li>
              );
            })}
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

function RequiredKeysSection({ link }: { link: LinkedWorkspace }) {
  const addLinkedRequiredKey = useWorkspaceStore((s) => s.addLinkedRequiredKey);
  const [newKey, setNewKey] = useState('');

  const onAdd = () => {
    const trimmed = newKey.trim();
    if (!trimmed) return;
    try {
      addLinkedRequiredKey(link.id, trimmed);
      setNewKey('');
    } catch {
      // Empty/invalid — leave the input as-is for user to fix.
    }
  };

  return (
    <section className="mt-3 rounded-sm border border-border-subtle bg-surface p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Key size={12} className="text-text-dim" aria-hidden="true" />
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-dim">
          Required secret keys
        </h3>
      </div>
      {link.requiredSecretKeyIds.length === 0 ? (
        <p className="text-[11px] text-text-dim">
          No required keys declared. Add the names this linked workspace expects you to provide.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {link.requiredSecretKeyIds.map((keyId) => (
            <RequiredKeyRow key={keyId} link={link} keyId={keyId} />
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-1">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="API_KEY"
          aria-label="Add required key"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAdd();
          }}
          className="h-7 flex-1 rounded-sm border border-border bg-card px-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!newKey.trim()}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
        >
          <Plus size={10} />
          Add key
        </button>
      </div>
    </section>
  );
}

function RequiredKeyRow({ link, keyId }: { link: LinkedWorkspace; keyId: string }) {
  const provisionLinkedSecret = useWorkspaceStore((s) => s.provisionLinkedSecret);
  const removeLinkedRequiredKey = useWorkspaceStore((s) => s.removeLinkedRequiredKey);
  const provisionedId = useWorkspaceStore((s) => {
    const local = s.local;
    if (!local) return null;
    for (const entry of Object.values(local.secretIndex.entries)) {
      if (
        entry.origin === 'linked' &&
        entry.linkedWorkspaceId === link.id &&
        entry.linkedKeyId === keyId
      ) {
        return entry.id;
      }
    }
    return null;
  });

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const onSave = async () => {
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      await provisionLinkedSecret(link.id, keyId, value);
      setValue('');
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5">
      <code className="flex-1 text-[11px] text-text-primary">{keyId}</code>
      <span
        className={
          provisionedId
            ? 'rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-success'
            : 'rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warning'
        }
      >
        {provisionedId ? 'set' : 'missing'}
      </span>
      {editing ? (
        <>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value"
            aria-label={`Value for ${keyId}`}
            className="h-6 w-32 rounded-sm border border-border bg-surface px-1.5 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving || !value}
            className="inline-flex h-6 items-center rounded-sm border border-accent/40 bg-accent/10 px-2 text-[10px] text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue('');
            }}
            className="text-[10px] text-text-dim hover:text-text-muted"
          >
            cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex h-6 items-center rounded-sm border border-border bg-surface px-2 text-[10px] text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            {provisionedId ? 'Update' : 'Set value'}
          </button>
          <button
            type="button"
            onClick={() => setRemoveOpen(true)}
            aria-label={`Remove key ${keyId}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10"
          >
            <Trash2 size={10} />
          </button>
        </>
      )}
      {error && (
        <span className="text-[10px] text-danger" role="alert">
          {error}
        </span>
      )}

      <ConfirmDialog
        open={removeOpen}
        title={`Remove required key ${keyId}?`}
        tone="danger"
        confirmLabel="Remove"
        description={
          <p>
            Drops the key from the link declaration{' '}
            {provisionedId ? 'and removes its value from the secret vault' : ''}. The source
            workspace itself is untouched.
          </p>
        }
        onCancel={() => setRemoveOpen(false)}
        onConfirm={async () => {
          await removeLinkedRequiredKey(link.id, keyId);
          setRemoveOpen(false);
        }}
      />
    </li>
  );
}
