import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Info } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { safeCopyToClipboard } from '../../primitives/clipboard';
import { MCP_CLIENTS } from './clients';
import {
  getDesktopMcpBridge,
  type ConfigSnippetVariants,
  type McpInstallState,
} from '../../desktop/bridge';
import { MonacoEditorBase } from '../../editors/MonacoEditorBase';

// =============================================================================
// HowToConnect — the four-step setup block (install → pick client + copy
// snippet → restart → verify). Renders inside ConnectionSection; owns no
// page-level chrome (no max-width wrapper, no top-level h2) — its parent
// composes it alongside the Workspace mirror block.
// =============================================================================

const DEFAULT_CLIENT_ID = 'claude-desktop';

/**
 * Coerce whatever the bridge returns into the {@link ConfigSnippetVariants}
 * shape. Tolerates a legacy preload returning a bare string (older desktop
 * build whose `dist/main/preload.js` hasn't been rebuilt against the current
 * renderer) — without this normalization the renderer would set
 * `variants = "{...}"`, then `variants.forwardSlash` would be `undefined`,
 * and the editor would silently render "(loading…)" forever.
 */
function normalizeSnippetResponse(raw: unknown): ConfigSnippetVariants {
  if (typeof raw === 'string') {
    return { forwardSlash: raw, escaped: raw, identical: true };
  }
  return raw as ConfigSnippetVariants;
}

export function HowToConnect() {
  const bridge = getDesktopMcpBridge();
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const pickedClient = useWorkspaceStore((s) => s.mcpHowToConnectClient);
  const setPickedClient = useWorkspaceStore((s) => s.setMcpHowToConnectClient);
  const activeClientId = pickedClient ?? DEFAULT_CLIENT_ID;

  const [variants, setVariants] = useState<ConfigSnippetVariants | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installState, setInstallState] = useState<McpInstallState | null>(null);

  const canInstall = !!bridge?.installConfig;

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      try {
        const promises: [Promise<ConfigSnippetVariants>, Promise<string | null>] = [
          bridge.getConfigSnippet(activeClientId),
          bridge.getConfigPath(activeClientId),
        ];
        const [s, p] = await Promise.all(promises);
        if (cancelled) return;
        setVariants(normalizeSnippetResponse(s));
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

  useEffect(() => {
    if (!bridge?.detectInstallState) {
      setInstallState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const state = await bridge.detectInstallState(activeClientId);
        if (!cancelled) setInstallState(state);
      } catch {
        if (!cancelled) setInstallState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, activeClientId]);

  return (
    <div className="flex flex-col gap-4">
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
        title={
          canInstall
            ? 'Pick your AI client and install'
            : 'Pick your AI client and copy the snippet'
        }
        body={
          <div className="flex flex-col gap-3">
            <ClientPicker activeClientId={activeClientId} onPick={setPickedClient} />
            {configPath && (
              <p className="text-[0.6875rem] text-text-dim">
                Config file: <code className="rounded-sm bg-surface px-1">{configPath}</code>
              </p>
            )}
            {canInstall && (
              <InstallButton
                clientId={activeClientId}
                installState={installState}
                onInstall={async () => {
                  if (!bridge) return;
                  try {
                    const result = await bridge.installConfig(activeClientId);
                    setInstallState('installed-current');
                    if (result.outcome === 'created') {
                      pushToast({
                        tone: 'success',
                        title: 'MCP config installed',
                        detail: `Created ${result.path}`,
                      });
                    } else if (result.outcome === 'updated') {
                      pushToast({
                        tone: 'success',
                        title: 'MCP config updated',
                        detail: `Updated ${result.path}`,
                      });
                    } else {
                      pushToast({ tone: 'info', title: 'MCP config already up to date' });
                    }
                  } catch (err) {
                    const detail = err instanceof Error ? err.message : String(err);
                    pushToast({ tone: 'error', title: 'Install failed', detail });
                  }
                }}
              />
            )}
            <SnippetBlock
              variants={variants}
              clientId={activeClientId}
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
    const result = await safeCopyToClipboard(command);
    if (!result.ok) return;
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

const INSTALLABLE_CLIENT_IDS: ReadonlySet<string> = new Set([
  'claude-desktop',
  'claude-code',
  'codex',
  'cursor',
  'windsurf',
  'zed',
  'continue',
]);

function InstallButton({
  clientId,
  installState,
  onInstall,
}: {
  clientId: string;
  installState: McpInstallState | null;
  onInstall: () => Promise<void>;
}) {
  const [installing, setInstalling] = useState(false);

  if (!INSTALLABLE_CLIENT_IDS.has(clientId)) {
    return (
      <p className="text-[0.6875rem] text-text-dim">
        This client requires manual setup — copy the snippet below and paste it into the config
        file.
      </p>
    );
  }

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstall();
    } finally {
      setInstalling(false);
    }
  };

  const isInstalled = installState === 'installed-current';
  const isStale = installState === 'installed-stale';

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void handleInstall()}
        disabled={installing}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors',
          isInstalled
            ? 'border-green-600/40 bg-green-600/10 text-green-500'
            : isStale
              ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20'
              : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20',
          installing && 'opacity-60',
        )}
      >
        {installing ? (
          <>Installing...</>
        ) : isInstalled ? (
          <>
            <Check size={12} aria-hidden="true" />
            Installed
          </>
        ) : isStale ? (
          <>
            <Download size={12} aria-hidden="true" />
            Update config
          </>
        ) : (
          <>
            <Download size={12} aria-hidden="true" />
            Install config
          </>
        )}
      </button>
      {isInstalled && <span className="text-[0.6875rem] text-text-dim">Config is up to date</span>}
      {isStale && <span className="text-[0.6875rem] text-warning">Config needs updating</span>}
    </div>
  );
}

