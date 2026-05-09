import { useEffect, useState } from 'react';
import { AlertTriangle, Play, Plus, Server, Square, Trash2 } from 'lucide-react';
import type { MockRuntimeEntry, MockServer } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MockEndpointEditor } from './MockEndpointEditor';
import { CreateMockServerModal } from './CreateMockServerModal';

// =============================================================================
// MockServersPanel — split pane: the sidebar (handled by Sidebar.tsx for the
// 'mocks' panel) selects a server + endpoint; this pane renders the
// MockEndpointEditor for the active endpoint or a server-level summary
// when only a server is selected. Mirrors the Editor panel shape so
// users have one mental model across the app.
//
// Runtime gating: Start / Stop are still desktop-only; CRUD on
// definitions is portable across web / desktop / CLI.
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
  const activeServerId = useWorkspaceStore((s) => s.activeMockServerId);
  const activeEndpointId = useWorkspaceStore((s) => s.activeMockEndpointId);
  const setActiveMockEndpoint = useWorkspaceStore((s) => s.setActiveMockEndpoint);
  const openCreateModal = useWorkspaceStore((s) => s.openMocksCreateModal);

  const activeServer = activeServerId ? mockServers[activeServerId] : null;
  const activeEndpoint =
    activeServer && activeEndpointId
      ? (activeServer.endpoints.find((e) => e.id === activeEndpointId) ?? null)
      : null;

  // Auto-select the first mock server on entry. `activeMockServerId` is a
  // session field (not persisted), so it starts null after every reload —
  // without this the user lands on an empty NoSelection screen even when
  // servers exist. Re-runs if the active id points at a deleted server
  // (covers the Delete-current → fall-through case as well).
  useEffect(() => {
    if (activeServer) return;
    const first = Object.values(mockServers)[0];
    if (first) setActiveMockEndpoint({ serverId: first.id, endpointId: null });
  }, [activeServer, mockServers, setActiveMockEndpoint]);

  const bridge = getMockBridge();
  const [running, setRunning] = useState<Record<string, MockRuntimeEntry>>({});
  const [error, setError] = useState<string | null>(null);

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

  const serverList = Object.values(mockServers);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      {!bridge && serverList.length > 0 && (
        <div className="border-b border-border-subtle bg-card/50 px-6 py-2 text-[11px] text-text-muted">
          <div className="mx-auto flex max-w-3xl items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              Definitions can be created and edited here. Running them needs the Desktop App or{' '}
              <code className="rounded-sm bg-surface px-1 py-0.5 font-mono">
                apicircle mock run &lt;id&gt;
              </code>
              .
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="border-b border-border-subtle bg-danger/10 px-6 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {activeEndpoint && activeServer ? (
        <MockEndpointEditor server={activeServer} endpoint={activeEndpoint} />
      ) : activeServer ? (
        <ServerSummary
          server={activeServer}
          runtime={running[activeServer.id]}
          bridge={bridge}
          onStart={() => void handleStart(activeServer)}
          onStop={() => void handleStop(activeServer.id)}
        />
      ) : (
        <NoSelection empty={serverList.length === 0} onCreate={openCreateModal} />
      )}

      <CreateMockServerModal />
    </div>
  );
}

function NoSelection({ empty, onCreate }: { empty: boolean; onCreate: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 pt-16 text-center text-text-dim">
      <Server size={28} aria-hidden="true" />
      {empty ? (
        <>
          <p className="text-sm text-text-primary">No mock servers yet.</p>
          <p className="max-w-md text-xs text-text-muted">
            Create a definition by typing endpoints manually or by pasting an OpenAPI / Postman /
            Insomnia spec. Run the mock from the Desktop App or via{' '}
            <code className="rounded-sm bg-card px-1 py-0.5 font-mono">
              apicircle mock run &lt;id&gt;
            </code>
            .
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
          >
            Create your first mock server
          </button>
        </>
      ) : (
        <p className="text-xs text-text-muted">
          Pick an endpoint from the sidebar to edit it, or click + on a server to add a new one.
        </p>
      )}
    </div>
  );
}

