import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Shield,
  Trash2,
} from 'lucide-react';
import type { KebabMenuItem } from '../../primitives/KebabMenu';
import type { Folder, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isNameAvailableInFolder } from '../../store/editorActions';
import { cn } from '../../primitives/cn';
import { KebabMenu } from '../../primitives/KebabMenu';
import { FolderAuthModal } from './FolderAuthModal';
import { ImportModal } from './ImportModal';
import { LinkedWorkspaceTreeSection } from './LinkedWorkspaceTreeSection';

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-http-get',
  POST: 'text-http-post',
  PUT: 'text-http-put',
  PATCH: 'text-http-patch',
  DELETE: 'text-http-delete',
  HEAD: 'text-http-head',
  OPTIONS: 'text-http-options',
};

interface RenderNode {
  kind: 'folder' | 'request';
  id: string;
}

export function EditorSidebar() {
  const tree = useWorkspaceStore((s) => s.synced?.collections.tree);
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const folders = useWorkspaceStore((s) => s.synced?.collections.folders ?? {});
  const activeRequestId = useWorkspaceStore((s) => s.local?.ui.activeRequestId ?? null);
  const addRequest = useWorkspaceStore((s) => s.addRequest);
  const addFolder = useWorkspaceStore((s) => s.addFolder);
  const removeRequest = useWorkspaceStore((s) => s.removeRequest);
  const removeFolder = useWorkspaceStore((s) => s.removeFolder);
  const renameRequest = useWorkspaceStore((s) => s.renameRequest);
  const renameFolder = useWorkspaceStore((s) => s.renameFolder);
  const duplicateRequest = useWorkspaceStore((s) => s.duplicateRequest);
  const duplicateFolder = useWorkspaceStore((s) => s.duplicateFolder);
  const setActiveRequestId = useWorkspaceStore((s) => s.setActiveRequestId);
  const importOpen = useWorkspaceStore((s) => s.importModalOpen);
  const closeImport = useWorkspaceStore((s) => s.closeImportModal);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [authModalFolderId, setAuthModalFolderId] = useState<string | null>(null);
  // Tracks which node is currently being renamed inline. Keyed as
  // `folder:<id>` or `request:<id>` so a folder and request with the same id
  // (impossible today, but cheap to be explicit) can't collide.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  /**
   * Active name-first prompt for "New request" / "New folder". Lifted to the
   * workspace store so the sidebar header kebab (rendered above this tree by
   * Sidebar.tsx) can drive it without sharing local React state.
   */
  const pendingCreate = useWorkspaceStore((s) => s.editorPendingCreate);
  const setPendingCreate = useWorkspaceStore((s) => s.setEditorPendingCreate);

  const synced = useWorkspaceStore((s) => s.synced);

  const validateNewName = (
    parentId: string | null,
    kind: 'folder' | 'request',
    candidate: string,
  ): boolean => (synced ? isNameAvailableInFolder(synced, parentId, kind, candidate) : false);

  const startCreate = (kind: 'folder' | 'request', parentId: string | null) => {
    if (parentId !== null) setExpandedFolders((prev) => new Set(prev).add(parentId));
    setPendingCreate({ kind, parentId });
  };

  const commitCreate = (name: string) => {
    if (!pendingCreate) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setPendingCreate(null);
      return;
    }
    if (pendingCreate.kind === 'folder') addFolder(pendingCreate.parentId, trimmed);
    else addRequest(pendingCreate.parentId, trimmed);
    setPendingCreate(null);
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const childrenByFolder = useMemo(() => {
    const out = new Map<string, RenderNode[]>();
    for (const f of Object.values(folders)) {
      if (f.parentId) {
        const list = out.get(f.parentId) ?? [];
        list.push({ kind: 'folder', id: f.id });
        out.set(f.parentId, list);
      }
    }
    for (const r of Object.values(requests)) {
      if (r.folderId) {
        const list = out.get(r.folderId) ?? [];
        list.push({ kind: 'request', id: r.id });
        out.set(r.folderId, list);
      }
    }
    // Sort children alphabetically by name. Folders sort interleaved with
    // requests — keeping the visual ordering predictable across renames.
    const compare = (a: RenderNode, b: RenderNode): number => {
      const aName =
        a.kind === 'folder' ? (folders[a.id]?.name ?? '') : (requests[a.id]?.name ?? '');
      const bName =
        b.kind === 'folder' ? (folders[b.id]?.name ?? '') : (requests[b.id]?.name ?? '');
      return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    };
    for (const list of out.values()) list.sort(compare);
    return out;
  }, [folders, requests]);

  // Search filter — when non-empty, build a set of node keys (`folder:<id>`
  // or `request:<id>`) that should remain visible. A node passes the filter
  // if its own name matches, or any descendant matches; ancestors of a
  // match are always included so the tree path stays intact.
  const searchVisibleKeys = useMemo<Set<string> | null>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const result = new Set<string>();
    const addAncestors = (folderId: string | null) => {
      let p = folderId;
      while (p) {
        result.add(`folder:${p}`);
        p = folders[p]?.parentId ?? null;
      }
    };
    for (const f of Object.values(folders)) {
      if (f.name.toLowerCase().includes(q)) {
        result.add(`folder:${f.id}`);
        addAncestors(f.parentId ?? null);
      }
    }
    for (const r of Object.values(requests)) {
      if (r.name.toLowerCase().includes(q) || r.method.toLowerCase().includes(q)) {
        result.add(`request:${r.id}`);
        addAncestors(r.folderId ?? null);
      }
    }
    return result;
  }, [searchQuery, folders, requests]);

  if (!tree) return null;

  // Top-level: derive from tree.children, but only keep entries whose backing
  // entity has no parent (defends against legacy data that pushed nested
  // entries to root). Sort alphabetically for predictable ordering across
  // renames.
  const topLevel: RenderNode[] = tree.children
    .filter((c) => {
      if (c.kind === 'folder') {
        const f = folders[c.id];
        if (!f || f.parentId !== null) return false;
      } else {
        const r = requests[c.id];
        if (!r || r.folderId !== null) return false;
      }
      // Search filter: hide top-level nodes that don't match (directly or
      // through a descendant). When the query is empty the set is null and
      // every node passes through.
      return searchVisibleKeys === null || searchVisibleKeys.has(`${c.kind}:${c.id}`);
    })
    .sort((a, b) => {
      const aName =
        a.kind === 'folder' ? (folders[a.id]?.name ?? '') : (requests[a.id]?.name ?? '');
      const bName =
        b.kind === 'folder' ? (folders[b.id]?.name ?? '') : (requests[b.id]?.name ?? '');
      return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    });

  return (
    <div className="flex h-full flex-col gap-2">
      <ImportModal open={importOpen} onClose={closeImport} />

      <div className="relative">
        <Search
          size={11}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
        />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search requests…"
          aria-label="Search requests"
          className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[11px] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>

      {topLevel.length === 0 && !pendingCreate && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-dim">
          {searchQuery ? 'No matching requests.' : 'No requests yet. Create one to start.'}
        </p>
      )}

      <ul className="flex flex-col gap-0.5" role="tree" aria-label="Requests">
        {pendingCreate && pendingCreate.parentId === null && (
          <li>
            <CreateInput
              kind={pendingCreate.kind}
              depth={0}
              isAvailable={(name) => validateNewName(null, pendingCreate.kind, name)}
              onCommit={commitCreate}
              onCancel={() => setPendingCreate(null)}
            />
          </li>
        )}
        {topLevel.map((child) => (
          <TreeNode
            key={`${child.kind}-${child.id}`}
            node={child}
            depth={0}
            folders={folders}
            requests={requests}
            childrenByFolder={childrenByFolder}
            expandedFolders={expandedFolders}
            searchVisibleKeys={searchVisibleKeys}
            activeRequestId={activeRequestId}
            onToggleFolder={toggleFolder}
            onSelectRequest={setActiveRequestId}
            onAddRequestInside={(parentId) => startCreate('request', parentId)}
            onAddFolderInside={(parentId) => startCreate('folder', parentId)}
            onRemoveRequest={removeRequest}
            onRemoveFolder={removeFolder}
            onDuplicateRequest={duplicateRequest}
            onDuplicateFolder={duplicateFolder}
            onEditFolderAuth={setAuthModalFolderId}
            renamingKey={renamingKey}
            onStartRename={setRenamingKey}
            onRenameFolder={(id, name) => {
              renameFolder(id, name);
              setRenamingKey(null);
            }}
            onRenameRequest={(id, name) => {
              renameRequest(id, name);
              setRenamingKey(null);
            }}
            onCancelRename={() => setRenamingKey(null)}
            pendingCreate={pendingCreate}
            onStartCreate={startCreate}
            onCommitCreate={commitCreate}
            onCancelCreate={() => setPendingCreate(null)}
            validateNewName={validateNewName}
          />
        ))}
      </ul>
      <LinkedWorkspaceTreeSection />

      {authModalFolderId && folders[authModalFolderId] && (
        <FolderAuthModal
          folder={folders[authModalFolderId]}
          onClose={() => setAuthModalFolderId(null)}
        />
      )}
    </div>
  );
}

