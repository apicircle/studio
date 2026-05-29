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
import { ArrowLeft, FileArchive, Plus, Trash2, Upload } from 'lucide-react';
import {
  formatBytes,
  type GlobalFileAsset,
  type GlobalGraphQL,
  type GlobalSchema,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { MonacoEditorBase } from '../../editors/MonacoEditorBase';
import { cn } from '../../primitives/cn';

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
  const fileInput = useRef<HTMLInputElement | null>(null);

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
      {items.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No file assets yet.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => onSelect(file.id)}
              className={cn(
                'w-full truncate rounded-sm border px-2 py-1.5 text-left text-xs',
                selectedId === file.id
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-card text-text-primary hover:border-border-strong',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <FileArchive size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate font-medium">{file.name}</span>
              </span>
              <span className="block truncate text-[0.6875rem] text-text-dim">
                {file.filename} · {formatBytes(file.size)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
  const usage = useWorkspaceStore((s) => (id ? collectFileAssetUsage(s.synced, id) : []));
  const update = useWorkspaceStore((s) => s.updateGlobalFileAsset);
  const remove = useWorkspaceStore((s) => s.removeGlobalFileAsset);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border-subtle p-6 text-center text-xs text-text-dim">
        Select a file asset, or add a new one to reuse uploads across requests.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <input
          aria-label="File asset name"
          value={file.name}
          onChange={(e) => update(file.id, { name: e.target.value })}
          className={inputClass}
        />
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

      <div className="min-h-0 flex-1 rounded-sm border border-border bg-card p-3">
        <div className="mb-2 text-xs font-medium text-text-primary">
          Used by {usage.length} request{usage.length === 1 ? '' : 's'}
        </div>
        {usage.length === 0 ? (
          <p className="text-xs text-text-dim">No requests reference this file asset yet.</p>
        ) : (
          <ul className="space-y-1 overflow-y-auto text-xs text-text-muted">
            {usage.map((item) => (
              <li
                key={`${item.requestId}:${item.location}`}
                className="truncate"
                title={item.location}
              >
                <span className="text-text-primary">{item.requestName}</span>
                <span className="text-text-dim"> · {item.location}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${file.name}"`}
        description={
          <p>
            This will remove the file asset, clear it from any requests that reference it, and
            remove the local cached bytes on this machine.
          </p>
        }
        confirmLabel="Delete"
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

function collectFileAssetUsage(
  synced: ReturnType<typeof useWorkspaceStore.getState>['synced'],
  fileAssetId: string,
): Array<{ requestId: string; requestName: string; location: string }> {
  if (!synced) return [];
  const usage: Array<{ requestId: string; requestName: string; location: string }> = [];
  for (const req of Object.values(synced.collections.requests)) {
    if (req.body.type === 'binary' && req.body.attachment?.globalFileAssetId === fileAssetId) {
      usage.push({ requestId: req.id, requestName: req.name, location: 'binary body' });
    }
    if (req.body.type === 'form-data') {
      for (const row of req.body.formRows ?? []) {
        if (row.kind === 'file' && row.globalFileAssetId === fileAssetId) {
          usage.push({
            requestId: req.id,
            requestName: req.name,
            location: `form-data ${row.key || 'file'}`,
          });
        }
      }
    }
  }
  return usage;
}