function ServerSummary({
  server,
  runtime,
  bridge,
  onStart,
  onStop,
}: {
  server: MockServer;
  runtime: MockRuntimeEntry | undefined;
  bridge: DesktopMockBridge | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const setMockServerName = useWorkspaceStore((s) => s.setMockServerName);
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div>
        <label htmlFor="mock-server-name" className="block text-[11px] text-text-dim">
          Mock server name
        </label>
        <input
          id="mock-server-name"
          value={server.name}
          onChange={(e) => setMockServerName(server.id, e.target.value)}
          aria-label="Mock server name"
          className="mt-1 h-8 w-full max-w-md rounded-sm border border-border bg-card px-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      <dl className="grid max-w-md grid-cols-[140px_1fr] gap-y-1 text-xs">
        <dt className="text-text-dim">Source kind</dt>
        <dd className="text-text-primary">{server.source.kind}</dd>
        <dt className="text-text-dim">Endpoints</dt>
        <dd className="text-text-primary">{server.endpoints.length}</dd>
        <dt className="text-text-dim">Default port</dt>
        <dd className="text-text-primary">{server.defaultPort ?? 'auto'}</dd>
      </dl>
      <CorsSection server={server} />
      <div className="flex items-center gap-2">
        {runtime ? (
          <>
            <span className="rounded-sm border border-success/50 bg-success/10 px-2 py-0.5 text-[11px] text-success">
              running · port {runtime.port}
            </span>
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[11px] text-text-muted hover:bg-card-hover"
            >
              <Square size={10} aria-hidden="true" />
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={!bridge}
            title={
              bridge
                ? `Start ${server.name}`
                : 'Running mocks needs the Desktop App or `apicircle mock run`'
            }
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[11px] text-text-primary hover:bg-card-hover disabled:opacity-40"
          >
            <Play size={10} aria-hidden="true" />
            Start
          </button>
        )}
      </div>
    </div>
  );
}

// CORS is off by default because the runtime is meant for same-origin probing
// (the Desktop app, the CLI, or curl on localhost). The moment a browser-side
// app on a *different* port wants to hit the mock, the browser's preflight
// will block it unless the runtime sends back `Access-Control-Allow-Origin`.
// This section exposes the toggle + origin allow-list so users can opt in.
function CorsSection({ server }: { server: MockServer }) {
  const setMockServerCors = useWorkspaceStore((s) => s.setMockServerCors);
  const [draft, setDraft] = useState('');

  const setEnabled = (enabled: boolean) => {
    setMockServerCors(server.id, { enabled, origins: server.cors.origins });
  };
  const addOrigin = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (server.cors.origins.includes(trimmed)) {
      setDraft('');
      return;
    }
    setMockServerCors(server.id, {
      enabled: server.cors.enabled,
      origins: [...server.cors.origins, trimmed],
    });
    setDraft('');
  };
  const removeOrigin = (o: string) => {
    setMockServerCors(server.id, {
      enabled: server.cors.enabled,
      origins: server.cors.origins.filter((x) => x !== o),
    });
  };

  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-sm border border-border-subtle bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text-primary">CORS</p>
          <p className="text-[11px] text-text-dim">
            Off by default — same-origin only. Enable + list origins to let browser apps on other
            ports call the running mock.
          </p>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={server.cors.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="Enable CORS"
            className="h-3.5 w-3.5 cursor-pointer accent-accent"
          />
          {server.cors.enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>
      {server.cors.enabled && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOrigin();
                }
              }}
              placeholder="https://app.example.com or *"
              aria-label="Add allowed origin"
              className="h-7 flex-1 rounded-sm border border-border bg-surface px-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={addOrigin}
              disabled={!draft.trim()}
              aria-label="Add origin"
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              <Plus size={10} aria-hidden="true" />
              Add
            </button>
          </div>
          {server.cors.origins.length === 0 ? (
            <p className="text-[10px] italic text-text-dim">
              No origins yet — add at least one (or <code className="font-mono">*</code> to allow
              any) for the runtime to send CORS headers.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {server.cors.origins.map((o) => (
                <li
                  key={o}
                  className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-primary"
                >
                  {o}
                  <button
                    type="button"
                    onClick={() => removeOrigin(o)}
                    aria-label={`Remove origin ${o}`}
                    className="text-text-faint hover:text-danger"
                  >
                    <Trash2 size={9} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