/**
 * Renders the kebab menu shown next to the "EDITOR" label in the shared
 * sidebar header. Replaces the previous row of CTA buttons (New request /
 * Import / New folder) above the tree, freeing up vertical space.
 */
export function EditorSidebarActions() {
  const setPendingCreate = useWorkspaceStore((s) => s.setEditorPendingCreate);
  const openImport = useWorkspaceStore((s) => s.openImportModal);

  const items: KebabMenuItem[] = [
    {
      id: 'new-request',
      label: 'New Request',
      icon: <FilePlus2 size={12} aria-hidden="true" />,
      onSelect: () => setPendingCreate({ kind: 'request', parentId: null }),
    },
    {
      id: 'new-folder',
      label: 'New Folder',
      icon: <FolderPlus size={12} aria-hidden="true" />,
      onSelect: () => setPendingCreate({ kind: 'folder', parentId: null }),
    },
    {
      id: 'import',
      label: 'Import',
      icon: <Download size={12} aria-hidden="true" />,
      onSelect: openImport,
      title: 'Import Postman / Insomnia / APICircle / cURL',
    },
  ];

  return <KebabMenu items={items} ariaLabel="Editor actions" size="sm" alwaysVisible />;
}

interface TreeNodeProps {
  node: RenderNode;
  depth: number;
  folders: Record<string, Folder>;
  requests: Record<string, ApiRequest>;
  childrenByFolder: Map<string, RenderNode[]>;
  expandedFolders: Set<string>;
  activeRequestId: string | null;
  onToggleFolder: (id: string) => void;
  onSelectRequest: (id: string) => void;
  onAddRequestInside: (parentId: string) => void;
  onAddFolderInside: (parentId: string) => void;
  onRemoveRequest: (id: string) => void;
  onRemoveFolder: (id: string) => void;
  onDuplicateRequest: (id: string) => string | null;
  onDuplicateFolder: (id: string) => string | null;
  onEditFolderAuth: (folderId: string) => void;
  renamingKey: string | null;
  onStartRename: (key: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRenameRequest: (id: string, name: string) => void;
  onCancelRename: () => void;
  pendingCreate: { kind: 'folder' | 'request'; parentId: string | null } | null;
  onStartCreate: (kind: 'folder' | 'request', parentId: string | null) => void;
  onCommitCreate: (name: string) => void;
  onCancelCreate: () => void;
  validateNewName: (
    parentId: string | null,
    kind: 'folder' | 'request',
    candidate: string,
  ) => boolean;
  /** When non-null, only nodes with `${kind}:${id}` in the set render. */
  searchVisibleKeys: Set<string> | null;
}

function TreeNode(props: TreeNodeProps) {
  const {
    node,
    depth,
    folders,
    requests,
    childrenByFolder,
    expandedFolders,
    activeRequestId,
    onToggleFolder,
    onSelectRequest,
    onAddRequestInside,
    onAddFolderInside,
    onRemoveRequest,
    onRemoveFolder,
    onDuplicateRequest,
    onDuplicateFolder,
    onEditFolderAuth,
    renamingKey,
    onStartRename,
    onRenameFolder,
    onRenameRequest,
    onCancelRename,
    pendingCreate,
    onCommitCreate,
    onCancelCreate,
    validateNewName,
    searchVisibleKeys,
  } = props;

  if (node.kind === 'folder') {
    const folder = folders[node.id];
    if (!folder) return null;
    // Auto-expand folders while a search is active so matches inside
    // collapsed folders surface immediately.
    const isOpen = searchVisibleKeys !== null ? true : expandedFolders.has(folder.id);
    const allChildren = childrenByFolder.get(folder.id) ?? [];
    const children =
      searchVisibleKeys === null
        ? allChildren
        : allChildren.filter((c) => searchVisibleKeys.has(`${c.kind}:${c.id}`));
    const renameKey = `folder:${folder.id}`;
    const isRenaming = renamingKey === renameKey;
    return (
      <li role="treeitem" aria-expanded={isOpen}>
        <div className="group flex items-center rounded-sm border border-transparent text-xs text-text-muted transition-colors hover:border-border-subtle hover:bg-surface hover:text-text-primary">
          {isRenaming ? (
            <div className="flex flex-1 items-center gap-1 px-1 py-1.5">
              {isOpen ? (
                <FolderOpen size={12} className="shrink-0 text-text-faint" />
              ) : (
                <FolderIcon size={12} className="shrink-0 text-text-faint" />
              )}
              <RenameInput
                initial={folder.name}
                ariaLabel={`Rename folder ${folder.name}`}
                onCommit={(next) => onRenameFolder(folder.id, next)}
                onCancel={onCancelRename}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onToggleFolder(folder.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartRename(renameKey);
              }}
              className="flex flex-1 items-center gap-1 truncate px-1 py-1.5 text-left"
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${folder.name}`}
              title="Double-click to rename"
            >
              {isOpen ? (
                <ChevronDown size={12} className="shrink-0 text-text-faint" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-text-faint" />
              )}
              {isOpen ? (
                <FolderOpen size={12} className="shrink-0 text-text-faint" />
              ) : (
                <FolderIcon size={12} className="shrink-0 text-text-faint" />
              )}
              <span className="truncate">{folder.name}</span>
              <span className="ml-1 text-[10px] text-text-dim">{children.length}</span>
            </button>
          )}
          {/* Auth flag — Shield icon when the folder has its own auth set
              (anything other than inherit/none). Click opens the auth
              modal. The kebab menu also includes "Edit auth" for
              keyboard discovery. */}
          {!isRenaming &&
            folder.auth &&
            folder.auth.type !== 'none' &&
            folder.auth.type !== 'inherit' && (
              <button
                type="button"
                onClick={() => onEditFolderAuth(folder.id)}
                aria-label={`Folder auth set (${folder.auth.type}) — edit`}
                title={`Auth: ${folder.auth.type} — click to edit`}
                className="shrink-0 rounded-sm p-0.5 text-accent hover:bg-accent/10"
              >
                <Shield size={12} aria-hidden="true" />
              </button>
            )}
          {!isRenaming && (
            <KebabMenu
              ariaLabel={`Folder actions for ${folder.name}`}
              items={[
                {
                  id: 'rename',
                  label: 'Rename',
                  icon: <Pencil size={12} aria-hidden="true" />,
                  onSelect: () => onStartRename(renameKey),
                },
                {
                  id: 'new-request',
                  label: 'New request inside',
                  icon: <FilePlus2 size={12} aria-hidden="true" />,
                  onSelect: () => onAddRequestInside(folder.id),
                },
                {
                  id: 'new-folder',
                  label: 'New folder inside',
                  icon: <FolderPlus size={12} aria-hidden="true" />,
                  onSelect: () => onAddFolderInside(folder.id),
                },
                {
                  id: 'auth',
                  label:
                    folder.auth && folder.auth.type !== 'none' && folder.auth.type !== 'inherit'
                      ? `Edit auth (${folder.auth.type})`
                      : 'Set auth…',
                  icon: <Shield size={12} aria-hidden="true" />,
                  onSelect: () => onEditFolderAuth(folder.id),
                },
                {
                  id: 'duplicate',
                  label: 'Duplicate',
                  icon: <Copy size={12} aria-hidden="true" />,
                  onSelect: () => onDuplicateFolder(folder.id),
                },
                {
                  id: 'delete',
                  label: 'Delete folder',
                  icon: <Trash2 size={12} aria-hidden="true" />,
                  tone: 'danger',
                  onSelect: () => {
                    if (
                      window.confirm(
                        `Delete folder "${folder.name}" and everything inside? This cannot be undone.`,
                      )
                    ) {
                      onRemoveFolder(folder.id);
                    }
                  },
                },
              ]}
            />
          )}
        </div>
        {isOpen && (
          <ul
            className="ml-3 flex flex-col gap-0.5 border-l border-border-subtle pl-2"
            role="group"
          >
            {pendingCreate && pendingCreate.parentId === folder.id && (
              <li>
                <CreateInput
                  kind={pendingCreate.kind}
                  depth={depth + 1}
                  isAvailable={(name) => validateNewName(folder.id, pendingCreate.kind, name)}
                  onCommit={onCommitCreate}
                  onCancel={onCancelCreate}
                />
              </li>
            )}
            {children.map((c) => (
              <TreeNode key={`${c.kind}-${c.id}`} {...props} node={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const request = requests[node.id];
  if (!request) return null;
  const isActive = request.id === activeRequestId;
  const renameKey = `request:${request.id}`;
  const isRenaming = renamingKey === renameKey;
  return (
    <li role="treeitem" aria-selected={isActive}>
      <div
        className={cn(
          'group flex items-center rounded-sm border text-xs transition-colors',
          isActive
            ? 'border-accent/40 bg-accent/10 text-text-primary'
            : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
        )}
      >
        {isRenaming ? (
          <div className="flex flex-1 items-center gap-2 px-2 py-1.5">
            <span
              className={cn(
                'inline-block w-10 shrink-0 text-left text-[10px] font-medium uppercase tracking-wider tabular-nums',
                METHOD_COLOR[request.method] ?? 'text-text-muted',
              )}
            >
              {request.method}
            </span>
            <RenameInput
              initial={request.name}
              ariaLabel={`Rename request ${request.name}`}
              onCommit={(next) => onRenameRequest(request.id, next)}
              onCancel={onCancelRename}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onSelectRequest(request.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename(renameKey);
            }}
            className="flex flex-1 items-center gap-2 truncate px-2 py-1.5 text-left"
            title="Double-click to rename"
          >
            <span
              className={cn(
                'inline-block w-10 shrink-0 text-left text-[10px] font-medium uppercase tracking-wider tabular-nums',
                METHOD_COLOR[request.method] ?? 'text-text-muted',
              )}
            >
              {request.method}
            </span>
            <span className="truncate">{request.name}</span>
          </button>
        )}
        {!isRenaming && (
          <KebabMenu
            ariaLabel={`Request actions for ${request.name}`}
            items={[
              {
                id: 'rename',
                label: 'Rename',
                icon: <Pencil size={12} aria-hidden="true" />,
                onSelect: () => onStartRename(renameKey),
              },
              {
                id: 'duplicate',
                label: 'Duplicate',
                icon: <Copy size={12} aria-hidden="true" />,
                onSelect: () => onDuplicateRequest(request.id),
              },
              {
                id: 'delete',
                label: 'Delete request',
                icon: <Trash2 size={12} aria-hidden="true" />,
                tone: 'danger',
                onSelect: () => onRemoveRequest(request.id),
              },
            ]}
          />
        )}
      </div>
    </li>
  );
}

interface RenameInputProps {
  initial: string;
  ariaLabel: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

function RenameInput({ initial, ariaLabel, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== initial) onCommit(trimmed);
        else onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const trimmed = value.trim();
          if (trimmed && trimmed !== initial) onCommit(trimmed);
          else onCancel();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      aria-label={ariaLabel}
      className="h-6 flex-1 rounded-sm border border-accent bg-card px-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
    />
  );
}

interface CreateInputProps {
  kind: 'folder' | 'request';
  depth: number;
  /** Returns false when `name` collides with a sibling. Live-validated. */
  isAvailable: (name: string) => boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/**
 * Inline name-first prompt rendered in the sidebar tree when the user clicks
 * "New request" / "New folder". The entity isn't created until the user
 * confirms a name. Live-validates against duplicates in the same folder.
 */
function CreateInput({ kind, depth, isAvailable, onCommit, onCancel }: CreateInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmed = value.trim();
  const duplicate = trimmed.length > 0 && !isAvailable(trimmed);
  void depth; // depth is supplied for potential future indent logic; tree-line guides handle visual nesting via the wrapping <ul>.

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const tryCommit = () => {
    if (!trimmed) {
      onCancel();
      return;
    }
    if (duplicate) return; // keep input open with the warning
    onCommit(trimmed);
  };

  return (
    <div className="flex items-center gap-1 rounded-sm border border-accent/30 bg-accent/5 px-1 py-1.5 text-xs">
      {kind === 'folder' ? (
        <FolderIcon size={12} className="shrink-0 text-text-faint" />
      ) : (
        <FilePlus2 size={12} className="shrink-0 text-text-faint" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          // Defer cancel: blur fires before any click on a sibling button can
          // be processed. If the user just confirmed, trimmed is set and we
          // either committed or surfaced a duplicate warning.
          if (!duplicate) tryCommit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            tryCommit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={`Inline rename ${kind}`}
        aria-invalid={duplicate}
        placeholder={kind === 'folder' ? 'Folder name' : 'Request name'}
        className={cn(
          'h-6 flex-1 rounded-sm border bg-card px-1.5 text-xs text-text-primary focus:outline-none focus:ring-1',
          duplicate
            ? 'border-danger focus:border-danger focus:ring-danger/40'
            : 'border-accent focus:border-accent focus:ring-accent/40',
        )}
      />
      {duplicate && (
        <span className="text-[10px] text-danger" role="alert">
          Name already used
        </span>
      )}
    </div>
  );
}
