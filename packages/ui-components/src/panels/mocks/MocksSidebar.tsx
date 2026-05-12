import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  Plus,
  Search,
  Server,
  Trash2,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { KebabMenu, type KebabMenuItem } from '../../primitives/KebabMenu';
import { cn } from '../../primitives/cn';

// Sidebar surface for the Mocks panel — mirrors the Editor sidebar
// shape: each mock server is a collapsible group, endpoints render as
// rows beneath. Clicking an endpoint switches the main pane to the
// MockEndpointEditor for that endpoint.
//
// The header kebab (rendered by Sidebar.tsx via MocksSidebarActions)
// hosts "New mock server". Per-server and per-endpoint actions live in
// row-level kebab menus to keep dense rows tidy.

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

  const allServers = Object.values(mockServers);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingServerDelete, setPendingServerDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Filter servers by name; for each server, also keep only endpoints whose
  // path or method matches. A server stays visible if its own name matches
  // or any of its endpoints match (so the path to a hit is preserved).
  const { servers, matchingEndpointIds } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        servers: allServers,
        matchingEndpointIds: null as Set<string> | null,
      };
    }
    const matchedEndpoints = new Set<string>();
    const matched = allServers.filter((s) => {
      const serverHit = s.name.toLowerCase().includes(q);
      const endpointHits = s.endpoints.filter(
        (e) =>
          e.pathPattern.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q) ||
          (e.name?.toLowerCase().includes(q) ?? false),
      );
      endpointHits.forEach((e) => matchedEndpoints.add(e.id));
      return serverHit || endpointHits.length > 0;
    });
    return { servers: matched, matchingEndpointIds: matchedEndpoints };
  }, [allServers, searchQuery]);

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
      <div className="relative">
        <Search
          size={11}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
        />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search mocks…"
          aria-label="Search mocks"
          className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      {servers.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border-subtle px-2 py-3 text-center text-[0.6875rem] text-text-dim">
          {searchQuery
            ? 'No matching mock servers or endpoints.'
            : 'No mock servers yet. Use the menu above to create one.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {servers.map((server) => {
            // Auto-expand servers while a search is active so matching
            // endpoints show without an extra click.
            const open = searchQuery ? true : isExpanded(server.id);
            const visibleEndpoints =
              matchingEndpointIds === null
                ? server.endpoints
                : // Server matched by name → show all its endpoints; otherwise
                  // only the endpoints that themselves matched.
                  server.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
                  ? server.endpoints
                  : server.endpoints.filter((e) => matchingEndpointIds.has(e.id));
            const isServerActive = activeServerId === server.id && activeEndpointId === null;
            const serverItems: KebabMenuItem[] = [
              {
                id: 'add-endpoint',
                label: 'Add endpoint',
                icon: <Plus size={12} aria-hidden="true" />,
                onSelect: () => {
                  addMockEndpoint(server.id);
                  setExpanded((e) => ({ ...e, [server.id]: true }));
                },
              },
              {
                id: 'duplicate',
                label: 'Duplicate',
                icon: <Copy size={12} aria-hidden="true" />,
                onSelect: () => duplicateMockServer(server.id),
              },
              {
                id: 'delete',
                label: 'Delete',
                icon: <Trash2 size={12} aria-hidden="true" />,
                tone: 'danger',
                onSelect: () => setPendingServerDelete({ id: server.id, name: server.name }),
              },
            ];
            return (
              <li key={server.id}>
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded-sm border px-0.5',
                    isServerActive
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-transparent hover:bg-surface',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(server.id)}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${server.name}`}
                    aria-expanded={open}
                    className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-text-dim"
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
                    className={cn(
                      'flex flex-1 items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[0.6875rem]',
                      isServerActive ? 'text-accent' : 'text-text-primary',
                    )}
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
                  <KebabMenu items={serverItems} ariaLabel={`${server.name} actions`} size="sm" />
                </div>
                {open && (
                  <ul className="ml-4 flex flex-col gap-0.5 border-l border-border-subtle pl-2">
                    {visibleEndpoints.length === 0 ? (
                      <li className="py-1 text-[0.625rem] italic text-text-dim">
                        {server.endpoints.length === 0
                          ? 'No endpoints. Use the server menu to add one.'
                          : 'No matching endpoints in this server.'}
                      </li>
                    ) : (
                      visibleEndpoints.map((endpoint) => {
                        const isActive =
                          activeServerId === server.id && activeEndpointId === endpoint.id;
                        const endpointItems: KebabMenuItem[] = [
                          {
                            id: 'duplicate',
                            label: 'Duplicate',
                            icon: <Copy size={12} aria-hidden="true" />,
                            onSelect: () => duplicateMockEndpoint(server.id, endpoint.id),
                          },
                          {
                            id: 'delete',
                            label: 'Delete',
                            icon: <Trash2 size={12} aria-hidden="true" />,
                            tone: 'danger',
                            onSelect: () => removeMockEndpoint(server.id, endpoint.id),
                          },
                        ];
                        return (
                          <li key={endpoint.id}>
                            <div
                              className={cn(
                                'group flex items-center gap-1 rounded-sm border px-0.5',
                                isActive
                                  ? 'border-accent/40 bg-accent/10'
                                  : 'border-transparent hover:bg-surface',
                              )}
                            >
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
                                className={cn(
                                  'flex flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-[0.6875rem]',
                                  isActive
                                    ? 'text-accent'
                                    : 'text-text-muted group-hover:text-text-primary',
                                )}
                              >
                                <MethodChip method={endpoint.method} />
                                <span className="flex-1 truncate font-mono">
                                  {endpoint.pathPattern}
                                </span>
                              </button>
                              <KebabMenu
                                items={endpointItems}
                                ariaLabel={`${endpoint.method} ${endpoint.pathPattern} actions`}
                                size="sm"
                              />
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

/**
 * Kebab menu rendered next to the "MOCKS" label in the shared sidebar header.
 * Replaces the previous "New mock server" CTA above the server list.
 */
export function MocksSidebarActions() {
  const openCreateMockServer = useWorkspaceStore((s) => s.openMocksCreateModal);

  const items: KebabMenuItem[] = [
    {
      id: 'new-mock-server',
      label: 'New Mock Server',
      icon: <Plus size={12} aria-hidden="true" />,
      onSelect: openCreateMockServer,
    },
  ];

  return <KebabMenu items={items} ariaLabel="Mocks actions" size="sm" alwaysVisible />;
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
      className={`inline-flex w-12 shrink-0 items-center justify-center rounded-sm border bg-card px-1 py-0 font-mono text-[0.5625rem] uppercase ${tone}`}
    >
      {method}
    </span>
  );
}
