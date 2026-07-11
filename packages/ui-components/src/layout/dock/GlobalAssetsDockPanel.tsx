// Workspace-wide library of reusable JSON Schemas, GraphQL definitions, and files.
// Lives in the synced doc — pushing the workspace shares them with the
// team. Requests opt in via the Body tab (P18/P19) by selecting a schema
// from the dropdown.
//
// Hosted as the "Assets" tab of the right-side dock. Three sub-tabs:
// Schemas (JSON Schema docs), GraphQL (SDL or introspection JSON), and
// Files (slot-backed upload assets reused by request bodies).
// The list/editor split is width-responsive — at narrow dock widths the
// list takes the full panel and the editor opens with a Back affordance.
// Delete is gated through ConfirmDialog because it cascades — any
// request referencing the deleted id has its mapping cleared.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  FileArchive,
  FolderInput,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  formatBytes,
  type AssetUsage,
  type GlobalFileAsset,
  type GlobalGraphQL,
  type GlobalSchema,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { MonacoEditorBase } from '../../editors/MonacoEditorBase';
import { cn } from '../../primitives/cn';
import { deriveFileAssetState, FileAssetStatusPill } from '../../primitives/FileAssetStatusPill';
import { SpecAssetBadge } from '../../primitives/SpecAssetBadge';
import { getAttachment } from '../../persistence/attachments';

interface FileAssetConsumer {
  kind: 'request' | 'mock' | 'spec-mock' | 'spec-request';
  /** Friendly label for the row ("My request", "Petstore · GET /pets"). */
  label: string;
  /** Stable id for the list `key`. */
  id: string;
}

function consumersFromIndex(
  usage: AssetUsage | null | undefined,
  requestNames: Record<string, string>,
  mockNames: Record<string, { server: string; endpoint: string }>,
): FileAssetConsumer[] {
  if (!usage) return [];
  const out: FileAssetConsumer[] = [];
  for (const id of usage.requests) {
    out.push({ kind: 'request', id: `req:${id}`, label: requestNames[id] ?? id });
  }
  for (const ref of usage.mockEndpoints) {
    const meta = mockNames[`${ref.mockId}:${ref.endpointId}`];
    const label = meta ? `${meta.server} · ${meta.endpoint}` : `${ref.mockId} · ${ref.endpointId}`;
    out.push({ kind: 'mock', id: `mock:${ref.mockId}:${ref.endpointId}`, label });
  }
  // Spec-source consumers (Increment E): mocks driven by this spec asset +
  // requests imported from it.
  for (const mockId of usage.mockServers ?? []) {
    const named = Object.entries(mockNames).find(([key]) => key.startsWith(`${mockId}:`));
    out.push({
      kind: 'spec-mock',
      id: `spec-mock:${mockId}`,
      label: named ? named[1].server : mockId,
    });
  }
  for (const id of usage.importedRequests ?? []) {
    out.push({ kind: 'spec-request', id: `spec-req:${id}`, label: requestNames[id] ?? id });
  }
  return out;
}

type Tab = 'schemas' | 'graphql' | 'files';

// Threshold below which the list+editor stack vertically with a Back
// affordance. ~520 keeps the side-by-side layout usable on default dock
// widths while collapsing once the user shrinks the dock.
const NARROW_WIDTH_PX = 520;

const inputClass =
  'h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';

