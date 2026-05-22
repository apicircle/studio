import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { MCP_CLIENTS } from './clients';

// =============================================================================
// HowToConnectSection — one-time setup instructions for wiring an AI client
// to this workspace via the local MCP server. Replaces the old "one card per
// client" loop with a single picker that swaps the snippet + config path
// inline. The four steps mirror what the docs say: install → pick client →
// paste snippet → restart and verify.
// =============================================================================

const DEFAULT_CLIENT_ID = 'claude-desktop';

interface DesktopMcpBridge {
  getConfigSnippet: (client: string) => Promise<string>;
  getConfigPath: (client: string) => Promise<string | null>;
}

function getMcpBridge(): DesktopMcpBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { apicircleDesktop?: { mcp?: DesktopMcpBridge } };
  return w.apicircleDesktop?.mcp ?? null;
}

export function HowToConnectSection() {
  const bridge = getMcpBridge();
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const pickedClient = useWorkspaceStore((s) => s.mcpHowToConnectClient);
  const setPickedClient = useWorkspaceStore((s) => s.setMcpHowToConnectClient);
  const activeClientId = pickedClient ?? DEFAULT_CLIENT_ID;

  const [snippet, setSnippet] = useState('');
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      try {
        const [s, p] = await Promise.all([
          bridge.getConfigSnippet(activeClientId),
          bridge.getConfigPath(activeClientId),
        ]);
        if (cancelled) return;
        setSnippet(s);
        setConfigPath(p);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setLoadError(detail);
        pushToast({ tone: 'error', title: 'Could not load MCP snippet', detail });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, activeClientId, pushToast]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h2 className="text-base font-medium text-text-primary">How to Connect</h2>
        <p className="mt-1 text-xs text-text-muted">
          Wire any MCP-compatible AI client to this workspace in four steps. The desktop app mirrors
          your workspace to disk on every change, so no separate import step is needed.
        </p>
      </header>

      <StepCard
        number={1}
        title="Install the apicircle-mcp binary"
        body={
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-muted">
              The published binary lives on npm. Install it globally so every AI client can spawn it
              by name:
            </p>
            <CommandBlock command="npm install -g @apicircle/mcp-server" />
            <p className="text-[0.6875rem] text-text-dim">
              On Windows, <code className="rounded-sm bg-surface px-1">npm</code> installs three
              wrappers: <code className="rounded-sm bg-surface px-1">apicircle-mcp</code> (POSIX),{' '}
              <code className="rounded-sm bg-surface px-1">apicircle-mcp.cmd</code> (Windows), and{' '}
              <code className="rounded-sm bg-surface px-1">apicircle-mcp.ps1</code> (PowerShell). If
              your AI client spawns the binary directly and fails to find it, use{' '}
              <code className="rounded-sm bg-surface px-1">apicircle-mcp.cmd</code> as the command
              instead — Windows <code className="rounded-sm bg-surface px-1">CreateProcess</code>{' '}
              does not follow PATHEXT.
            </p>
          </div>
        }
      />

      <StepCard
        number={2}
        title="Pick your AI client and copy the snippet"
        body={
          <div className="flex flex-col gap-3">
            <ClientPicker activeClientId={activeClientId} onPick={setPickedClient} />
            {configPath && (
              <p className="text-[0.6875rem] text-text-dim">
                Paste into: <code className="rounded-sm bg-surface px-1">{configPath}</code>
              </p>
            )}
            <SnippetBlock
              snippet={snippet}
              bridgeAvailable={!!bridge}
              loadError={loadError}
              onCopySuccess={() =>
                pushToast({ tone: 'success', title: 'Snippet copied to clipboard' })
              }
            />
          </div>
        }
      />

      <StepCard
        number={3}
        title="Restart your AI client"
        body={
          <p className="text-xs text-text-muted">
            MCP servers are spawned at client startup, so changes to the config file only take
            effect after a quit + relaunch (or your client&rsquo;s &ldquo;reload MCP servers&rdquo;
            command, when it exists).
          </p>
        }
      />

      <StepCard
        number={4}
        title="Verify the connection"
        body={
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-muted">
              Ask your AI client this prompt — if it returns your workspace contents, the MCP
              connection is live:
            </p>
            <CommandBlock command="list my apicircle workspace requests" />
          </div>
        }
      />

      {!bridge && (
        <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            MCP setup is driven by the desktop build. The web preview shows the steps for reference,
            but the snippet preview above is empty without the desktop bridge.
          </span>
        </div>
      )}
    </div>
  );
}

function StepCard({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <section className="rounded-sm border border-border-subtle bg-card p-4">
      <header className="mb-2 flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-[0.6875rem] text-accent"
        >
          {number}
        </span>
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      </header>
      <div className="pl-8">{body}</div>
    </section>
  );
}

function ClientPicker({
  activeClientId,
  onPick,
}: {
  activeClientId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="AI client" className="flex flex-wrap gap-1.5">
      {MCP_CLIENTS.map((c) => {
        const active = c.id === activeClientId;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(c.id)}
            className={cn(
              'rounded-sm border px-2 py-1 text-[0.6875rem] transition-colors',
              active
                ? 'border-accent/60 bg-accent/10 text-accent'
                : 'border-border-subtle text-text-muted hover:border-accent/40 hover:text-text-primary',
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[0.75rem] text-text-primary">
      <code className="select-all break-all">{command}</code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label="Copy command"
        className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[0.6875rem] text-text-muted hover:border-accent hover:text-accent"
      >
        {copied ? <Check size={10} aria-hidden="true" /> : <Copy size={10} aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function SnippetBlock({
  snippet,
  bridgeAvailable,
  loadError,
  onCopySuccess,
}: {
  snippet: string;
  bridgeAvailable: boolean;
  loadError: string | null;
  onCopySuccess: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!navigator.clipboard || !snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    onCopySuccess();
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="overflow-hidden rounded-sm border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
        <span className="text-[0.625rem] uppercase tracking-wider text-text-dim">JSON snippet</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={!snippet}
          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[0.6875rem] text-text-primary hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {copied ? <Check size={10} aria-hidden="true" /> : <Copy size={10} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[0.6875rem] text-text-primary">
        {snippet ||
          (loadError
            ? `(could not load: ${loadError})`
            : bridgeAvailable
              ? '(loading…)'
              : '(open the desktop build to see the snippet)')}
      </pre>
    </div>
  );
}

// Re-export the icon so storybook / future surfaces can render the same
// external-link affordance without re-importing lucide.
export { ExternalLink };
