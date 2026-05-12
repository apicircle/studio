import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ChevronDown,
  GitBranch,
  Globe,
  Info,
  Key,
  Link2,
  Notebook,
  Package,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import { type GitHubBranch, type GitHubRepo, GitHubError, MissingScopeError } from '@apicircle/git';
import { sortVersionsDesc } from '@apicircle/core';
import type { LinkedWorkspace, SecretKeyMeta } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { Modal } from '../../primitives/Modal';

export function LinkWorkspacePanel() {
  const session = useWorkspaceStore((s) => s.local?.sessions.github.workspace ?? null);
  const links = useWorkspaceStore((s) => s.synced?.linkedWorkspaces ?? {});

  const linkArray = Object.values(links);
  const hasSession = session !== null;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-medium text-text-primary">Link Workspace</h1>
        <span className="rounded-sm border border-border bg-card px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-text-muted">
          {linkArray.length} linked
        </span>
      </header>

      <p className="max-w-3xl text-xs text-text-muted">
        Pull collections, environments, and releases from another workspace. Each linked workspace
        is pinned to a specific version — pin changes always require explicit confirmation. Public
        marketplace search runs anonymously; linking a workspace (public or private) needs a GitHub
        session.
      </p>

      <div className="flex flex-wrap gap-2">
        <LinkPrivateForm hasSession={hasSession} />
        <MarketplaceSearchForm />
      </div>

      {!hasSession && <NoSessionCard />}

      {linkArray.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-text-dim">
            Linked workspaces
          </h2>
          <p className="-mt-1 flex items-start gap-1 text-[0.6875rem] leading-snug text-text-dim">
            <Info size={11} aria-hidden="true" className="mt-0.5 shrink-0 text-text-faint" />
            <span>
              Linking is <strong>one level deep</strong>. If a workspace you link has its own links,
              their content does not carry forward — only the directly-linked workspace&apos;s
              collections, environments, and releases are pulled.
            </span>
          </p>
          {linkArray.map((link) => (
            <LinkCard key={link.id} link={link} />
          ))}
        </section>
      )}
    </div>
  );
}

function NoSessionCard() {
  const openRightDockTab = useWorkspaceStore((s) => s.openRightDockTab);
  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-text-primary">
        <ShieldAlert size={14} className="text-amber" aria-hidden="true" />
        Connect GitHub to link a workspace
      </div>
      <p className="mb-3 text-xs text-text-muted">
        You can browse the public marketplace without signing in. Linking a workspace (public or
        private) fetches its <code>workspace.json</code> via the GitHub API and needs an active
        session in the Secret Vault → Sessions tab.
      </p>
      <button
        type="button"
        onClick={() => openRightDockTab('vault')}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
      >
        Open Secret Vault → Sessions
      </button>
    </div>
  );
}