function SnippetBlock({
  variants,
  clientId,
  bridgeAvailable,
  loadError,
  onCopySuccess,
}: {
  variants: ConfigSnippetVariants | null;
  clientId: string;
  bridgeAvailable: boolean;
  loadError: string | null;
  onCopySuccess: () => void;
}) {
  const isToml = clientId === 'codex';
  // The renderer shows ONE snippet — the forward-slash form. It's valid
  // JSON, reads cleanly without `\\` clutter, and Windows / Node / Electron
  // all accept forward-slash paths. The escaped-backslash form is shown as
  // a secondary reference below for the rare case an AI client refuses
  // forward slashes on Windows. On macOS / Linux the two forms are
  // byte-identical (`identical: true`), so the reference block is hidden.
  const [copied, setCopied] = useState(false);
  const snippet = variants?.forwardSlash ?? '';
  const showEscapedReference = !!variants && !variants.identical;
  const emptyMessage = loadError
    ? `(could not load: ${loadError})`
    : bridgeAvailable
      ? '(loading…)'
      : '(open the desktop build to see the snippet)';

  const handleCopy = async () => {
    if (!snippet) return;
    const result = await safeCopyToClipboard(snippet);
    if (!result.ok) return;
    setCopied(true);
    onCopySuccess();
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-sm border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
          <span className="text-[0.625rem] uppercase tracking-wider text-text-dim">
            {isToml ? 'TOML snippet' : 'JSON snippet'}
          </span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!snippet}
            aria-label="Copy snippet"
            className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[0.6875rem] text-text-primary hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {copied ? (
              <Check size={10} aria-hidden="true" />
            ) : (
              <Copy size={10} aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {snippet ? (
          <MonacoEditorBase
            value={snippet}
            language={isToml ? 'plaintext' : 'json'}
            readOnly
            minHeight={180}
            ariaLabel="MCP config snippet"
            options={{
              lineNumbers: 'off',
              folding: false,
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
              overviewRulerLanes: 0,
              minimap: { enabled: false },
              wordWrap: 'on',
              padding: { top: 8, bottom: 8 },
            }}
          />
        ) : (
          <p className="px-3 py-3 text-[0.6875rem] text-text-dim">{emptyMessage}</p>
        )}
      </div>

      {showEscapedReference && variants && (
        <EscapedReference
          escapedSnippet={variants.escaped}
          isToml={isToml}
          onCopySuccess={onCopySuccess}
        />
      )}
    </div>
  );
}

// Shown on Windows hosts only (paths contain backslashes). Documents why the
// main snippet uses forward slashes, and offers the escaped-backslash form as
// an escape hatch if a particular AI client's JSON parser rejects forward
// slashes in the workspace path.
function EscapedReference({
  escapedSnippet,
  isToml,
  onCopySuccess,
}: {
  escapedSnippet: string;
  isToml?: boolean;
  onCopySuccess: () => void;
}) {
  const formatName = isToml ? 'TOML' : 'JSON';
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const result = await safeCopyToClipboard(escapedSnippet);
    if (!result.ok) return;
    setCopied(true);
    onCopySuccess();
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <details className="group rounded-sm border border-border-subtle bg-card">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-start gap-2 rounded-sm px-3 py-2 text-[0.6875rem] text-text-muted',
          'hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        )}
      >
        <Info size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-text-dim" />
        <span className="flex-1">
          <strong className="font-medium text-text-primary">
            Windows: snippet above uses forward slashes
          </strong>{' '}
          (e.g. <code className="rounded-sm bg-surface px-1">C:/Users/&hellip;</code>) — valid{' '}
          {formatName}
          and accepted by Windows, Node, and Electron. If your AI client rejects it, expand for the
          escaped-backslash form.
        </span>
      </summary>
      <div className="border-t border-border-subtle px-3 py-2 text-[0.6875rem] text-text-muted">
        <p className="mb-2">
          <strong className="font-medium text-text-primary">Why the `\\` escapes?</strong>{' '}
          {formatName} uses <code className="rounded-sm bg-surface px-1">\</code> as the
          string-escape character, so a literal Windows path like{' '}
          <code className="rounded-sm bg-surface px-1">C:\Users\me</code> must be written as{' '}
          <code className="rounded-sm bg-surface px-1">{'"C:\\\\Users\\\\me"'}</code> inside a{' '}
          {formatName}
          string. Forward slashes avoid this entirely.
        </p>
        <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-[0.6875rem] text-text-primary">
          <code className="select-all break-all">{escapedSnippet}</code>
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy escaped snippet"
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[0.6875rem] text-text-muted hover:border-accent hover:text-accent"
          >
            {copied ? (
              <Check size={10} aria-hidden="true" />
            ) : (
              <Copy size={10} aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy escaped'}
          </button>
        </div>
      </div>
    </details>
  );
}
