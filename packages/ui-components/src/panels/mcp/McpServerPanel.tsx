import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
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

interface DesktopMcpBridge {
  status: () => Promise<{ workspaceDir: string; binary: string }>;
  getConfigSnippet: (client: string) => Promise<string>;
  getConfigPath: (client: string) => Promise<string | null>;
}

function getMcpBridge(): DesktopMcpBridge | null {
  const w = window as unknown as { apicircleDesktop?: { mcp?: DesktopMcpBridge } };
  return w.apicircleDesktop?.mcp ?? null;
}

interface ClientPayload {
  snippet: string;
  configPath: string | null;
}

export function McpServerPanel() {
  const bridge = getMcpBridge();
  const focusedClient = useWorkspaceStore((s) => s.mcpFocusedClient);
  const [payloads, setPayloads] = useState<Record<string, ClientPayload>>({});

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const load = async () => {
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
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

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

      <div className="flex-1 overflow-y-auto px-6 py-4">
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
}

function ClientSnippetCard({
  clientId,
  label,
  snippet,
  configPath,
  focused,
  bridgeAvailable,
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
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</h2>
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
      {configPath && (
        <p className="mb-2 text-[0.625rem] text-text-dim">
          Default config path: <code>{configPath}</code>
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
