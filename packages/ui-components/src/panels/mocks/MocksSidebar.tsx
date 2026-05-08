import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, FileCode, Plus, Server, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';

// Sidebar surface for the Mocks panel — mirrors the Editor sidebar
// shape: each mock server is a collapsible group, endpoints render as
// rows beneath. Clicking an endpoint switches the main pane to the
// MockEndpointEditor for that endpoint.
//
// The "Create mock server" CTA + per-server Delete + per-endpoint Add /
// Delete all live here so the editor pane can stay focused on the
// active endpoint.

export function MocksSidebar() {
  const mockServers = useWorkspaceStore((s) => s.synced?.mockServers ?? {});
  const activeServerId = useWorkspaceStore((s) => s.activeMockServerId);
  const activeEndpointId = useWorkspaceStore((s) => s.activeMockEndpointId);
  const setActiveMockEndpoint = useWorkspaceStore((s) => s.setActiveMockEndpoint);
  const addMockEndpoint = useWorkspaceStore((s) => s.addMockEndpoint);
  const removeMockEndpoint = useWorkspaceStore((s) => s.removeMockEndpoint);
  const removeMock = useWorkspaceStore((s) => s.removeMockServer);
  const duplicateMockServer = useWorkspaceStore((s) => s.duplicateMockServer);
  const duplicateMockEndpoint = useWorkspaceStore((s) => s.duplicateMockEndpoint);
  const openCreateMockServer = useWorkspaceStore((s) => s.openMocksCreateModal);

  const servers = Object.values(mockServers);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pendingServerDelete, setPendingServerDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const toggleExpand = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const isExpanded = (id: string) => expanded[id] !== false; // default-expanded
  // Clicking a server name should both surface its overview (ServerSummary)
  // in the main pane and ensure its endpoint list is visible underneath.
  // Expand toggle stays on the chevron so users can collapse without losing
  // the active selection.
  const activateServer = (id: string) => {
    setActiveMockEndpoint({ serverId: id, endpointId: null });
    setExpanded((e) => ({ ...e, [id]: true }));
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={openCreateMockServer}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2 text-xs text-accent hover:bg-accent/20"
          aria-label="New mock server"
        >
          <Plus size={12} aria-hidden="true" />
          New mock server
        </button>
      </div>

      {servers.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border-subtle px-2 py-3 text-center text-[11px] text-text-dim">
          No mock servers yet. Create one to add endpoints.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {servers.map((server) => {
            const open = isExpanded(server.id);
            const isServerActive = activeServerId === server.id && activeEndpointId === null;
            return (
              <li key={server.id}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleExpand(server.id)}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${server.name}`}
                    aria-expanded={open}
                    className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-surface"
                  >
                    {open ? (
                      <ChevronDown size={11} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={11} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => activateServer(server.id)}
                    aria-label={`Open ${server.name}`}
                    aria-current={isServerActive ? 'true' : undefined}
                    className={
                      isServerActive
                        ? 'flex flex-1 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-1 text-left text-[11px] text-accent'
                        : 'flex flex-1 items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[11px] text-text-primary hover:bg-surface'
                    }
                  >
                    <Server size={11} className="text-accent" aria-hidden="true" />
                    <span className="flex-1 truncate font-medium">{server.name}</span>
                    {server.source.kind !== 'manual' && (
                      <FileCode
                        size={10}
                        className="text-text-faint"
                        aria-label={`${server.source.kind} spec`}
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => addMockEndpoint(server.id)}
                    aria-label={`Add endpoint to ${server.name}`}
                    title={`Add endpoint to ${server.name}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-surface hover:text-accent"
                  >
                    <Plus size={10} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateMockServer(server.id)}
                    aria-label={`Duplicate ${server.name}`}
                    title={`Duplicate ${server.name}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-surface hover:text-text-primary"
                  >
                    <Copy size={10} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingServerDelete({ id: server.id, name: server.name })}
                    aria-label={`Delete ${server.name}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
                  >
                    <Trash2 size={10} aria-hidden="true" />
                  </button>
                </div>
                {open && (
                  <ul className="ml-4 flex flex-col gap-0.5 border-l border-border-subtle pl-2">
                    {server.endpoints.length === 0 ? (
                      <li className="py-1 text-[10px] italic text-text-dim">
                        No endpoints. Click + to add one.
                      </li>
                    ) : (
                      server.endpoints.map((endpoint) => {
                        const isActive =
                          activeServerId === server.id && activeEndpointId === endpoint.id;
                        return (
                          <li key={endpoint.id}>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveMockEndpoint({
                                    serverId: server.id,
                                    endpointId: endpoint.id,
                                  })
                                }
                                aria-label={`Open ${endpoint.method} ${endpoint.pathPattern}`}
                                aria-current={isActive ? 'true' : undefined}
                                className={
                                  isActive
                                    ? 'flex flex-1 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent'
                                    : 'flex flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface hover:text-text-primary'
                                }
                              >
                                <MethodChip method={endpoint.method} />
                                <span className="flex-1 truncate font-mono">
                                  {endpoint.pathPattern}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => duplicateMockEndpoint(server.id, endpoint.id)}
                                aria-label={`Duplicate endpoint ${endpoint.method} ${endpoint.pathPattern}`}
                                title="Duplicate endpoint"
                                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-faint hover:bg-surface hover:text-text-primary"
                              >
                                <Copy size={9} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeMockEndpoint(server.id, endpoint.id)}
                                aria-label={`Delete endpoint ${endpoint.method} ${endpoint.pathPattern}`}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
                              >
                                <Trash2 size={9} aria-hidden="true" />
                              </button>
                            </div>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingServerDelete !== null}
        title={`Delete ${pendingServerDelete?.name ?? ''}?`}
        description={
          <p>This removes the mock server and every endpoint inside it from this workspace.</p>
        }
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingServerDelete(null)}
        onConfirm={() => {
          if (pendingServerDelete) removeMock(pendingServerDelete.id);
          setPendingServerDelete(null);
        }}
      />
    </div>
  );
}

function MethodChip({ method }: { method: string }) {
  const tone =
    method === 'GET'
      ? 'border-accent/40 text-accent'
      : method === 'POST'
        ? 'border-success/40 text-success'
        : method === 'PUT' || method === 'PATCH'
          ? 'border-warning/40 text-warning'
          : method === 'DELETE'
            ? 'border-danger/40 text-danger'
            : 'border-border text-text-muted';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm border bg-card px-1 py-0 font-mono text-[9px] uppercase ${tone}`}
    >
      {method}
    </span>
  );
}
