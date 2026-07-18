import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  FolderPlus,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { isLinkedMockSource } from '@apicircle/shared';
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
  const refreshMockServer = useWorkspaceStore((s) => s.refreshMockServer);
  const convertMockToEditable = useWorkspaceStore((s) => s.convertMockToEditable);
  const reuploadMockSpec = useWorkspaceStore((s) => s.reuploadMockSpec);
  const promoteMockEndpointToRequest = useWorkspaceStore((s) => s.promoteMockEndpointToRequest);
  const promoteMockToCollection = useWorkspaceStore((s) => s.promoteMockToCollection);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  // "Update spec…" (linked mocks) triggers this one hidden file input; the
  // target server id is stashed in a ref so a single input serves the list.
  const specUploadInput = useRef<HTMLInputElement | null>(null);
  const specUploadServerId = useRef<string | null>(null);

  const allServers = Object.values(mockServers);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingServerDelete, setPendingServerDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pendingEndpointDelete, setPendingEndpointDelete] = useState<{
    serverId: string;
    endpointId: string;
    label: string;
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
          {(() => {
            // Hoist the search-query normalization out of the per-server loop —
            // with 50 servers and a 20-char query this saved 50 redundant
            // trim+lowercase calls per render of the sidebar.
            const normalizedSearch = searchQuery.trim().toLowerCase();
            return servers.map((server) => {
              // Auto-expand servers while a search is active so matching
              // endpoints show without an extra click.
              const open = searchQuery ? true : isExpanded(server.id);
              const visibleEndpoints =
                matchingEndpointIds === null
                  ? server.endpoints
                  : // Server matched by name → show all its endpoints; otherwise
                    // only the endpoints that themselves matched.
                    server.name.toLowerCase().includes(normalizedSearch)
                    ? server.endpoints
                    : server.endpoints.filter((e) => matchingEndpointIds.has(e.id));
              const isServerActive = activeServerId === server.id && activeEndpointId === null;
              const isLinked = isLinkedMockSource(server.source);
              const serverItems: KebabMenuItem[] = [
                ...(isLinked
                  ? []
                  : [
                      {
                        id: 'add-endpoint',
                        label: 'Add endpoint',
                        icon: <Plus size={12} aria-hidden="true" />,
                        onSelect: () => {
                          addMockEndpoint(server.id);
                          setExpanded((e) => ({ ...e, [server.id]: true }));
                        },
                      },
                    ]),
                ...(server.source.kind !== 'manual'
                  ? [
                      {
                        id: 'refresh',
                        label: isLinked ? 'Refresh from spec' : 'Re-import from spec',
                        icon: <RefreshCw size={12} aria-hidden="true" />,
                        onSelect: () => void refreshMockServer(server.id),
                      },
                    ]
                  : []),
                ...(isLinked
                  ? [
                      {
                        id: 'update-spec',
                        label: 'Update spec…',
                        icon: <Upload size={12} aria-hidden="true" />,
                        onSelect: () => {
                          specUploadServerId.current = server.id;
                          specUploadInput.current?.click();
                        },
                      },
                      {
                        id: 'convert-editable',
                        label: 'Convert to editable mock',
                        icon: <Unlock size={12} aria-hidden="true" />,
                        onSelect: () => convertMockToEditable(server.id),
                      },
                    ]
                  : []),
                ...(server.endpoints.length > 0
                  ? [
                      {
                        id: 'promote-all',
                        label: 'Add all to collection',
                        icon: <FolderPlus size={12} aria-hidden="true" />,
                        onSelect: () => {
                          const res = promoteMockToCollection(server.id);
                          if (res) {
                            pushToast({
                              tone: 'success',
                              title: `Added ${res.requests} request${res.requests === 1 ? '' : 's'} to "${server.name} (mock)"`,
                              detail:
                                'Set MOCK_BASE_URL / MOCK_PORT in the active "Mock" environment before running.',
                              ttlMs: 7000,
                            });
                          }
                        },
                      },
                    ]
                  : []),
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
                      'group flex h-7 items-center gap-1 rounded-sm border px-0.5',
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
                        'flex h-full min-w-0 flex-1 items-center gap-1 rounded-sm px-1.5 text-left text-[0.6875rem]',
                        isServerActive ? 'text-accent' : 'text-text-primary',
                      )}
                    >
                      <Server size={11} className="shrink-0 text-accent" aria-hidden="true" />
                      <span className="flex-1 truncate font-medium">{server.name}</span>
                      {server.source.kind !== 'manual' && (
                        <FileCode
                          size={10}
                          className="shrink-0 text-text-faint"
                          aria-label={
                            isLinked ? 'Linked spec (read-only)' : `${server.source.kind} spec`
                          }
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
                              id: 'promote',
                              label: 'Add to collection',
                              icon: <FolderPlus size={12} aria-hidden="true" />,
                              onSelect: () => {
                                const newId = promoteMockEndpointToRequest(server.id, endpoint.id);
                                if (newId) {
                                  pushToast({
                                    tone: 'success',
                                    title: `Added ${endpoint.method} ${endpoint.pathPattern} to "${server.name} (mock)"`,
                                    detail:
                                      'Set MOCK_BASE_URL / MOCK_PORT in the "Mock" environment before running.',
                                    ttlMs: 6000,
                                  });
                                }
                              },
                            },
                          ];
                          // Linked ("run live") mocks are read-only, so only the
                          // non-mutating "Add to collection" action shows.
                          if (!isLinked) {
                            endpointItems.push(
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
                                onSelect: () =>
                                  setPendingEndpointDelete({
                                    serverId: server.id,
                                    endpointId: endpoint.id,
                                    label: `${endpoint.method} ${endpoint.pathPattern}`,
                                  }),
                              },
                            );
                          }
                          return (
                            <li key={endpoint.id}>
                              <div
                                className={cn(
                                  'group flex h-7 items-center gap-1 rounded-sm border px-0.5',
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
                                    'flex h-full flex-1 items-center gap-2 truncate px-2 py-1.5 text-left text-xs',
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
                                {endpointItems.length > 0 && (
                                  <KebabMenu
                                    items={endpointItems}
                                    ariaLabel={`${endpoint.method} ${endpoint.pathPattern} actions`}
                                    size="sm"
                                  />
                                )}
                              </div>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </li>
              );
            });
          })()}
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

      <ConfirmDialog
        open={pendingEndpointDelete !== null}
        title={`Delete endpoint "${pendingEndpointDelete?.label ?? ''}"?`}
        description={
          <p>
            Removes this endpoint, its response body, validation rules, and conditional response
            rules from the mock server. The server itself stays.
          </p>
        }
        confirmLabel="Delete endpoint"
        tone="danger"
        onCancel={() => setPendingEndpointDelete(null)}
        onConfirm={() => {
          if (pendingEndpointDelete)
            removeMockEndpoint(pendingEndpointDelete.serverId, pendingEndpointDelete.endpointId);
          setPendingEndpointDelete(null);
        }}
      />

      <input
        ref={specUploadInput}
        type="file"
        accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
        className="hidden"
        aria-label="Update OpenAPI/Swagger spec file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          const serverId = specUploadServerId.current;
          if (f && serverId) void reuploadMockSpec(serverId, f);
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
  const openServeContract = useWorkspaceStore((s) => s.openMocksServeContractModal);

  const items: KebabMenuItem[] = [
    {
      id: 'new-mock-server',
      label: 'New Mock Server',
      icon: <Plus size={12} aria-hidden="true" />,
      onSelect: openCreateMockServer,
    },
    {
      id: 'serve-openapi-contract',
      label: 'Serve OpenAPI contract',
      icon: <Radio size={12} aria-hidden="true" />,
      onSelect: openServeContract,
    },
  ];

  return <KebabMenu items={items} ariaLabel="Mocks actions" size="sm" alwaysVisible />;
}

function MethodChip({ method }: { method: string }) {
  const tone = methodTone(method);
  return (
    <span
      className={`inline-block w-10 shrink-0 text-left font-mono text-[0.625rem] font-medium uppercase tracking-wider tabular-nums ${tone}`}
    >
      {method}
    </span>
  );
}

function methodTone(method: string): string {
  switch (method) {
    case 'GET':
      return 'text-http-get';
    case 'POST':
      return 'text-http-post';
    case 'PUT':
      return 'text-http-put';
    case 'PATCH':
      return 'text-http-patch';
    case 'DELETE':
      return 'text-http-delete';
    case 'HEAD':
      return 'text-http-head';
    case 'OPTIONS':
      return 'text-http-options';
    default:
      return 'text-text-muted';
  }
}