function LinkPrivateForm({ hasSession }: { hasSession: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!hasSession}
        title={hasSession ? undefined : 'Connect GitHub in Secret Vault to link a workspace'}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
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
  const surfaceMissingScope = useWorkspaceStore((s) => s.surfaceMissingScope);
  const openRightDockTab = useWorkspaceStore((s) => s.openRightDockTab);
  const hasSession = useWorkspaceStore((s) => s.local?.sessions.github.workspace != null);

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
        onClose();
        surfaceMissingScope(err.missingScopes);
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
      <Modal open={open} onClose={onClose} title="Search marketplace" className="max-w-5xl">
        <div className="space-y-3">
          <p className="text-[0.6875rem] text-text-dim">
            Searches public GitHub repos tagged <code>topic:apicircle-marketplace</code>. Linking
            uses the repo&apos;s default branch.
          </p>
          {!hasSession && (
            <p className="text-[0.6875rem] text-text-dim">
              Browsing is anonymous. To link a result, connect GitHub in the{' '}
              <button
                type="button"
                onClick={() => openRightDockTab('vault')}
                className="text-accent underline-offset-2 hover:underline"
              >
                Secret Vault
              </button>
              .
            </p>
          )}
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
                    <span className="inline-flex items-center gap-1 text-[0.625rem] text-text-dim">
                      <Star size={9} aria-hidden="true" />
                      {repo.stargazers}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(repo)}
                      disabled={linking !== null || !hasSession}
                      title={
                        hasSession
                          ? undefined
                          : 'Connect GitHub in Secret Vault to link this workspace'
                      }
                      className="ml-auto inline-flex h-6 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.625rem] text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Link2 size={10} />
                      Link
                    </button>
                  </div>
                  {repo.description && (
                    <p className="mt-1 text-[0.6875rem] text-text-muted">{repo.description}</p>
                  )}
                  {repo.topics.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1 text-[0.625rem] text-text-dim">
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
            <p className="text-[0.6875rem] text-text-dim">No results.</p>
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
  const listAccessibleRepos = useWorkspaceStore((s) => s.listAccessibleRepos);
  const listRepoBranches = useWorkspaceStore((s) => s.listRepoBranches);
  const probeLinkedRepoVersions = useWorkspaceStore((s) => s.probeLinkedRepoVersions);
  const surfaceMissingScope = useWorkspaceStore((s) => s.surfaceMissingScope);

  // Combobox / dropdown state.
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [filter, setFilter] = useState('');
  const [showRepoList, setShowRepoList] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  const [branches, setBranches] = useState<GitHubBranch[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>('');

  const [probe, setProbe] = useState<{
    workspaceName: string;
    versions: string[];
    currentVersion: string | null;
    requiredSecretKeys: SecretKeyMeta[];
  } | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [loadingProbe, setLoadingProbe] = useState(false);
  const [pinChoice, setPinChoice] = useState<'currentVersion' | 'specific'>('currentVersion');
  const [specificPin, setSpecificPin] = useState<string>('');

  // Plaintext values the user supplies for the source's required secret
  // slots. Keyed by secretKeyId → plaintext. Cleared on modal reset.
  // Empty values (or untouched slots) are skipped at link-time; the
  // slot stays "missing" until provisioned later from the link card.
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});

  // Manual-entry escape hatch for repos that don't show up in /user/repos
  // (e.g. private repos in orgs the user has explicit grants on but isn't
  // a formal member of). Toggling this mode hides the combobox + dropdowns
  // and shows free-text inputs that match the pre-B.1 flow.
  const [manualMode, setManualMode] = useState(false);
  const [manualRepo, setManualRepo] = useState('');
  const [manualBranch, setManualBranch] = useState('main');
  const [manualPin, setManualPin] = useState('');

  // Session mode picker. 'workspace' reuses the workspace PAT; 'dedicated'
  // adds a per-link PAT under local.sessions.github.links[<linkId>] so the
  // source repo can be reached even when the workspace session can't see it.
  const [sessionMode, setSessionMode] = useState<'workspace' | 'dedicated'>('workspace');
  const [linkSessionToken, setLinkSessionToken] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute the token override the wizard uses for source-fetches. When
  // the user picked the dedicated session path AND has typed a PAT, every
  // probe / list call routes through THAT token instead of the workspace
  // session. Trimmed because pasted tokens often carry trailing newlines.
  const tokenOverride =
    sessionMode === 'dedicated' && linkSessionToken.trim() ? linkSessionToken.trim() : undefined;

  // Fetch the user's accessible repos when the modal opens, AND whenever
  // the dedicated token changes — switching session mode or pasting a
  // different PAT must surface a different repo set.
  useEffect(() => {
    if (!open || manualMode) return;
    // Switching to dedicated mode with no token yet → clear the workspace's
    // repos from the dropdown so the user doesn't pick a repo their
    // dedicated PAT can't access. Re-fetches once the token lands.
    if (sessionMode === 'dedicated' && !tokenOverride) {
      setRepos(null);
      setReposError(null);
      setSelectedRepo(null);
      return;
    }
    let cancelled = false;
    setLoadingRepos(true);
    setReposError(null);
    setRepos(null);
    listAccessibleRepos(tokenOverride ? { tokenOverride } : undefined)
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
  }, [open, manualMode, sessionMode, tokenOverride, listAccessibleRepos, surfaceMissingScope]);

  // Fetch branches whenever the user picks a repo.
  useEffect(() => {
    if (!selectedRepo) {
      setBranches(null);
      setSelectedBranch('');
      return;
    }
    let cancelled = false;
    setLoadingBranches(true);
    setBranchesError(null);
    setBranches(null);
    listRepoBranches(
      selectedRepo.owner,
      selectedRepo.name,
      tokenOverride ? { tokenOverride } : undefined,
    )
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
        // Default to the repo's default branch when present, else first.
        const preferred =
          list.find((b) => b.name === selectedRepo.defaultBranch)?.name ?? list[0]?.name ?? '';
        setSelectedBranch(preferred);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error) setBranchesError(err.message);
        else setBranchesError('Failed to load branches');
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, tokenOverride, listRepoBranches]);

  // Probe workspace.json on the selected branch — populates the pin
  // dropdown. Returning null means the branch has no workspace.json,
  // which we surface as a soft error so the Link button can be disabled.
  useEffect(() => {
    if (!selectedRepo || !selectedBranch) {
      setProbe(null);
      return;
    }
    let cancelled = false;
    setLoadingProbe(true);
    setProbeError(null);
    setProbe(null);
    setPinChoice('currentVersion');
    setSpecificPin('');
    probeLinkedRepoVersions(
      selectedRepo.owner,
      selectedRepo.name,
      selectedBranch,
      tokenOverride ? { tokenOverride } : undefined,
    )
      .then((result) => {
        if (cancelled) return;
        setProbe(result);
        if (!result) {
          setProbeError(
            `No workspace.json on ${selectedRepo.owner}/${selectedRepo.name}@${selectedBranch}.`,
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error) setProbeError(err.message);
        else setProbeError('Failed to probe workspace.json');
      })
      .finally(() => {
        if (!cancelled) setLoadingProbe(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectedBranch, tokenOverride, probeLinkedRepoVersions]);

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

  const reset = () => {
    setSelectedRepo(null);
    setBranches(null);
    setSelectedBranch('');
    setProbe(null);
    setPinChoice('currentVersion');
    setSpecificPin('');
    setFilter('');
    setShowRepoList(false);
    setManualMode(false);
    setManualRepo('');
    setManualBranch('main');
    setManualPin('');
    setSessionMode('workspace');
    setLinkSessionToken('');
    setSecretValues({});
    setError(null);
  };

  const guidedReady =
    !manualMode &&
    Boolean(selectedRepo) &&
    Boolean(selectedBranch) &&
    probe !== null &&
    !loadingProbe;

  const manualReady = manualMode && manualRepo.trim().includes('/') && manualBranch.trim();

  // Dedicated session mode requires a token before we can submit — without
  // it the store action would throw, and a disabled-button UX is clearer
  // than letting the user click and bounce off an error.
  const sessionReady = sessionMode === 'workspace' || linkSessionToken.trim().length > 0;

  const submitDisabled = (manualMode ? !manualReady : !guidedReady) || !sessionReady || submitting;

  const linkArgs = (): {
    repoFullName: string;
    branch: string;
    pinnedVersion?: string;
    sessionMode: 'workspace' | 'dedicated';
    linkSessionToken?: string;
    secretValues?: Record<string, string>;
  } => {
    const sessionFields =
      sessionMode === 'dedicated'
        ? { sessionMode: 'dedicated' as const, linkSessionToken: linkSessionToken.trim() }
        : { sessionMode: 'workspace' as const };
    // Filter to only the values the user actually filled in. Empty
    // strings are skipped server-side too, but pruning here keeps the
    // confirm dialog summary honest.
    const trimmedSecrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(secretValues)) {
      if (v.trim()) trimmedSecrets[k] = v;
    }
    const secretField =
      Object.keys(trimmedSecrets).length > 0 ? { secretValues: trimmedSecrets } : {};
    if (manualMode) {
      return {
        repoFullName: manualRepo.trim(),
        branch: manualBranch.trim(),
        pinnedVersion: manualPin.trim() || undefined,
        ...sessionFields,
        ...secretField,
      };
    }
    const fullName = `${selectedRepo!.owner}/${selectedRepo!.name}`;
    const pinnedVersion =
      pinChoice === 'specific' && specificPin ? specificPin : (probe?.currentVersion ?? undefined);
    return {
      repoFullName: fullName,
      branch: selectedBranch,
      pinnedVersion,
      ...sessionFields,
      ...secretField,
    };
  };

  const onSubmit = () => {
    if (submitDisabled) return;
    setError(null);
    setConfirmOpen(true);
  };

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      await linkPrivateWorkspace(linkArgs());
      setConfirmOpen(false);
      reset();
      onClose();
    } catch (err) {
      setConfirmOpen(false);
      if (err instanceof MissingScopeError) {
        onClose();
        surfaceMissingScope(err.missingScopes);
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

  const args = manualMode || guidedReady ? linkArgs() : null;

  return (
    <>
      <Modal open={open} onClose={onClose} title="Link a private workspace">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.6875rem] text-text-dim">
              Reads <code>workspace.json</code> from the source branch using your active GitHub
              session. The cached release ledger is stored under <code>releases.perLink[id]</code>.
            </p>
            <button
              type="button"
              onClick={() => {
                setManualMode((v) => !v);
                setError(null);
              }}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[0.625rem] text-text-muted hover:border-border-strong hover:text-text-primary"
              aria-label={manualMode ? 'Switch to repo browser' : 'Switch to manual entry'}
            >
              <Pencil size={10} />
              {manualMode ? 'Browse repos' : 'Manual entry'}
            </button>
          </div>

          {manualMode ? (
            <ManualLinkInputs
              repo={manualRepo}
              setRepo={setManualRepo}
              branch={manualBranch}
              setBranch={setManualBranch}
              pin={manualPin}
              setPin={setManualPin}
            />
          ) : (
            <>
              <RepoCombobox
                loading={loadingRepos}
                error={reposError}
                filter={filter}
                setFilter={setFilter}
                showList={showRepoList}
                setShowList={setShowRepoList}
                repos={filteredRepos}
                selectedRepo={selectedRepo}
                onPick={(r) => {
                  setSelectedRepo(r);
                  setShowRepoList(false);
                  setFilter('');
                }}
                onClear={() => {
                  setSelectedRepo(null);
                  setShowRepoList(false);
                  setFilter('');
                }}
              />
              {selectedRepo && (
                <BranchPicker
                  loading={loadingBranches}
                  error={branchesError}
                  branches={branches}
                  selected={selectedBranch}
                  onPick={setSelectedBranch}
                  defaultBranch={selectedRepo.defaultBranch}
                />
              )}
              {selectedRepo && selectedBranch && (
                <PinPicker
                  loading={loadingProbe}
                  error={probeError}
                  probe={probe}
                  pinChoice={pinChoice}
                  onPinChoiceChange={setPinChoice}
                  specificPin={specificPin}
                  onSpecificPinChange={setSpecificPin}
                />
              )}
              {probe && (
                <RequiredSecretKeysPicker
                  keys={probe.requiredSecretKeys}
                  values={secretValues}
                  onChange={setSecretValues}
                />
              )}
            </>
          )}

          <LinkSessionPicker
            mode={sessionMode}
            onModeChange={setSessionMode}
            token={linkSessionToken}
            onTokenChange={setLinkSessionToken}
          />

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
              disabled={submitDisabled}
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
          args ? (
            <p>
              About to link <code>{args.repoFullName}</code>@<code>{args.branch}</code>
              {args.pinnedVersion ? (
                <>
                  {' '}
                  pinned at <code>v{args.pinnedVersion}</code>
                </>
              ) : (
                ' (unpinned — tracks the source workspace’s latest)'
              )}
              .
            </p>
          ) : (
            <p>Loading…</p>
          )
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
  const surfaceMissingScope = useWorkspaceStore((s) => s.surfaceMissingScope);
  const previewLinkedUpdateForLink = useWorkspaceStore((s) => s.previewLinkedUpdateForLink);
  const clearLinkedOverridesFor = useWorkspaceStore((s) => s.clearLinkedOverridesFor);
  const overrideCount = useWorkspaceStore((s) => {
    if (!s.synced) return 0;
    let n = 0;
    for (const o of Object.values(s.synced.linkedOverrides.requests)) {
      if (o.linkedWorkspaceId === link.id) n += 1;
    }
    for (const o of Object.values(s.synced.linkedOverrides.environmentVars)) {
      if (o.linkedWorkspaceId === link.id) n += 1;
    }
    return n;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
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
      if (err instanceof MissingScopeError) {
        surfaceMissingScope(err.missingScopes);
      } else if (err instanceof Error) {
        setRefreshError(err.message);
      } else {
        setRefreshError('Refresh failed');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const onReviewUpdate = async () => {
    setPreviewing(true);
    setRefreshError(null);
    try {
      await previewLinkedUpdateForLink(link.id);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        surfaceMissingScope(err.missingScopes);
      } else if (err instanceof Error) {
        setRefreshError(err.message);
      } else {
        setRefreshError('Preview failed');
      }
    } finally {
      setPreviewing(false);
    }
  };

  const updatesAvailable =
    ledger?.currentVersion !== undefined &&
    ledger?.currentVersion !== null &&
    ledger.currentVersion !== link.pinnedVersion;

  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-text-primary">
        <Package size={14} className="text-accent" aria-hidden="true" />
        <span className="font-medium">{link.name}</span>
        <span className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-text-muted">
          {link.kind}
        </span>
        {updatesAvailable && (
          <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-warning">
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
        <dd className="flex flex-wrap items-center gap-2 text-text-primary">
          {link.pinnedVersion ? (
            <>
              <code
                aria-label={`Pinned to v${link.pinnedVersion}`}
                className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.6875rem] text-accent"
              >
                v{link.pinnedVersion}
              </code>
              {(() => {
                // Surface the source-side flags for the pinned version.
                // Replaces the per-option `· deprecated` / `· withdrawn`
                // markers we used to render inside the (now-removed) pin
                // dropdown — without these badges, a consumer pinned to
                // a deprecated or yanked version had no signal to act on.
                const entry = ledger?.versions.find((v) => v.version === link.pinnedVersion);
                if (!entry) return null;
                return (
                  <>
                    {entry.deprecated && (
                      <span
                        className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-warning"
                        title="The source workspace marked this version deprecated. Plan a move to a newer release."
                      >
                        deprecated
                      </span>
                    )}
                    {entry.yanked && (
                      <span
                        className="rounded-sm border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-danger"
                        title="The source workspace withdrew this version (typically due to a defect). Move to a newer release."
                      >
                        withdrawn
                      </span>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <span className="text-[0.6875rem] text-text-dim">Unpinned (tracks source HEAD)</span>
          )}
          <span className="text-[0.625rem] text-text-dim">
            (set at link time — use Refresh ledger &rarr; Review update &rarr; Apply to pull a newer
            release)
          </span>
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

      <LinkCardSessionStatus link={link} />

      <RequiredKeysSection link={link} />

      <div className="mt-3 flex flex-wrap gap-2">
        {updatesAvailable && (
          <button
            type="button"
            onClick={() => void onReviewUpdate()}
            disabled={previewing}
            aria-label={`Review update to v${ledger?.currentVersion}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-warning/40 bg-warning/10 px-3 text-xs text-warning hover:bg-warning/20 disabled:opacity-50"
          >
            <ArrowDown size={11} />
            {previewing ? 'Loading preview…' : `Review update → v${ledger?.currentVersion}`}
          </button>
        )}
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
        {overrideCount > 0 && (
          <button
            type="button"
            onClick={() => setDiscardAllOpen(true)}
            aria-label={`Discard all ${overrideCount} local modification${overrideCount === 1 ? '' : 's'} for ${link.name}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-danger/40 hover:text-danger"
          >
            <RotateCcw size={11} />
            Discard {overrideCount} mod{overrideCount === 1 ? '' : 's'}
          </button>
        )}
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
        open={discardAllOpen}
        title={`Discard all modifications for ${link.name}?`}
        tone="danger"
        confirmLabel="Discard all"
        description={
          <p>
            Drops every request and env-var override for this linked workspace. The pinned version
            is unchanged. This cannot be undone.
          </p>
        }
        onCancel={() => setDiscardAllOpen(false)}
        onConfirm={() => {
          clearLinkedOverridesFor(link.id);
          setDiscardAllOpen(false);
        }}
      />

      <LinkedChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
        link={link}
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

      <LinkedRequestsList linkId={link.id} />
    </div>
  );
}

function LinkedRequestsList({ linkId }: { linkId: string }) {
  const snapshot = useWorkspaceStore((s) => s.local?.linkedCollections[linkId] ?? null);
  const overrides = useWorkspaceStore((s) => s.synced?.linkedOverrides.requests ?? {});
  const setActiveLinkedRequest = useWorkspaceStore((s) => s.setActiveLinkedRequest);
  const [open, setOpen] = useState(false);
  const requests = snapshot ? Object.values(snapshot.collections.requests) : [];
  if (requests.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border-subtle pt-3 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-text-muted hover:text-text-primary"
      >
        {open ? '▾' : '▸'} Browse requests ({requests.length})
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1">
          {requests.map((req) => {
            const overridden = `${linkId}:${req.id}` in overrides;
            return (
              <li key={req.id}>
                <button
                  type="button"
                  onClick={() =>
                    setActiveLinkedRequest({ linkedWorkspaceId: linkId, itemId: req.id })
                  }
                  className="flex w-full items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1 text-left text-text-primary hover:border-border-strong"
                >
                  <span className="text-[0.625rem] uppercase text-text-dim">{req.method}</span>
                  <span className="flex-1 truncate font-mono">{req.name}</span>
                  {overridden && (
                    <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-accent">
                      override
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
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

  // Skip the body when the modal isn't open so we don't pay (or crash) on
  // children evaluation — Modal returns null on `open=false` but JSX
  // children are computed eagerly before being passed to it.
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={`${link.name} — changelog`} className="max-w-5xl">
      <div className="space-y-2">
        <p className="text-[0.6875rem] text-text-dim">
          Cached from{' '}
          <code>
            {link.source.repoFullName}@{link.source.branch}
          </code>{' '}
          at the last refresh. Refresh the ledger to pull newly-published versions.
        </p>
        {sortedEntries.length === 0 ? (
          <p className="text-[0.6875rem] text-text-dim">
            No published versions in the cached ledger.
          </p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {sortedEntries.map((entry) => {
              const isPinned = entry.version === link.pinnedVersion;
              return (
                <li key={entry.version} className="rounded-sm border border-border bg-surface p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs text-text-primary">v{entry.version}</code>
                    {isPinned && (
                      <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-accent">
                        pinned
                      </span>
                    )}
                    {entry.deprecated && (
                      <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-warning">
                        deprecated
                      </span>
                    )}
                    {entry.yanked && (
                      <span
                        className="rounded-sm border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-danger"
                        title="This version was withdrawn by the source workspace."
                      >
                        withdrawn
                      </span>
                    )}
                    <span className="ml-auto text-[0.625rem] text-text-dim">
                      {new Date(entry.publishedAt).toLocaleString()}
                    </span>
                  </div>
                  {entry.notes ? (
                    <p className="mt-1 whitespace-pre-wrap text-[0.6875rem] text-text-muted">
                      {entry.notes}
                    </p>
                  ) : (
                    <p className="mt-1 text-[0.6875rem] text-text-dim italic">no release notes</p>
                  )}
                  {entry.workspaceSnapshot && (
                    <p
                      className="mt-1 font-mono text-[0.625rem] text-text-dim"
                      title={entry.workspaceSnapshot}
                    >
                      snapshot {entry.workspaceSnapshot.slice(0, 12)}…
                    </p>
                  )}
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

function RepoCombobox({
  loading,
  error,
  filter,
  setFilter,
  showList,
  setShowList,
  repos,
  selectedRepo,
  onPick,
  onClear,
}: {
  loading: boolean;
  error: string | null;
  filter: string;
  setFilter: (v: string) => void;
  showList: boolean;
  setShowList: (v: boolean) => void;
  repos: GitHubRepo[];
  selectedRepo: GitHubRepo | null;
  onPick: (r: GitHubRepo) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <label htmlFor="link-repo-combobox" className="block text-[0.6875rem] text-text-dim">
        Repository
      </label>
      {selectedRepo ? (
        <div className="mt-1 flex items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-2 py-1.5 text-xs">
          <Package size={11} className="shrink-0 text-accent" aria-hidden="true" />
          <code className="flex-1 truncate font-mono text-text-primary">
            {selectedRepo.fullName}
          </code>
          <span className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-[0.625rem] text-text-dim">
            {selectedRepo.visibility}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Change repository"
            className="text-[0.625rem] text-text-dim hover:text-text-primary"
          >
            Change
          </button>
        </div>
      ) : (
        // Wrap input + listbox so onBlur of the input can detect whether
        // focus moved to one of the listbox <button>s — that's the only
        // case where we keep the list open. Anywhere else and we close.
        <div
          className="relative mt-1"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setShowList(false);
            }
          }}
        >
          <input
            id="link-repo-combobox"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              if (!showList) setShowList(true);
            }}
            onFocus={() => setShowList(true)}
            placeholder={
              loading ? 'Loading your repositories…' : 'Filter accessible repos by name or owner…'
            }
            aria-label="Filter accessible repos"
            aria-controls="link-repo-options"
            aria-expanded={showList}
            role="combobox"
            disabled={loading}
            className="h-8 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
          />
          {showList && repos.length > 0 && (
            <ul
              id="link-repo-options"
              role="listbox"
              className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-sm border border-border bg-card shadow-elevated"
            >
              {repos.map((r) => (
                <li key={r.fullName}>
                  <button
                    type="button"
                    onClick={() => onPick(r)}
                    role="option"
                    aria-label={`Pick ${r.fullName}`}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface hover:text-text-primary"
                  >
                    <code className="flex-1 truncate font-mono">{r.fullName}</code>
                    <span className="shrink-0 rounded-sm border border-border bg-surface px-1 py-0.5 text-[0.625rem] text-text-dim">
                      {r.visibility}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showList && !loading && repos.length === 0 && filter.trim().length > 0 && (
            <p className="mt-1 text-[0.6875rem] text-text-dim">No repos match.</p>
          )}
        </div>
      )}
      {error && (
        <p className="mt-1 text-[0.6875rem] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function BranchPicker({
  loading,
  error,
  branches,
  selected,
  onPick,
  defaultBranch,
}: {
  loading: boolean;
  error: string | null;
  branches: GitHubBranch[] | null;
  selected: string;
  onPick: (b: string) => void;
  defaultBranch: string;
}) {
  return (
    <div>
      <label htmlFor="link-branch-select" className="block text-[0.6875rem] text-text-dim">
        Branch
      </label>
      {loading ? (
        <p className="mt-1 text-[0.6875rem] text-text-dim">Loading branches…</p>
      ) : error ? (
        <p className="mt-1 text-[0.6875rem] text-danger" role="alert">
          {error}
        </p>
      ) : branches && branches.length > 0 ? (
        <div className="relative mt-1">
          <select
            id="link-branch-select"
            value={selected}
            onChange={(e) => onPick(e.target.value)}
            aria-label="Pick a branch"
            className="h-8 w-full appearance-none rounded-sm border border-border bg-surface px-2 pr-7 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.name === defaultBranch ? ' · default' : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-faint"
          />
        </div>
      ) : (
        <p className="mt-1 text-[0.6875rem] text-text-dim">No branches found.</p>
      )}
    </div>
  );
}

function PinPicker({
  loading,
  error,
  probe,
  pinChoice,
  onPinChoiceChange,
  specificPin,
  onSpecificPinChange,
}: {
  loading: boolean;
  error: string | null;
  probe: {
    workspaceName: string;
    versions: string[];
    currentVersion: string | null;
    requiredSecretKeys: SecretKeyMeta[];
  } | null;
  pinChoice: 'currentVersion' | 'specific';
  onPinChoiceChange: (c: 'currentVersion' | 'specific') => void;
  specificPin: string;
  onSpecificPinChange: (v: string) => void;
}) {
  const sortedVersions = useMemo(() => (probe ? sortVersionsDesc(probe.versions) : []), [probe]);

  if (loading) {
    return <p className="text-[0.6875rem] text-text-dim">Probing workspace.json on this branch…</p>;
  }
  if (error) {
    return (
      <p className="text-[0.6875rem] text-danger" role="alert">
        {error}
      </p>
    );
  }
  if (!probe) return null;

  return (
    <div className="rounded-sm border border-border-subtle bg-surface p-2">
      <p className="mb-1.5 text-[0.6875rem] text-text-dim">
        Source workspace: <strong className="text-text-primary">{probe.workspaceName}</strong>
        {probe.currentVersion && (
          <span className="ml-2 rounded-sm border border-border bg-card px-1 py-0.5 font-mono text-[0.625rem]">
            currentVersion v{probe.currentVersion}
          </span>
        )}
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Pin version</legend>
        <label className="flex items-center gap-1.5 text-[0.6875rem] text-text-muted">
          <input
            type="radio"
            name="pin-choice"
            value="currentVersion"
            checked={pinChoice === 'currentVersion'}
            onChange={() => onPinChoiceChange('currentVersion')}
            aria-label="Pin to source currentVersion"
            style={{ accentColor: 'rgb(var(--accent))' }}
          />
          {probe.currentVersion
            ? `Pin to currentVersion (v${probe.currentVersion})`
            : 'Track latest (source has no published versions yet)'}
        </label>
        <label className="flex items-center gap-1.5 text-[0.6875rem] text-text-muted">
          <input
            type="radio"
            name="pin-choice"
            value="specific"
            checked={pinChoice === 'specific'}
            onChange={() => onPinChoiceChange('specific')}
            disabled={sortedVersions.length === 0}
            aria-label="Pin to a specific version"
            style={{ accentColor: 'rgb(var(--accent))' }}
          />
          Pin to a specific version
          {sortedVersions.length === 0 && (
            <span className="text-[0.625rem] text-text-dim">(no published versions)</span>
          )}
        </label>
        {pinChoice === 'specific' && sortedVersions.length > 0 && (
          <select
            value={specificPin || sortedVersions[0]}
            onChange={(e) => onSpecificPinChange(e.target.value)}
            aria-label="Specific version to pin"
            className="ml-5 h-7 rounded-sm border border-border bg-card px-2 font-mono text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
          >
            {sortedVersions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
        )}
      </fieldset>
    </div>
  );
}

/**
 * Surfaces the source workspace's referenced secret-key slots so the
 * user can supply values at link-time. Discovered automatically by the
 * probe — only slots that are actually referenced by an encrypted env
 * variable show up here. Empty values are fine: the slot just stays
 * "missing" until provisioned later from the link card.
 */
function RequiredSecretKeysPicker({
  keys,
  values,
  onChange,
}: {
  keys: SecretKeyMeta[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  // Discoverable empty state — when the source has no `secretKeys`
  // registry, users were left guessing whether the section was
  // intentional or broken. Tell them what to check upstream.
  if (keys.length === 0) {
    return (
      <div className="rounded-sm border border-border-subtle bg-surface p-2">
        <div className="mb-1 flex items-center gap-2">
          <Key size={12} className="text-text-dim" aria-hidden="true" />
          <h4 className="text-[0.6875rem] font-medium text-text-primary">Required secret keys</h4>
          <span className="text-[0.625rem] text-text-dim">none declared by source</span>
        </div>
        <p className="text-[0.6875rem] leading-snug text-text-dim">
          The source workspace.json doesn&apos;t declare any vault slots. If you expected to see one
          here, the source may need to push first (slots aren&apos;t synced until pushed) or the
          slot may have been removed from the source&apos;s vault. You can still add required keys
          manually from the link card after linking.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-sm border border-warning/30 bg-warning/5 p-2">
      <div className="mb-1 flex items-center gap-2">
        <Key size={12} className="text-warning" aria-hidden="true" />
        <h4 className="text-[0.6875rem] font-medium text-text-primary">Required secret keys</h4>
        <span className="text-[0.625rem] text-text-dim">
          {keys.length} slot{keys.length === 1 ? '' : 's'} declared by source
        </span>
      </div>
      <p className="mb-2 text-[0.6875rem] text-text-dim">
        The source workspace declares these vault slots. Provide values now, or skip and fill in
        later from the link card. Empty values are fine — leave a slot blank if your usage
        doesn&apos;t need it.
      </p>
      <ul className="space-y-1.5">
        {keys.map((meta) => {
          const reveal = revealed[meta.id] === true;
          return (
            <li key={meta.id} className="flex items-center gap-2">
              <code
                className="w-32 shrink-0 truncate text-[0.6875rem] text-text-primary"
                title={meta.id}
              >
                {meta.label || meta.id}
              </code>
              <input
                type={reveal ? 'text' : 'password'}
                value={values[meta.id] ?? ''}
                onChange={(e) => onChange({ ...values, [meta.id]: e.target.value })}
                placeholder="Skip to fill later"
                aria-label={`Value for ${meta.label || meta.id}`}
                className="h-7 flex-1 rounded-sm border border-border bg-card px-2 font-mono text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setRevealed((prev) => ({ ...prev, [meta.id]: !reveal }))}
                aria-label={
                  reveal
                    ? `Hide value for ${meta.label || meta.id}`
                    : `Reveal value for ${meta.label || meta.id}`
                }
                className="inline-flex h-6 items-center rounded-sm border border-border bg-card px-2 text-[0.625rem] text-text-muted hover:border-border-strong hover:text-text-primary"
              >
                {reveal ? 'Hide' : 'Show'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ManualLinkInputs({
  repo,
  setRepo,
  branch,
  setBranch,
  pin,
  setPin,
}: {
  repo: string;
  setRepo: (v: string) => void;
  branch: string;
  setBranch: (v: string) => void;
  pin: string;
  setPin: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label htmlFor="link-repo-input" className="block text-[0.6875rem] text-text-dim">
          Repo full name
        </label>
        <input
          id="link-repo-input"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="org/payments-api"
          aria-label="Linked repo full name"
          className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="link-branch-input" className="block text-[0.6875rem] text-text-dim">
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
          <label htmlFor="link-pin-input" className="block text-[0.6875rem] text-text-dim">
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
    </>
  );
}

function RequiredKeysSection({ link }: { link: LinkedWorkspace }) {
  // Pull the source's secretKeys registry from the cached snapshot so
  // rows can render slot labels instead of raw ids. May be undefined
  // for older snapshots — rows fall back to the id in that case.
  const sourceSecretKeys = useWorkspaceStore(
    (s) => s.local?.linkedCollections[link.id]?.secretKeys,
  );

  return (
    <section className="mt-3 rounded-sm border border-border-subtle bg-surface p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Key size={12} className="text-text-dim" aria-hidden="true" />
        <h3 className="text-[0.6875rem] font-medium uppercase tracking-wider text-text-dim">
          Required secret keys
        </h3>
        <span className="text-[0.625rem] text-text-dim">
          auto-discovered from source on link / refresh
        </span>
      </div>
      {link.requiredSecretKeyIds.length === 0 ? (
        <p className="text-[0.6875rem] text-text-dim">
          The source workspace doesn&apos;t declare any vault slots. If you expected to see one
          here, push the source workspace and click <em>Refresh ledger</em> on this card.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {link.requiredSecretKeyIds.map((keyId) => (
            <RequiredKeyRow
              key={keyId}
              link={link}
              keyId={keyId}
              sourceMeta={sourceSecretKeys?.[keyId]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequiredKeyRow({
  link,
  keyId,
  sourceMeta,
}: {
  link: LinkedWorkspace;
  keyId: string;
  sourceMeta?: SecretKeyMeta;
}) {
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

  // Render the human label from the source registry. The raw slot id
  // is exposed only via the row's `title` attribute (hover) — the card
  // surface stays clean. Falls back to the id when the snapshot
  // doesn't carry the source's secretKeys (older link / older source).
  const primary = sourceMeta?.label && sourceMeta.label.trim() ? sourceMeta.label : keyId;

  return (
    <li
      className="flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5"
      title={primary !== keyId ? `Slot id: ${keyId}` : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.6875rem] text-text-primary">{primary}</div>
      </div>
      <span
        className={
          provisionedId
            ? 'rounded-sm border border-success/40 bg-success/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-success'
            : 'rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-warning'
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
            className="h-6 w-32 rounded-sm border border-border bg-surface px-1.5 font-mono text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
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
            className="inline-flex h-6 items-center rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.625rem] text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue('');
            }}
            className="text-[0.625rem] text-text-dim hover:text-text-muted"
          >
            cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex h-6 items-center rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-border-strong hover:text-text-primary"
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
        <span className="text-[0.625rem] text-danger" role="alert">
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

/**
 * Session picker shown inside the Link wizard. Two radio choices:
 *
 *   - **Use workspace session** (default) — fetches with the same PAT
 *     that pushes/pulls THIS workspace. Free, no extra step.
 *   - **Add a dedicated session** — collects a per-link PAT (verified at
 *     submit time). Use when the source repo lives under a different
 *     account that the workspace session can't reach.
 *
 * The PAT input only appears when 'dedicated' is selected. The component
 * is purely controlled — the modal owns the state and threads both fields
 * into `linkPrivateWorkspace({ sessionMode, linkSessionToken })`.
 */
function LinkSessionPicker({
  mode,
  onModeChange,
  token,
  onTokenChange,
}: {
  mode: 'workspace' | 'dedicated';
  onModeChange: (mode: 'workspace' | 'dedicated') => void;
  token: string;
  onTokenChange: (token: string) => void;
}) {
  return (
    <fieldset className="rounded-sm border border-border bg-surface px-3 py-2">
      <legend className="px-1 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
        Session for this link
      </legend>
      <div className="flex flex-col gap-1.5 text-xs">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="link-session-mode"
            checked={mode === 'workspace'}
            onChange={() => onModeChange('workspace')}
            className="mt-0.5 accent-accent"
          />
          <div>
            <div className="text-text-primary">Use workspace session</div>
            <div className="text-[0.6875rem] text-text-dim">
              Reuses the PAT that pushes / pulls this workspace. Pick this when both repos are on
              the same account.
            </div>
          </div>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="link-session-mode"
            checked={mode === 'dedicated'}
            onChange={() => onModeChange('dedicated')}
            className="mt-0.5 accent-accent"
          />
          <div className="min-w-0 flex-1">
            <div className="text-text-primary">Add a dedicated session</div>
            <div className="text-[0.6875rem] text-text-dim">
              Bind a separate PAT to this link only — required when the source repo lives under a
              different account.
            </div>
            {mode === 'dedicated' && (
              <input
                type="password"
                value={token}
                onChange={(e) => onTokenChange(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                aria-label="Dedicated linking session PAT"
                className="mt-1.5 h-7 w-full rounded-sm border border-border bg-card px-2 font-mono text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
              />
            )}
          </div>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * Per-link session status badge + remap UI.
 *
 * Surfaces three states:
 *   1. **OK · workspace** — the link uses the workspace session and one
 *      exists. Shows a small badge; no actions.
 *   2. **OK · dedicated** — the link has its own session; shows the bound
 *      account login + "Update token" / "Use workspace session" actions.
 *   3. **Orphaned** — the link expects a session that's missing locally
 *      (workspace session disconnected for a `mode='workspace'` link, or
 *      dedicated session removed for a `mode='dedicated'` link). Shows a
 *      red banner with "Reconnect" / "Use workspace session" actions —
 *      clicking through fixes the link without unlinking.
 */
function LinkCardSessionStatus({ link }: { link: LinkedWorkspace }) {
  const workspaceSession = useWorkspaceStore((s) => s.local?.sessions.github.workspace ?? null);
  const linkSession = useWorkspaceStore((s) => s.local?.sessions.github.links[link.id] ?? null);
  const addLinkSession = useWorkspaceStore((s) => s.addLinkSession);
  const removeLinkSession = useWorkspaceStore((s) => s.removeLinkSession);
  const setLinkSessionMode = useWorkspaceStore((s) => s.setLinkSessionMode);

  const mode = link.source.sessionMode ?? 'workspace';

  // Auto-recover the common false-alarm: a link is metadata-marked
  // `dedicated` but its dedicated session is gone, AND a healthy
  // workspace session exists. We silently flip the link back to
  // 'workspace' mode so the banner doesn't fire on every render.
  // (The user can still re-add a dedicated session from this card if
  // their source repo really lives under a different account.)
  useEffect(() => {
    if (mode === 'dedicated' && !linkSession && workspaceSession) {
      void setLinkSessionMode(link.id, 'workspace');
    }
  }, [mode, linkSession, workspaceSession, link.id, setLinkSessionMode]);

  const orphaned =
    (mode === 'workspace' && !workspaceSession) || (mode === 'dedicated' && !linkSession);

  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await addLinkSession(link.id, token);
      setToken('');
      setEditing(false);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`Token is missing required scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to save token');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const switchToWorkspace = async () => {
    if (!workspaceSession) return;
    if (linkSession) await removeLinkSession(link.id);
    await setLinkSessionMode(link.id, 'workspace');
  };

  return (
    <section className="mt-3 space-y-2">
      {orphaned ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-sm border border-danger/40 bg-danger/10 p-3 text-[0.6875rem] text-danger"
        >
          <div className="flex items-center gap-2 font-medium">
            <ShieldAlert size={12} aria-hidden="true" />
            {mode === 'workspace'
              ? 'Workspace session disconnected — this link cannot fetch updates until you reconnect it or remap to a dedicated session.'
              : 'Dedicated session removed — this link cannot fetch updates until you reconnect it or switch to the workspace session.'}
          </div>
          {!editing ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-danger/40 bg-danger/20 px-2.5 text-[0.6875rem] text-danger hover:bg-danger/30"
              >
                <Key size={11} />
                {mode === 'dedicated' ? 'Reconnect dedicated session' : 'Add dedicated session'}
              </button>
              {mode === 'dedicated' && workspaceSession && (
                <button
                  type="button"
                  onClick={() => void switchToWorkspace()}
                  className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-2.5 text-[0.6875rem] text-text-muted hover:border-border-strong hover:text-text-primary"
                >
                  Use workspace session instead
                </button>
              )}
            </div>
          ) : (
            <DedicatedTokenForm
              token={token}
              onTokenChange={setToken}
              submitting={submitting}
              error={error}
              onCancel={() => {
                setEditing(false);
                setError(null);
                setToken('');
              }}
              onSave={onSave}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-text-muted">
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-success/30 bg-success/10 px-1.5 py-0.5 text-success"
            title={
              mode === 'dedicated'
                ? `Bound to dedicated session @${linkSession?.accountLogin}`
                : `Uses workspace session @${workspaceSession?.accountLogin}`
            }
          >
            <Key size={10} aria-hidden="true" />
            {mode === 'dedicated'
              ? `dedicated · @${linkSession?.accountLogin ?? 'unknown'}`
              : `workspace · @${workspaceSession?.accountLogin ?? 'unknown'}`}
          </span>
          {!editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex h-6 items-center rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-border-strong hover:text-text-primary"
              >
                {mode === 'dedicated' ? 'Update token' : 'Switch to dedicated session'}
              </button>
              {mode === 'dedicated' && (
                <button
                  type="button"
                  onClick={() => void switchToWorkspace()}
                  disabled={!workspaceSession}
                  title={
                    !workspaceSession
                      ? 'Connect a workspace session first.'
                      : 'Drop the dedicated PAT and route this link through the workspace session.'
                  }
                  className="inline-flex h-6 items-center rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
                >
                  Use workspace session
                </button>
              )}
            </>
          ) : (
            <DedicatedTokenForm
              token={token}
              onTokenChange={setToken}
              submitting={submitting}
              error={error}
              onCancel={() => {
                setEditing(false);
                setError(null);
                setToken('');
              }}
              onSave={onSave}
            />
          )}
        </div>
      )}
    </section>
  );
}

function DedicatedTokenForm({
  token,
  onTokenChange,
  submitting,
  error,
  onCancel,
  onSave,
}: {
  token: string;
  onTokenChange: (v: string) => void;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <input
        type="password"
        value={token}
        onChange={(e) => onTokenChange(e.target.value)}
        placeholder="ghp_… or github_pat_…"
        aria-label="Dedicated linking session PAT"
        className="h-7 w-full rounded-sm border border-border bg-card px-2 font-mono text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
      />
      {error && (
        <p className="text-[0.625rem] text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={submitting || !token.trim()}
          className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-[0.6875rem] text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {submitting ? 'Verifying…' : 'Save token'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-[0.6875rem] text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