export function GlobalAssetsDockPanel() {
  const [tab, setTab] = useState<Tab>('schemas');
  const schemas = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.schemas) : [],
  );
  const graphql = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.graphql) : [],
  );
  const files = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.files ?? {}) : [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-clear `selectedId` when the selected asset disappears from
  // any of the three registries. Without this, deleting the currently-
  // open asset would leave the right-side editor stranded on a
  // now-invalid id and render its empty state — which the user reads
  // as a broken screen instead of "you successfully deleted the file."
  // Covers the UI delete path, the MCP `assets.delete_file` tool, and
  // any external write that lands via `refreshFromDisk`.
  useEffect(() => {
    if (selectedId === null) return;
    const existsInTab =
      schemas.some((s) => s.id === selectedId) ||
      graphql.some((g) => g.id === selectedId) ||
      files.some((f) => f.id === selectedId);
    if (!existsInTab) setSelectedId(null);
  }, [selectedId, schemas, graphql, files]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Width 0 happens on first paint; default to side-by-side until we know.
  const narrow = width > 0 && width < NARROW_WIDTH_PX;

  return (
    <div ref={wrapperRef} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-border-subtle">
        <TabButton
          active={tab === 'schemas'}
          onClick={() => {
            setTab('schemas');
            setSelectedId(null);
          }}
        >
          JSON Schemas <span className="ml-1 text-text-dim">({schemas.length})</span>
        </TabButton>
        <TabButton
          active={tab === 'graphql'}
          onClick={() => {
            setTab('graphql');
            setSelectedId(null);
          }}
        >
          GraphQL <span className="ml-1 text-text-dim">({graphql.length})</span>
        </TabButton>
        <TabButton
          active={tab === 'files'}
          onClick={() => {
            setTab('files');
            setSelectedId(null);
          }}
        >
          Files <span className="ml-1 text-text-dim">({files.length})</span>
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 p-3">
        {narrow ? (
          <NarrowLayout
            tab={tab}
            schemas={schemas}
            graphql={graphql}
            files={files}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : (
          <SideBySideLayout
            tab={tab}
            schemas={schemas}
            graphql={graphql}
            files={files}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </div>
    </div>
  );
}

interface LayoutProps {
  tab: Tab;
  schemas: GlobalSchema[];
  graphql: GlobalGraphQL[];
  files: GlobalFileAsset[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function SideBySideLayout({ tab, schemas, graphql, files, selectedId, onSelect }: LayoutProps) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[200px_1fr] gap-3">
      {tab === 'schemas' ? (
        <SchemaList items={schemas} selectedId={selectedId} onSelect={onSelect} />
      ) : tab === 'graphql' ? (
        <GraphQLList items={graphql} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <FileAssetList items={files} selectedId={selectedId} onSelect={onSelect} />
      )}
      <div className="min-h-0">
        {tab === 'schemas' ? (
          <SchemaEditor id={selectedId} />
        ) : tab === 'graphql' ? (
          <GraphQLEditor id={selectedId} />
        ) : (
          <FileAssetEditor id={selectedId} />
        )}
      </div>
    </div>
  );
}

function NarrowLayout({ tab, schemas, graphql, files, selectedId, onSelect }: LayoutProps) {
  if (selectedId === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tab === 'schemas' ? (
          <SchemaList items={schemas} selectedId={selectedId} onSelect={onSelect} />
        ) : tab === 'graphql' ? (
          <GraphQLList items={graphql} selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <FileAssetList items={files} selectedId={selectedId} onSelect={onSelect} />
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-label="Back to list"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 self-start rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-muted hover:border-border-strong hover:text-text-primary"
      >
        <ArrowLeft size={12} aria-hidden="true" />
        Back to list
      </button>
      <div className="min-h-0 flex-1">
        {tab === 'schemas' ? (
          <SchemaEditor id={selectedId} />
        ) : tab === 'graphql' ? (
          <GraphQLEditor id={selectedId} />
        ) : (
          <FileAssetEditor id={selectedId} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'border-b-2 px-3 py-2 text-xs transition-colors ' +
        (active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-muted hover:text-text-primary')
      }
    >
      {children}
    </button>
  );
}

function SchemaList({
  items,
  selectedId,
  onSelect,
}: {
  items: GlobalSchema[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const addSchema = useWorkspaceStore((s) => s.addGlobalSchema);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-1">
      <button
        type="button"
        onClick={() => {
          const id = addSchema({ name: 'New schema' });
          onSelect(id);
        }}
        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Plus size={12} aria-hidden="true" />
        Add JSON Schema
      </button>
      {items.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No schemas yet.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                'w-full truncate rounded-sm border px-2 py-1.5 text-left text-xs',
                selectedId === s.id
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-card text-text-primary hover:border-border-strong',
              )}
            >
              <span className="block truncate font-medium">{s.name}</span>
              {s.description && (
                <span className="block truncate text-[0.6875rem] text-text-dim">
                  {s.description}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GraphQLList({
  items,
  selectedId,
  onSelect,
}: {
  items: GlobalGraphQL[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const addGraphQL = useWorkspaceStore((s) => s.addGlobalGraphQL);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-1">
      <button
        type="button"
        onClick={() => {
          const id = addGraphQL({ name: 'New GraphQL schema' });
          onSelect(id);
        }}
        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Plus size={12} aria-hidden="true" />
        Add GraphQL schema
      </button>
      {items.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No GraphQL schemas yet.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => onSelect(g.id)}
              className={cn(
                'w-full truncate rounded-sm border px-2 py-1.5 text-left text-xs',
                selectedId === g.id
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-card text-text-primary hover:border-border-strong',
              )}
            >
              <span className="block truncate font-medium">{g.name}</span>
              <span className="block truncate text-[0.6875rem] text-text-dim">
                {g.kind === 'sdl' ? 'SDL' : 'Introspection JSON'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileAssetList({
  items,
  selectedId,
  onSelect,
}: {
  items: GlobalFileAsset[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const addFileAsset = useWorkspaceStore((s) => s.addGlobalFileAsset);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const usageIndex = useWorkspaceStore((s) => s.local?.assetUsageIndex ?? {});
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState<'all' | 'unused'>('all');

  // Filter items by usage. Unused = zero-ref AND no pending bytes (we
  // treat pending uploads as in-flight uses since they're meaningful
  // state worth surfacing). Zero matches keeps the list rendered with
  // an empty-state hint so the toggle never silently swallows items.
  const visible = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((f) => (usageIndex[f.id]?.total ?? 0) === 0);
  }, [items, usageIndex, filter]);
  const unusedCount = useMemo(
    () => items.filter((f) => (usageIndex[f.id]?.total ?? 0) === 0).length,
    [items, usageIndex],
  );

  const onPick = (file: File) => {
    void addFileAsset(file)
      .then((id) => onSelect(id))
      .catch((err) => {
        pushToast({
          tone: 'error',
          title: 'Could not add file asset',
          detail: err instanceof Error ? err.message : String(err),
        });
      });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-1">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label="Global file asset"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Upload size={12} aria-hidden="true" />
        Add file asset
      </button>
      {items.length > 0 && (
        <div
          className="flex items-center gap-1 text-[0.6875rem]"
          role="group"
          aria-label="File asset filter"
        >
          <button
            type="button"
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
            className={cn(
              'inline-flex h-6 items-center rounded-sm border px-2',
              filter === 'all'
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border bg-card text-text-muted hover:border-border-strong',
            )}
          >
            All ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unused')}
            aria-pressed={filter === 'unused'}
            disabled={unusedCount === 0}
            className={cn(
              'inline-flex h-6 items-center rounded-sm border px-2 disabled:opacity-40',
              filter === 'unused'
                ? 'border-warning/40 bg-warning/10 text-warning'
                : 'border-border bg-card text-text-muted hover:border-border-strong',
            )}
          >
            Unused ({unusedCount})
          </button>
        </div>
      )}
      {items.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No file assets yet.
        </p>
      )}
      {items.length > 0 && visible.length === 0 && filter === 'unused' && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No unused assets — every file is wired into at least one request or mock response.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {visible.map((file) => (
          <FileAssetListRow
            key={file.id}
            file={file}
            selected={selectedId === file.id}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function FileAssetListRow({
  file,
  selected,
  onSelect,
}: {
  file: GlobalFileAsset;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  // Pull the asset's reference count straight from the local index so the
  // list row can show "Unused" / "Used in N" inline. Read is O(1).
  const usage = useWorkspaceStore((s) => s.local?.assetUsageIndex?.[file.id] ?? null);
  const total = usage?.total ?? 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(file.id)}
        className={cn(
          'w-full truncate rounded-sm border px-2 py-1.5 text-left text-xs',
          selected
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-border bg-card text-text-primary hover:border-border-strong',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FileArchive size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate font-medium">{file.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {file.spec && <SpecAssetBadge spec={file.spec} iconOnly />}
            <FileAssetStatusPill assetId={file.id} iconOnly />
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[0.6875rem] text-text-dim">
          <span className="truncate">
            {file.filename} · {formatBytes(file.size)}
          </span>
          <span className={cn('ml-auto shrink-0', total === 0 ? 'text-warning' : 'text-text-dim')}>
            {total === 0 ? 'Unused' : `Used in ${total}`}
          </span>
        </span>
      </button>
    </li>
  );
}

function SchemaEditor({ id }: { id: string | null }) {
  const schema = useWorkspaceStore((s) =>
    id ? (s.synced?.globalAssets.schemas[id] ?? null) : null,
  );
  const update = useWorkspaceStore((s) => s.updateGlobalSchema);
  const remove = useWorkspaceStore((s) => s.removeGlobalSchema);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border-subtle p-6 text-center text-xs text-text-dim">
        Select a schema, or add a new one to start editing.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <input
          aria-label="Schema name"
          value={schema.name}
          onChange={(e) => update(schema.id, { name: e.target.value })}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete schema ${schema.name}`}
          title="Delete"
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
      <input
        aria-label="Schema description"
        placeholder="Description (optional)"
        value={schema.description ?? ''}
        onChange={(e) => update(schema.id, { description: e.target.value })}
        className={inputClass}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border border-border">
        <MonacoEditorBase
          value={schema.schema}
          language="json"
          onChange={(v) => update(schema.id, { schema: v })}
          height="100%"
          ariaLabel="Schema body"
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${schema.name}"`}
        description={
          <>
            <p>
              This will remove the schema and clear it from any requests that reference it. The
              requests themselves stay.
            </p>
          </>
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          remove(schema.id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function GraphQLEditor({ id }: { id: string | null }) {
  const graphql = useWorkspaceStore((s) =>
    id ? (s.synced?.globalAssets.graphql[id] ?? null) : null,
  );
  const update = useWorkspaceStore((s) => s.updateGlobalGraphQL);
  const remove = useWorkspaceStore((s) => s.removeGlobalGraphQL);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const language = useMemo(
    () => (graphql?.kind === 'introspection' ? ('json' as const) : ('graphql' as const)),
    [graphql?.kind],
  );

  if (!graphql) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border-subtle p-6 text-center text-xs text-text-dim">
        Select a GraphQL schema, or add a new one to start editing.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="grid grid-cols-[1fr_120px_auto] items-center gap-2">
        <input
          aria-label="GraphQL schema name"
          value={graphql.name}
          onChange={(e) => update(graphql.id, { name: e.target.value })}
          className={inputClass}
        />
        <select
          aria-label="GraphQL kind"
          value={graphql.kind}
          onChange={(e) => update(graphql.id, { kind: e.target.value as GlobalGraphQL['kind'] })}
          className={inputClass}
        >
          <option value="sdl">SDL</option>
          <option value="introspection">Introspection</option>
        </select>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete GraphQL schema ${graphql.name}`}
          title="Delete"
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
      <input
        aria-label="GraphQL schema description"
        placeholder="Description (optional)"
        value={graphql.description ?? ''}
        onChange={(e) => update(graphql.id, { description: e.target.value })}
        className={inputClass}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border border-border">
        <MonacoEditorBase
          value={graphql.source}
          language={language}
          onChange={(v) => update(graphql.id, { source: v })}
          height="100%"
          ariaLabel="GraphQL schema body"
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${graphql.name}"`}
        description={
          <p>
            This will remove the GraphQL definition and clear it from any requests that reference
            it.
          </p>
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          remove(graphql.id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function FileAssetEditor({ id }: { id: string | null }) {
  const file = useWorkspaceStore((s) => (id ? (s.synced?.globalAssets.files?.[id] ?? null) : null));
  // Read the shared usage index — same source of truth that powers the
  // list row + the consumer-aware delete confirmation. Walks both
  // requests AND mock endpoints (the legacy `collectFileAssetUsage`
  // helper only walked requests).
  const usage = useWorkspaceStore((s) => (id ? (s.local?.assetUsageIndex?.[id] ?? null) : null));
  const requestNames = useWorkspaceStore((s) => {
    if (!s.synced) return {};
    const out: Record<string, string> = {};
    for (const req of Object.values(s.synced.collections.requests)) {
      out[req.id] = req.name || '(unnamed request)';
    }
    return out;
  });
  const mockNames = useWorkspaceStore((s) => {
    if (!s.synced) return {};
    const out: Record<string, { server: string; endpoint: string }> = {};
    for (const server of Object.values(s.synced.mockServers)) {
      for (const ep of server.endpoints) {
        out[`${server.id}:${ep.id}`] = {
          server: server.name,
          endpoint: ep.name || `${ep.method} ${ep.pathPattern}`,
        };
      }
    }
    return out;
  });
  const update = useWorkspaceStore((s) => s.updateGlobalFileAsset);
  const importOpenApiToCollection = useWorkspaceStore((s) => s.importOpenApiToCollection);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const importSpecToCollection = async (): Promise<void> => {
    if (!file?.spec) return;
    const record = await getAttachment(file.slotId);
    if (!record) {
      pushToast({
        tone: 'error',
        title: 'Spec bytes are not available locally — re-upload the file.',
        ttlMs: 8000,
      });
      return;
    }
    const res = await importOpenApiToCollection({
      spec: new TextDecoder().decode(record.bytes),
      format: file.spec.format,
      specAssetId: file.id,
      title: file.spec.title,
    });
    pushToast({
      tone: res.warnings.length > 0 ? 'info' : 'success',
      title: `Imported ${res.requests} request${res.requests === 1 ? '' : 's'} to a new collection`,
      detail: res.warnings.length > 0 ? res.warnings.join(' · ') : undefined,
      ttlMs: res.warnings.length > 0 ? 12000 : 6000,
    });
  };
  const remove = useWorkspaceStore((s) => s.removeGlobalFileAsset);
  const fillBytes = useWorkspaceStore((s) => s.fillGlobalFileAssetBytes);
  const hasPending = useWorkspaceStore((s) =>
    id ? Boolean(s.local?.pendingFileUploads?.[id]) : false,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refillInput = useRef<HTMLInputElement | null>(null);

  const consumers = useMemo(
    () => consumersFromIndex(usage, requestNames, mockNames),
    [usage, requestNames, mockNames],
  );

  // "Missing" surface — both refs null and no pending bytes. Most
  // common cause: an MCP `globalAssets.files.create` call registered
  // the asset id and the user is filling in the bytes here. Also fires
  // when both refs got invalidated by 404 probes and the local cache
  // never had the bytes.
  const isMissing = file ? deriveFileAssetState(file, hasPending) === 'missing' : false;

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border-subtle p-6 text-center text-xs text-text-dim">
        Select a file asset, or add a new one to reuse uploads across requests.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <input
          aria-label="File asset name"
          value={file.name}
          onChange={(e) => update(file.id, { name: e.target.value })}
          className={inputClass}
        />
        <FileAssetStatusPill assetId={file.id} />
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete file asset ${file.name}`}
          title="Delete"
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
      <input
        aria-label="File asset description"
        placeholder="Description (optional)"
        value={file.description ?? ''}
        onChange={(e) => update(file.id, { description: e.target.value })}
        className={inputClass}
      />

      {isMissing && (
        <div className="flex items-center gap-2 rounded-sm border border-danger/30 bg-danger/5 p-2 text-[0.6875rem] text-danger">
          <span className="flex-1">
            Bytes are missing — pick a file to fill this asset. The slot id stays the same so every
            request and mock that points at it keeps working.
          </span>
          <input
            ref={refillInput}
            type="file"
            className="hidden"
            aria-label={`Fill bytes for ${file.name}`}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void fillBytes(file.id, picked);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => refillInput.current?.click()}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-danger/40 bg-danger/10 px-2 text-[0.625rem] text-danger hover:bg-danger/20"
          >
            <Upload size={10} aria-hidden="true" />
            Fill bytes
          </button>
        </div>
      )}

      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 rounded-sm border border-border bg-surface p-3 text-xs">
        <dt className="text-text-dim">Filename</dt>
        <dd className="truncate text-text-primary" title={file.filename}>
          {file.filename}
        </dd>
        <dt className="text-text-dim">Size</dt>
        <dd className="text-text-primary">{formatBytes(file.size)}</dd>
        <dt className="text-text-dim">MIME</dt>
        <dd className="truncate text-text-primary" title={file.mimeType}>
          {file.mimeType}
        </dd>
        <dt className="text-text-dim">Slot</dt>
        <dd className="truncate font-mono text-text-muted" title={file.slotId}>
          {file.slotId}
        </dd>
        {file.sha256 && (
          <>
            <dt className="text-text-dim">SHA-256</dt>
            <dd className="truncate font-mono text-text-muted" title={file.sha256}>
              {file.sha256}
            </dd>
          </>
        )}
      </dl>

      {file.spec && (
        <div className="rounded-sm border border-accent/30 bg-accent/5 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <SpecAssetBadge spec={file.spec} />
            {file.spec.title && (
              <span className="truncate font-medium text-text-primary" title={file.spec.title}>
                {file.spec.title}
              </span>
            )}
            {file.spec.version && <span className="text-text-dim">v{file.spec.version}</span>}
          </div>
          <button
            type="button"
            onClick={() => void importSpecToCollection()}
            className="mt-2 inline-flex h-6 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.625rem] text-accent hover:bg-accent/20"
          >
            <FolderInput size={11} aria-hidden="true" />
            Import to collection
          </button>
          {file.spec.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {file.spec.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1 text-warning">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 rounded-sm border border-border bg-card p-3">
        <div className="mb-2 text-xs font-medium text-text-primary">
          {consumers.length === 0
            ? 'No requests or mocks reference this file asset'
            : `Used in ${consumers.length} place${consumers.length === 1 ? '' : 's'}`}
        </div>
        {consumers.length === 0 ? (
          <p className="text-xs text-text-dim">
            This asset is unreferenced — safe to delete with no consumer impact.
          </p>
        ) : (
          <ul className="space-y-1 overflow-y-auto text-xs text-text-muted">
            {consumers.map((c) => (
              <li key={c.id} className="truncate" title={c.label}>
                <span className="mr-1 inline-block rounded-sm border border-border bg-surface px-1 text-[0.625rem] uppercase tracking-wider text-text-dim">
                  {c.kind}
                </span>
                <span className="text-text-primary">{c.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${file.name}"`}
        description={
          <div className="space-y-2">
            <p>
              This removes the file asset and the local cached bytes on this machine. Any requests
              or mock responses that point at it will be unbound.
            </p>
            {consumers.length > 0 && (
              <div className="rounded-sm border border-warning/30 bg-warning/5 p-2">
                <p className="font-medium text-warning">
                  {consumers.length} consumer{consumers.length === 1 ? '' : 's'} will be cleared:
                </p>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-text-muted">
                  {consumers.map((c) => (
                    <li key={c.id} className="truncate" title={c.label}>
                      <span className="text-text-dim">{c.kind} · </span>
                      <span className="text-text-primary">{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        }
        confirmLabel={consumers.length > 0 ? `Delete and unbind ${consumers.length}` : 'Delete'}
        tone="danger"
        onConfirm={() => {
          void remove(file.id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

// `collectFileAssetUsage` was retired in favor of the cross-cutting
// `local.assetUsageIndex` aggregator (assetUsageAggregator.ts) — it only
// scanned requests, not mocks, and recomputed on every render. The new
// index also powers the form-data / binary / mock-response editor pills.
