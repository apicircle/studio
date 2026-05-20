import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, XCircle } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { formatRelativeTime } from '../../primitives/relativeTime';
import { cn } from '../../primitives/cn';
import { MCP_CLIENTS } from './clients';

// =============================================================================
// McpServerPanel — surfaces the config snippet users paste into their AI
// client (Claude Desktop, Cursor, Continue, etc) so the client can spawn the
// `apicircle-mcp` stdio binary against this workspace.
//
// The panel renders one snippet card per supported client so the user can
// see, compare, and copy each variant without having to switch a dropdown.
// The companion sidebar (McpSidebar) lists clients; clicking one scrolls
// the matching card into view and highlights it.
//
// We do NOT spawn the MCP server from the desktop app. Each AI client owns
// its own MCP child-process lifecycle. This panel exists to make that
// integration one click away.
// =============================================================================

/**
 * Per-client connection status, surfaced from the desktop bridge.
 * `lastHandshakeAt` is the ISO timestamp the AI client last handshook
 * with the MCP server (or null if it never has). `lastError` is the
 * most recent transport / handshake error string; `null` when healthy.
 *
 * Optional fields on the bridge — older builds may not implement them;
 * the UI degrades gracefully ("(desktop bridge does not yet expose status)").
 */
export interface McpClientStatus {
  connected: boolean;
  lastHandshakeAt: string | null;
  lastError: string | null;
}

interface DesktopMcpBridge {
  status: () => Promise<{ workspaceDir: string; binary: string }>;
  getConfigSnippet: (client: string) => Promise<string>;
  getConfigPath: (client: string) => Promise<string | null>;
  /**
   * Optional — return the latest known per-client connection status.
   * The UI polls this every few seconds AND honors `subscribeStatus`
   * when present for push-style updates. Both can coexist.
   */
  getClientStatus?: (client: string) => Promise<McpClientStatus>;
  /**
   * Optional — push channel for status updates. Returns an unsubscribe
   * fn. When implemented, the panel skips polling.
   */
  subscribeStatus?: (callback: (clientId: string, status: McpClientStatus) => void) => () => void;
  /**
   * Optional — request the desktop daemon to drop and re-establish the
   * stdio connection for the given client. Returns the post-reconnect
   * status so the UI can update without waiting for the next poll tick.
   */
  reconnect?: (client: string) => Promise<McpClientStatus>;
}

function getMcpBridge(): DesktopMcpBridge | null {
  const w = window as unknown as { apicircleDesktop?: { mcp?: DesktopMcpBridge } };
  return w.apicircleDesktop?.mcp ?? null;
}

interface ClientPayload {
  snippet: string;
  configPath: string | null;
}

const STATUS_POLL_INTERVAL_MS = 5_000;

