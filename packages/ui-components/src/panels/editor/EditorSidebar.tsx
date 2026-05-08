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
  Shield,
  Trash2,
} from 'lucide-react';
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
  const [importOpen, setImportOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [authModalFolderId, setAuthModalFolderId] = useState<string | null>(null);
  // Tracks which node is currently being renamed inline. Keyed as
  // `folder:<id>` or `request:<id>` so a folder and request with the same id
  // (impossible today, but cheap to be explicit) can't collide.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  /**
   * Active name-first prompt for "New request" / "New folder". When set, an
   * inline input row renders at the appropriate spot in the tree and the
   * entity isn't created until the user confirms a name.
   */
  const [pendingCreate, setPendingCreate] = useState<{
    kind: 'folder' | 'request';
    parentId: string | null;
  } | null>(null);

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

  if (!tree) return null;

  // Top-level: derive from tree.children, but only keep entries whose backing
  // entity has no parent (defends against legacy data that pushed nested
  // entries to root). Sort alphabetically for predictable ordering across
  // renames.
  const topLevel: RenderNode[] = tree.children
    .filter((c) => {
      if (c.kind === 'folder') {
        const f = folders[c.id];
        return Boolean(f && f.parentId === null);
      }
      const r = requests[c.id];
      return Boolean(r && r.folderId === null);
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
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => startCreate('request', null)}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="New request"
        >
          <FilePlus2 size={12} />
          New request
        </button>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="Import"
          title="Import Postman / Insomnia / APICircle / cURL"
        >
          <Download size={12} />
        </button>
        <button
          type="button"
          onClick={() => startCreate('folder', null)}
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="New folder"
        >
          <FolderPlus size={12} />
        </button>
      </div>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      {topLevel.length === 0 && !pendingCreate && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-dim">
          No requests yet. Create one to start.
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
  } = props;
  const indentPx = depth * 12;

  if (node.kind === 'folder') {
    const folder = folders[node.id];
    if (!folder) return null;
    const isOpen = expandedFolders.has(folder.id);
    const children = childrenByFolder.get(folder.id) ?? [];
    const renameKey = `folder:${folder.id}`;
    const isRenaming = renamingKey === renameKey;
    return (
      <li role="treeitem" aria-expanded={isOpen}>
        <div
          className="group flex items-center gap-1 rounded-sm border border-transparent px-1 py-1.5 text-xs text-text-muted transition-colors hover:border-border-subtle hover:bg-surface hover:text-text-primary"
          style={{ paddingLeft: 4 + indentPx }}
        >
          {isRenaming ? (
            <div className="flex flex-1 items-center gap-1">
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
              className="flex flex-1 items-center gap-1 truncate text-left"
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
          {/* Auth flag — small accent dot when the folder has its own
              auth set (anything other than inherit/none). Click opens
              the auth modal. The kebab menu also includes "Edit auth"
              for keyboard discovery. */}
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
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-accent" />
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
          <ul className="flex flex-col gap-0.5" role="group">
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
          'group flex items-center gap-2 rounded-sm border px-2 py-1.5 text-xs transition-colors',
          isActive
            ? 'border-accent/40 bg-accent/10 text-text-primary'
            : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
        )}
        style={{ paddingLeft: 8 + indentPx }}
      >
        {isRenaming ? (
          <div className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'shrink-0 text-[10px] font-medium uppercase tracking-wider',
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
            className="flex flex-1 items-center gap-2 truncate text-left"
            title="Double-click to rename"
          >
            <span
              className={cn(
                'shrink-0 text-[10px] font-medium uppercase tracking-wider',
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
  const indentPx = depth * 12;

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
    <div
      className="flex items-center gap-1 rounded-sm border border-accent/30 bg-accent/5 px-1 py-1.5 text-xs"
      style={{ paddingLeft: 4 + indentPx }}
    >
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
