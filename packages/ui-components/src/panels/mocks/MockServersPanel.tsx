import { useEffect, useMemo, useState } from 'react';
import { Server, AlertTriangle, Play, Square, Trash2 } from 'lucide-react';
import type { MockServer, MockRuntimeEntry } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';

// =============================================================================
// MockServersPanel — lists workspace mock servers and (when running inside
// the Desktop app) lets the user start / stop them. In the web build the
// list still renders so users can see definitions, but every action is gated
// behind a "Available in Desktop App" banner.
// =============================================================================

interface DesktopMockBridge {
  start: (server: MockServer, opts?: { port?: number }) => Promise<MockRuntimeEntry>;
  stop: (serverId: string) => Promise<{ ok: boolean }>;
  list: () => Promise<Array<{ serverId: string; runtime: MockRuntimeEntry }>>;
  getRuntime: (serverId: string) => Promise<MockRuntimeEntry | null>;
}

function getMockBridge(): DesktopMockBridge | null {
  const w = window as unknown as { apicircleDesktop?: { mock?: DesktopMockBridge } };
  return w.apicircleDesktop?.mock ?? null;
}

export function MockServersPanel() {
  const mockServers = useWorkspaceStore((s) => s.synced?.mockServers ?? {});
  const bridge = getMockBridge();
  const [running, setRunning] = useState<Record<string, MockRuntimeEntry>>({});
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => Object.values(mockServers), [mockServers]);

  // Poll the runtime list whenever the bridge is present so the UI stays in
  // sync if a mock crashes or someone stops one from another window.
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const refresh = async () => {
      const entries = await bridge.list();
      if (cancelled) return;
      const byId: Record<string, MockRuntimeEntry> = {};
      for (const e of entries) byId[e.serverId] = e.runtime;
      setRunning(byId);
    };
    void refresh();
    const id = setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bridge]);

  const handleStart = async (server: MockServer) => {
    if (!bridge) return;
    setError(null);
    try {
      const runtime = await bridge.start(server);
      setRunning((prev) => ({ ...prev, [server.id]: runtime }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStop = async (serverId: string) => {
    if (!bridge) return;
    await bridge.stop(serverId);
    setRunning((prev) => {
      const { [serverId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-baseline gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="text-lg font-medium text-text-primary">Mock Servers</h1>
        <p className="text-[11px] text-text-dim">
          Local mocks for OpenAPI / Postman / Insomnia specs. Definitions push to git; runtime is
          per-host.
        </p>
      </header>

      {!bridge && (
        <div className="border-b border-border-subtle bg-card/50 px-6 py-3 text-xs text-text-muted">
          <div className="mx-auto flex max-w-2xl items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              Running mock servers is available in the <strong>Desktop App</strong>. The web build
              shows definitions but cannot bind a port. Install the desktop build (P29) or use the
              CLI (`npx @apicircle/cli mock`) to run them outside the browser.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="border-b border-border-subtle bg-danger/10 px-6 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {list.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 pt-12 text-center text-text-dim">
            <Server size={28} aria-hidden="true" />
            <p className="text-sm text-text-primary">No mock servers yet.</p>
            <p className="text-xs text-text-muted">
              Use the MCP <code>mock.create_from_openapi</code> tool, or import an OpenAPI / Postman
              file from the editor (Phase 2).
            </p>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl space-y-3">
            {list.map((mock) => {
              const runtime = running[mock.id];
              return (
                <li
                  key={mock.id}
                  className="rounded-sm border border-border bg-card px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-text-primary">{mock.name}</div>
                      <div className="text-[11px] text-text-dim">
                        {mock.endpoints.length} endpoints · source:&nbsp;{mock.source.kind}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {runtime ? (
                        <>
                          <span className="rounded-sm border border-success/50 px-2 py-0.5 text-[10px] text-success">
                            running · port {runtime.port}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleStop(mock.id)}
                            disabled={!bridge}
                            className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-card-hover disabled:opacity-40"
                          >
                            <Square size={10} aria-hidden="true" />
                            Stop
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleStart(mock)}
                          disabled={!bridge}
                          className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-card-hover disabled:opacity-40"
                        >
                          <Play size={10} aria-hidden="true" />
                          Start
                        </button>
                      )}
                      <button
                        type="button"
                        disabled
                        title="Delete via MCP `mock.delete` tool — UI shortcut lands in P27 polish"
                        className="inline-flex items-center gap-1 rounded-sm border border-border-subtle px-2 py-1 text-[11px] text-text-dim opacity-40"
                      >
                        <Trash2 size={10} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
