// Workspace-wide library of reusable JSON Schemas + GraphQL definitions.
// Lives in the synced doc — pushing the workspace shares them with the
// team. Requests opt in via the Body tab (P18/P19) by selecting a schema
// from the dropdown.
//
// Two tabs: Schemas (JSON Schema docs) and GraphQL (SDL or introspection
// JSON). Each entry has name, description, and a Monaco-backed source
// editor. Delete is gated through ConfirmDialog because it cascades —
// any request referencing the deleted id has its mapping cleared.

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { GlobalGraphQL, GlobalSchema } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { MonacoEditorBase } from '../../editors/MonacoEditorBase';
import { cn } from '../../primitives/cn';

type Tab = 'schemas' | 'graphql';

const inputClass =
  'h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';

export function GlobalAssetsPanel() {
  const open = useWorkspaceStore((s) => s.globalAssetsOpen);
  const close = useWorkspaceStore((s) => s.closeGlobalAssets);

  if (!open) return null;
  return (
    <Modal open onClose={close} title="Global Assets library">
      <GlobalAssetsBody />
    </Modal>
  );
}

function GlobalAssetsBody() {
  const [tab, setTab] = useState<Tab>('schemas');
  const schemas = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.schemas) : [],
  );
  const graphql = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.graphql) : [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex h-[60vh] min-h-[420px] w-[min(900px,95vw)] flex-col gap-3">
      <div className="flex border-b border-border-subtle">
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
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] gap-3">
        {tab === 'schemas' ? (
          <SchemaList items={schemas} selectedId={selectedId} onSelect={setSelectedId} />
        ) : (
          <GraphQLList items={graphql} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        <div className="min-h-0">
          {tab === 'schemas' ? <SchemaEditor id={selectedId} /> : <GraphQLEditor id={selectedId} />}
        </div>
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
                <span className="block truncate text-[11px] text-text-dim">{s.description}</span>
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
              <span className="block truncate text-[11px] text-text-dim">
                {g.kind === 'sdl' ? 'SDL' : 'Introspection JSON'}
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
