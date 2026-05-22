import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, Folder, RefreshCw, Terminal } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { formatRelativeTime } from '../../primitives/relativeTime';
import { HowToConnect } from './HowToConnect';
import { getDesktopMcpBridge, getDesktopWorkspaceFileBridge } from '../../desktop/bridge';

// =============================================================================
// ConnectionSection — the unified MCP tab. Two blocks under one heading:
//
//   1. Set up your AI client — the four-step install/wire/restart/verify
//      flow (delegates to <HowToConnect />).
//   2. Workspace mirror — live mirror path, the binary AI clients spawn,
//      and a Refresh that re-reads the on-disk workspace so CLI / MCP
//      edits show up without a restart.
//
// Setup goes first because that's the new-user journey; once you're wired
// up, the mirror block is the surface you'll come back to.
// =============================================================================

export function ConnectionSection() {
  const mcpBridge = getDesktopMcpBridge();
  const wsFileBridge = getDesktopWorkspaceFileBridge();
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const refreshFromDisk = useWorkspaceStore((s) => s.refreshFromDisk);
  const syncedUpdatedAt = useWorkspaceStore((s) => s.synced?.meta.updatedAt ?? null);

  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [binary, setBinary] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Prefer the workspace-file bridge for the dir (it's the multi-
        // workspace registry root the mirror actually writes to); fall back
        // to the MCP bridge's `workspaceDir` if the workspace-file surface
        // isn't wired (older preload, future renderer-only host).
        if (wsFileBridge) {
          const { workspacesRoot } = await wsFileBridge.status();
          if (!cancelled) setWorkspaceDir(workspacesRoot);
        }
        if (mcpBridge) {
          const s = await mcpBridge.status();
          if (cancelled) return;
          setBinary(s.binary);
          if (!wsFileBridge) setWorkspaceDir(s.workspaceDir);
        }
        setStatusError(null);
      } catch (err) {
        if (cancelled) return;
        setStatusError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mcpBridge, wsFileBridge]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await refreshFromDisk();
      setLastRefreshedAt(new Date().toISOString());
      switch (result.kind) {
        case 'no-mirror':
          pushToast({
            tone: 'info',
            title: 'Disk mirror not available',
            detail: 'Refresh only works in the desktop build.',
          });
          break;
        case 'no-file':
          pushToast({
            tone: 'info',
            title: 'No on-disk workspace yet',
            detail: 'The mirror writes its first snapshot when you make a change.',
          });
          break;
        case 'up-to-date':
          pushToast({ tone: 'success', title: 'Already up to date' });
          break;
        case 'updated':
          pushToast({
            tone: 'success',
            title: 'Workspace refreshed from disk',
            detail: `On-disk update at ${formatRelativeTime(result.importedAt)}.`,
          });
          break;
        case 'merged':
          pushToast({
            tone: 'success',
            title: 'On-disk content merged in',
            detail: `Imported ${result.importedRequestIds.length} request(s) and ${result.importedFolderIds.length} folder(s).`,
          });
          break;
        case 'error':
          pushToast({
            tone: 'error',
            title: 'Refresh failed',
            detail: result.message,
          });
          break;
      }
    } finally {
      setRefreshing(false);
    }
  };

  const refreshSupported = !!wsFileBridge;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      {/* Block 1 — Set up your AI client */}
      <section className="flex flex-col gap-4">
        <header>
          <h2 className="text-base font-medium text-text-primary">Set up your AI client</h2>
          <p className="mt-1 text-xs text-text-muted">
            Wire any MCP-compatible AI client to this workspace in four steps. The desktop app
            mirrors your workspace to disk on every change, so no separate import step is needed.
          </p>
        </header>
        <HowToConnect />
      </section>

      <hr className="border-border-subtle" aria-hidden="true" />

      {/* Block 2 — Workspace mirror */}
      <section className="flex flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-text-primary">Workspace mirror</h2>
            <p className="mt-1 text-xs text-text-muted">
              The desktop app mirrors your workspace to disk so the CLI and MCP can read and write
              it. Use Refresh to pull in any edits the CLI or MCP made since you last opened this
              app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={!refreshSupported || refreshing}
            aria-label="Refresh from disk"
            title={
              refreshSupported
                ? 'Re-read workspace.synced.json from disk and merge any newer changes'
                : 'Refresh is only available in the desktop build'
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[0.6875rem] text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw
              size={11}
              aria-hidden="true"
              className={refreshing ? 'animate-spin' : undefined}
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </header>

        {statusError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Could not load mirror status: {statusError}</span>
          </div>
        )}

        <InfoRow
          icon={<Folder size={14} aria-hidden="true" />}
          label="Workspace mirror"
          value={workspaceDir}
          emptyLabel={mcpBridge ? 'Loading…' : 'Unavailable on web'}
          copyable
          onCopy={() => pushToast({ tone: 'success', title: 'Mirror path copied' })}
          footer={
            syncedUpdatedAt ? `In-memory updated ${formatRelativeTime(syncedUpdatedAt)}` : undefined
          }
        />

        <InfoRow
          icon={<Terminal size={14} aria-hidden="true" />}
          label="MCP binary"
          value={binary}
          emptyLabel={mcpBridge ? 'Loading…' : 'Unavailable on web'}
          footer={
            binary
              ? 'AI clients spawn this command. Install with: npm install -g @apicircle/mcp-server'
              : undefined
          }
        />

        {lastRefreshedAt && (
          <p className="text-right text-[0.625rem] text-text-dim">
            Last refreshed {formatRelativeTime(lastRefreshedAt)}
          </p>
        )}
      </section>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  emptyLabel,
  copyable,
  onCopy,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  emptyLabel: string;
  copyable?: boolean;
  onCopy?: () => void;
  footer?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="rounded-sm border border-border-subtle bg-card p-4">
      <header className="mb-2 flex items-center gap-2 text-text-muted">
        {icon}
        <h3 className="text-xs font-medium uppercase tracking-wider">{label}</h3>
      </header>
      <div className="flex items-start justify-between gap-3">
        {value ? (
          <code className="select-all break-all rounded-sm border border-border bg-surface px-2 py-1 text-[0.75rem] text-text-primary">
            {value}
          </code>
        ) : (
          <span className="text-[0.75rem] text-text-dim">{emptyLabel}</span>
        )}
        {/* Copy is only rendered when there's a value to copy. Showing a
            disabled Copy next to a "Loading…" / "Unavailable" placeholder
            is visual noise — the affordance has nothing to do until the
            path actually resolves. */}
        {copyable && value && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={`Copy ${label}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-2 py-1 text-[0.6875rem] text-text-muted hover:border-accent hover:text-accent"
          >
            <Copy size={10} aria-hidden="true" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      {footer && <p className="mt-2 text-[0.625rem] text-text-dim">{footer}</p>}
    </section>
  );
}