export function McpServerPanel() {
  const bridge = getMcpBridge();
  const focusedClient = useWorkspaceStore((s) => s.mcpFocusedClient);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [payloads, setPayloads] = useState<Record<string, ClientPayload>>({});
  // Bridge load failure surface — kept inline so the user sees it within
  // the MCP panel even after dismissing the toast.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-client connection status, keyed by client id. Populated by
  // getClientStatus polling + subscribeStatus push channel when the
  // bridge supports them; otherwise stays empty and the cards show a
  // "no status available" hint.
  const [statuses, setStatuses] = useState<Record<string, McpClientStatus>>({});
  const [reconnecting, setReconnecting] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const load = async () => {
      try {
        const entries = await Promise.all(
          MCP_CLIENTS.map(async (c) => {
            const [snippet, configPath] = await Promise.all([
              bridge.getConfigSnippet(c.id),
              bridge.getConfigPath(c.id),
            ]);
            return [c.id, { snippet, configPath }] as const;
          }),
        );
        if (cancelled) return;
        setPayloads(Object.fromEntries(entries));
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setLoadError(detail);
        pushToast({
          tone: 'error',
          title: 'Could not load MCP config snippets',
          detail,
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bridge, pushToast]);

  // Per-client status: prefer push (subscribeStatus) when available, else
  // fall back to polling getClientStatus every STATUS_POLL_INTERVAL_MS.
  // Bridges that implement neither are silently skipped — the cards then
  // render their "no status" hint.
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;

    const apply = (clientId: string, status: McpClientStatus) => {
      if (cancelled) return;
      setStatuses((prev) => ({ ...prev, [clientId]: status }));
    };

    if (bridge.subscribeStatus) {
      const unsubscribe = bridge.subscribeStatus(apply);
      // Pull current state once on subscribe so we don't wait for the
      // first event to populate the UI.
      if (bridge.getClientStatus) {
        for (const c of MCP_CLIENTS) {
          void bridge
            .getClientStatus(c.id)
            .then((s) => apply(c.id, s))
            .catch(() => {});
        }
      }
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    if (!bridge.getClientStatus) return;
    const poll = async () => {
      for (const c of MCP_CLIENTS) {
        try {
          const status = await bridge.getClientStatus!(c.id);
          apply(c.id, status);
        } catch {
          // Skip on per-client failure — the next tick retries.
        }
      }
    };
    void poll();
    const id = setInterval(() => void poll(), STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bridge]);

  const onReconnect = async (clientId: string): Promise<void> => {
    if (!bridge?.reconnect) return;
    setReconnecting((prev) => new Set(prev).add(clientId));
    try {
      const status = await bridge.reconnect(clientId);
      setStatuses((prev) => ({ ...prev, [clientId]: status }));
      pushToast({
        tone: status.connected ? 'success' : 'error',
        title: status.connected ? `Reconnected ${clientId}` : `Reconnect failed for ${clientId}`,
        detail: status.lastError ?? undefined,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: `Reconnect failed for ${clientId}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setReconnecting((prev) => {
        const next = new Set(prev);
        next.delete(clientId);
        return next;
      });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-baseline gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="text-lg font-medium text-text-primary">MCP Server</h1>
        <p className="text-[0.6875rem] text-text-dim">
          Connect any MCP-compatible AI client to this workspace via stdio.
        </p>
      </header>

      {!bridge && (
        <div className="border-b border-border-subtle bg-card/50 px-6 py-3 text-xs text-text-muted">
          <div className="mx-auto flex max-w-2xl items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              MCP integration is available in the <strong>Desktop App</strong>. The web build cannot
              expose a stdio server. Install the desktop build, or run
              <code className="mx-1 rounded-sm border border-border px-1 text-[0.625rem]">
                npx @apicircle/cli mcp
              </code>
              from any terminal to point your AI client at a workspace folder.
            </span>
          </div>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="border-b border-border-subtle bg-danger/10 px-6 py-2 text-xs text-danger"
        >
          MCP config load failed: {loadError}
        </div>
      )}
      {/*
        Scrollable region — needs to be keyboard-focusable so users without a
        pointer can scroll it via the keyboard (axe `scrollable-region-focusable`).
        tabIndex=0 + an aria-label gives the region focus + a screen-reader name.
      */}
      <div
        className="flex-1 overflow-y-auto px-6 py-4 focus:outline-none focus:ring-1 focus:ring-accent/30"
        tabIndex={0}
        role="region"
        aria-label="AI client configuration snippets"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {MCP_CLIENTS.map((c) => (
            <ClientSnippetCard
              key={c.id}
              clientId={c.id}
              label={c.label}
              snippet={payloads[c.id]?.snippet ?? ''}
              configPath={payloads[c.id]?.configPath ?? null}
              focused={focusedClient === c.id}
              bridgeAvailable={!!bridge}
              status={statuses[c.id] ?? null}
              statusSupported={!!bridge?.getClientStatus || !!bridge?.subscribeStatus}
              reconnectSupported={!!bridge?.reconnect}
              reconnecting={reconnecting.has(c.id)}
              onReconnect={() => void onReconnect(c.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ClientSnippetCardProps {
  clientId: string;
  label: string;
  snippet: string;
  configPath: string | null;
  focused: boolean;
  bridgeAvailable: boolean;
  status: McpClientStatus | null;
  statusSupported: boolean;
  reconnectSupported: boolean;
  reconnecting: boolean;
  onReconnect: () => void;
}

function ClientSnippetCard({
  clientId,
  label,
  snippet,
  configPath,
  focused,
  bridgeAvailable,
  status,
  statusSupported,
  reconnectSupported,
  reconnecting,
  onReconnect,
}: ClientSnippetCardProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  // Scroll into view when this card becomes the focused one (driven from
  // the sidebar). Guard against environments (e.g. jsdom in tests) that
  // don't implement scrollIntoView.
  useEffect(() => {
    if (focused && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focused]);

  const handleCopy = async () => {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section
      ref={ref}
      id={`mcp-client-${clientId}`}
      className={cn(
        'rounded-sm border bg-card p-4 transition-colors',
        focused ? 'border-accent/60' : 'border-border-subtle',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</h2>
          <ClientStatusPill status={status} supported={statusSupported && bridgeAvailable} />
        </div>
        <div className="flex items-center gap-2">
          {reconnectSupported && bridgeAvailable && (
            <button
              type="button"
              onClick={onReconnect}
              disabled={reconnecting}
              aria-label={`Reconnect ${label}`}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[0.6875rem] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <RefreshCw
                size={10}
                aria-hidden="true"
                className={reconnecting ? 'animate-spin' : undefined}
              />
              {reconnecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!bridgeAvailable || !snippet}
            className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[0.6875rem] text-text-primary hover:border-accent hover:text-accent disabled:opacity-40"
          >
            <Copy size={10} aria-hidden="true" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {configPath && (
        <p className="mb-2 text-[0.625rem] text-text-dim">
          Default config path: <code>{configPath}</code>
        </p>
      )}
      {status?.lastError && (
        <p
          role="alert"
          className="mb-2 inline-flex items-center gap-1 rounded-sm border border-danger/30 bg-danger/5 px-2 py-1 text-[0.625rem] text-danger"
        >
          <XCircle size={10} aria-hidden="true" />
          Last error: {status.lastError}
        </p>
      )}
      <pre className="overflow-x-auto rounded-sm border border-border bg-surface px-3 py-2 text-[0.6875rem] text-text-primary">
        {snippet ||
          (bridgeAvailable
            ? '(snippet shown after the desktop bridge loads)'
            : '(desktop bridge not connected)')}
      </pre>
    </section>
  );
}

function ClientStatusPill({
  status,
  supported,
}: {
  status: McpClientStatus | null;
  supported: boolean;
}) {
  if (!supported) {
    return (
      <span
        className="inline-flex h-5 items-center rounded-sm border border-border bg-surface px-1.5 text-[0.5625rem] uppercase tracking-wider text-text-dim"
        title="This bridge build doesn't expose live status. Reconnect by restarting your AI client."
      >
        status n/a
      </span>
    );
  }
  if (!status) {
    return (
      <span className="inline-flex h-5 items-center rounded-sm border border-border bg-surface px-1.5 text-[0.5625rem] uppercase tracking-wider text-text-dim">
        loading…
      </span>
    );
  }
  if (status.connected) {
    return (
      <span
        className="inline-flex h-5 items-center gap-1 rounded-sm border border-success/40 bg-success/10 px-1.5 text-[0.5625rem] uppercase tracking-wider text-success"
        title={
          status.lastHandshakeAt
            ? `Last handshake ${formatRelativeTime(status.lastHandshakeAt)}`
            : undefined
        }
      >
        <CheckCircle2 size={9} aria-hidden="true" />
        Connected
        {status.lastHandshakeAt && (
          <span className="text-text-muted">· {formatRelativeTime(status.lastHandshakeAt)}</span>
        )}
      </span>
    );
  }
  if (status.lastHandshakeAt) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-1.5 text-[0.5625rem] uppercase tracking-wider text-warning">
        <XCircle size={9} aria-hidden="true" />
        Disconnected · last seen {formatRelativeTime(status.lastHandshakeAt)}
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-border bg-surface px-1.5 text-[0.5625rem] uppercase tracking-wider text-text-dim">
      Never connected
    </span>
  );
}
