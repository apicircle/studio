import { useEffect, useState } from 'react';
import { Bot, Copy, AlertTriangle } from 'lucide-react';

// =============================================================================
// McpServerPanel — surfaces the config snippet users paste into their AI
// client (Claude Desktop, Cursor, Continue, etc) so the client can spawn the
// `apicircle-mcp` stdio binary against this workspace.
//
// We do NOT spawn the MCP server from the desktop app. Each AI client owns
// its own MCP child-process lifecycle. This panel exists to make that
// integration one click away.
// =============================================================================

interface DesktopMcpBridge {
  status: () => Promise<{ workspaceDir: string; binary: string }>;
  getConfigSnippet: (client: string) => Promise<string>;
  getConfigPath: (client: string) => Promise<string | null>;
  toolCatalog: () => Promise<readonly string[]>;
}

const CLIENTS: Array<{ id: string; label: string }> = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'github-copilot', label: 'GitHub Copilot' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'continue', label: 'Continue' },
  { id: 'cline', label: 'Cline' },
  { id: 'zed', label: 'Zed' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'generic', label: 'Generic stdio' },
];

function getMcpBridge(): DesktopMcpBridge | null {
  const w = window as unknown as { apicircleDesktop?: { mcp?: DesktopMcpBridge } };
  return w.apicircleDesktop?.mcp ?? null;
}

export function McpServerPanel() {
  const bridge = getMcpBridge();
  const [client, setClient] = useState<string>('claude-desktop');
  const [snippet, setSnippet] = useState<string>('');
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [tools, setTools] = useState<readonly string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const load = async () => {
      const [s, p, t] = await Promise.all([
        bridge.getConfigSnippet(client),
        bridge.getConfigPath(client),
        bridge.toolCatalog(),
      ]);
      if (cancelled) return;
      setSnippet(s);
      setConfigPath(p);
      setTools(t);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bridge, client]);

  const handleCopy = async () => {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-baseline gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="text-lg font-medium text-text-primary">MCP Server</h1>
        <p className="text-[11px] text-text-dim">
          Connect any MCP-compatible AI client to this workspace via stdio.
        </p>
      </header>

      {!bridge && (
        <div className="border-b border-border-subtle bg-card/50 px-6 py-3 text-xs text-text-muted">
          <div className="mx-auto flex max-w-2xl items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              MCP integration is available in the <strong>Desktop App</strong>. The web build cannot
              expose a stdio server. Install the desktop build (P29), or run
              <code className="mx-1 rounded-sm border border-border px-1 text-[10px]">
                npx @apicircle/cli mcp
              </code>
              from any terminal to point your AI client at a workspace folder.
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-2xl space-y-5">
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
              Pick your AI client
            </h2>
            <select
              value={client}
              onChange={(e) => setClient(e.target.value)}
              disabled={!bridge}
              aria-label="AI client"
              className="h-8 w-full rounded-sm border border-border bg-card px-2 text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-40"
            >
              {CLIENTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {configPath && (
              <p className="mt-2 text-[11px] text-text-dim">
                Default config path: <code>{configPath}</code>
              </p>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Paste this snippet
              </h2>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!bridge || !snippet}
                className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-card-hover disabled:opacity-40"
              >
                <Copy size={10} aria-hidden="true" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-sm border border-border bg-card px-3 py-2 text-[11px] text-text-primary">
              {snippet || '(snippet shown after the desktop bridge loads)'}
            </pre>
          </section>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-muted">
              <Bot size={12} aria-hidden="true" />
              Tool catalog ({tools.length})
            </h2>
            <ul className="grid grid-cols-2 gap-1 text-[11px] text-text-muted">
              {tools.map((t) => (
                <li key={t} className="rounded-sm border border-border-subtle px-2 py-1">
                  {t}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
