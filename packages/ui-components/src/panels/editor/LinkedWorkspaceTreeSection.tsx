import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  Link2,
  Package,
  RefreshCw,
  Shield,
} from 'lucide-react';
import type {
  Folder,
  LinkedSnapshot,
  LinkedWorkspace,
  Request as ApiRequest,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';

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

/**
 * Renders every linked workspace as a collapsible top-level group below
 * the consumer's own collection tree. Each group surfaces the source's
 * folders + requests as a read-only browse — clicking a request opens
 * the existing linked-request editor where the user can edit field
 * overrides and reset to source.
 *
 * The override-dot indicator on each request reads
 * `synced.linkedOverrides.requests` so a linked request that the user
 * has modified is immediately visible in the sidebar.
 */
export function LinkedWorkspaceTreeSection({ searchQuery }: { searchQuery?: string } = {}) {
  const links = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.linkedWorkspaces) : [],
  );
  if (links.length === 0) return null;
  const trimmedQuery = searchQuery?.trim().toLowerCase() ?? '';
  return (
    <section aria-label="Linked workspaces" className="mt-3 border-t border-border-subtle pt-3">
      <h2 className="mb-1.5 px-1 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
        Linked workspaces
      </h2>
      <ul className="flex flex-col gap-0.5" role="tree" aria-label="Linked workspaces">
        {links.map((link) => (
          <LinkedRoot key={link.id} link={link} searchQuery={trimmedQuery} />
        ))}
      </ul>
    </section>
  );
}

function LinkedRoot({ link, searchQuery }: { link: LinkedWorkspace; searchQuery: string }) {
  const snapshot = useWorkspaceStore((s) => s.local?.linkedCollections[link.id] ?? null);
  // Auto-expand the group while a search is active so matches deep in the
  // linked tree are reachable without manual expansion. Mirrors the local
  // tree's auto-expand behavior.
  const [open, setOpen] = useState(false);
  const effectivelyOpen = searchQuery.length > 0 ? true : open;
  const overrideCount = useWorkspaceStore((s) => {
    if (!s.synced) return 0;
    let count = 0;
    for (const o of Object.values(s.synced.linkedOverrides.requests)) {
      if (o.linkedWorkspaceId === link.id) count += 1;
    }
    for (const o of Object.values(s.synced.linkedOverrides.environmentVars)) {
      if (o.linkedWorkspaceId === link.id) count += 1;
    }
    return count;
  });

  return (
    <li role="treeitem" aria-expanded={effectivelyOpen}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${effectivelyOpen ? 'Collapse' : 'Expand'} linked workspace ${link.name}`}
        className="group flex w-full items-center gap-1.5 rounded-sm border border-transparent px-1 py-1.5 text-xs text-text-muted transition-colors hover:border-border-subtle hover:bg-surface hover:text-text-primary"
      >
        {effectivelyOpen ? (
          <ChevronDown size={12} className="shrink-0 text-text-faint" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-text-faint" />
        )}
        <Package size={12} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="truncate">{link.name}</span>
        {link.pinnedVersion && (
          <span
            className="shrink-0 rounded-sm border border-border bg-card px-1 py-0.5 font-mono text-[0.5625rem] text-text-dim"
            title={`Pinned version v${link.pinnedVersion}`}
          >
            v{link.pinnedVersion}
          </span>
        )}
        {overrideCount > 0 && (
          <span
            className="shrink-0 rounded-sm border border-accent/40 bg-accent/10 px-1 py-0.5 text-[0.5625rem] text-accent"
            title={`${overrideCount} local modification${overrideCount === 1 ? '' : 's'}`}
          >
            {overrideCount} mod{overrideCount === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {effectivelyOpen && (
        <div className="pl-3">
          {snapshot ? (
            <LinkedTree link={link} snapshot={snapshot} searchQuery={searchQuery} />
          ) : (
            <RefreshLinkInline linkId={link.id} />
          )}
        </div>
      )}
    </li>
  );
}

function LinkedTree({
  link,
  snapshot,
  searchQuery,
}: {
  link: LinkedWorkspace;
  snapshot: LinkedSnapshot;
  searchQuery: string;
}) {
  const tree = snapshot.collections.tree;
  const folders = snapshot.collections.folders;
  const requests = snapshot.collections.requests;
  const childrenByFolder = buildChildrenByFolder(folders, requests);

  // Mirror the local tree's search filter: when the editor's search field
  // is non-empty, walk the snapshot collecting node keys whose name (or
  // method, for requests) matches, plus their ancestors. Empty query =>
  // null = render everything.
  const visibleKeys: Set<string> | null = (() => {
    if (!searchQuery) return null;
    const result = new Set<string>();
    const addAncestors = (folderId: string | null) => {
      let p = folderId;
      while (p) {
        result.add(`folder:${p}`);
        p = folders[p]?.parentId ?? null;
      }
    };
    for (const f of Object.values(folders)) {
      if (f.name.toLowerCase().includes(searchQuery)) {
        result.add(`folder:${f.id}`);
        addAncestors(f.parentId ?? null);
      }
    }
    for (const r of Object.values(requests)) {
      if (
        r.name.toLowerCase().includes(searchQuery) ||
        r.method.toLowerCase().includes(searchQuery)
      ) {
        result.add(`request:${r.id}`);
        addAncestors(r.folderId ?? null);
      }
    }
    return result;
  })();

  const topLevel: RenderNode[] = tree.children
    .filter((c) => {
      if (c.kind === 'folder') {
        const f = folders[c.id];
        if (!f || f.parentId !== null) return false;
        return visibleKeys === null || visibleKeys.has(`folder:${c.id}`);
      }
      const r = requests[c.id];
      if (!r || r.folderId !== null) return false;
      return visibleKeys === null || visibleKeys.has(`request:${c.id}`);
    })
    .sort(byName(folders, requests));

  if (topLevel.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-border-subtle px-2 py-1.5 text-[0.6875rem] text-text-dim">
        {searchQuery
          ? 'No matching requests in this linked workspace.'
          : 'Source has no requests or folders yet.'}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5" role="group">
      {topLevel.map((child) => (
        <LinkedNode
          key={`${child.kind}-${child.id}`}
          node={child}
          depth={0}
          link={link}
          folders={folders}
          requests={requests}
          childrenByFolder={childrenByFolder}
          visibleKeys={visibleKeys}
        />
      ))}
    </ul>
  );
}

interface LinkedNodeProps {
  node: RenderNode;
  depth: number;
  link: LinkedWorkspace;
  folders: Record<string, Folder>;
  requests: Record<string, ApiRequest>;
  childrenByFolder: Map<string, RenderNode[]>;
  /**
   * Filter set from the editor sidebar's search field. `null` = no
   * search active (show everything). When non-null, only nodes whose
   * key is in the set render — and folders auto-expand so matches
   * deeper in the tree stay reachable without manual clicking.
   */
  visibleKeys: Set<string> | null;
}

function LinkedNode(props: LinkedNodeProps) {
  const { node, depth, link, folders, requests, childrenByFolder, visibleKeys } = props;
  const indentPx = depth * 12;
  const [open, setOpen] = useState(false);
  // Auto-expand while a search filter is active (matches the local tree's
  // behavior in EditorSidebar).
  const effectivelyOpen = visibleKeys !== null ? true : open;

  if (node.kind === 'folder') {
    const folder = folders[node.id];
    if (!folder) return null;
    const allChildren = childrenByFolder.get(folder.id) ?? [];
    const children =
      visibleKeys === null
        ? allChildren
        : allChildren.filter((c) => visibleKeys.has(`${c.kind}:${c.id}`));
    return (
      <li role="treeitem" aria-expanded={effectivelyOpen}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 rounded-sm border border-transparent px-1 py-1.5 text-xs text-text-muted transition-colors hover:border-border-subtle hover:bg-surface hover:text-text-primary"
          style={{ paddingLeft: 4 + indentPx }}
          aria-label={`${effectivelyOpen ? 'Collapse' : 'Expand'} ${folder.name}`}
        >
          {effectivelyOpen ? (
            <ChevronDown size={12} className="shrink-0 text-text-faint" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-text-faint" />
          )}
          {effectivelyOpen ? (
            <FolderOpen size={12} className="shrink-0 text-text-faint" />
          ) : (
            <FolderIcon size={12} className="shrink-0 text-text-faint" />
          )}
          <span className="truncate">{folder.name}</span>
          <span className="ml-1 text-[0.625rem] text-text-dim">{children.length}</span>
          {/* Read-only mirror of the local tree's Shield indicator: shows
              when the source folder has its OWN auth set (not 'inherit' /
              'none'). The user can't edit linked-folder auth from this
              tree — that's source-pinned. The icon just makes the
              cascade visible so request-level inherit semantics aren't
              a black box. */}
          {folder.auth && folder.auth.type !== 'none' && folder.auth.type !== 'inherit' && (
            <Shield
              size={10}
              aria-label={`Source-side folder auth: ${folder.auth.type}`}
              className="ml-0.5 shrink-0 text-accent"
            />
          )}
        </button>
        {effectivelyOpen && (
          <ul className="flex flex-col gap-0.5" role="group">
            {children.map((c) => (
              <LinkedNode key={`${c.kind}-${c.id}`} {...props} node={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return <LinkedRequestRow request={requests[node.id]} link={link} depth={depth} />;
}

function LinkedRequestRow({
  request,
  link,
  depth,
}: {
  request: ApiRequest | undefined;
  link: LinkedWorkspace;
  depth: number;
}) {
  const setActiveLinkedRequest = useWorkspaceStore((s) => s.setActiveLinkedRequest);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  // Highlight when this linked request is the editor's active row. Mirrors
  // the local-tree selection cue so the user can see at-a-glance which
  // request the editor is currently editing — previously the linked rows
  // had no selected state and the user lost their place after navigating.
  const isActive = useWorkspaceStore((s) => {
    const a = s.activeLinkedRequest;
    return Boolean(a && request && a.linkedWorkspaceId === link.id && a.itemId === request.id);
  });
  const overrideKey = request ? `${link.id}:${request.id}` : null;
  const hasOverride = useWorkspaceStore((s) =>
    overrideKey ? Boolean(s.synced?.linkedOverrides.requests[overrideKey]) : false,
  );
  if (!request) return null;
  const indentPx = depth * 12;
  return (
    <li role="treeitem" aria-selected={isActive}>
      <button
        type="button"
        onClick={() => {
          // Open the linked request in the main editor (replacing the old
          // modal). The store action also clears `activeRequestId` so the
          // editor's unified selector resolves to the linked view.
          setActiveLinkedRequest({ linkedWorkspaceId: link.id, itemId: request.id });
          if (activePanel !== 'editor') setActivePanel('editor');
        }}
        className={cn(
          'group flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-xs transition-colors',
          isActive
            ? 'border-accent/60 bg-accent/15 text-text-primary'
            : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
        )}
        style={{ paddingLeft: 8 + indentPx }}
        aria-label={`Open ${request.name} from ${link.name}${hasOverride ? ' (modified)' : ''}`}
      >
        <span
          className={cn(
            'shrink-0 font-medium tracking-wider',
            METHOD_COLOR[request.method] ?? 'text-text-muted',
          )}
        >
          {request.method}
        </span>
        <Link2
          size={10}
          className="shrink-0 text-text-faint"
          aria-hidden="true"
          aria-label="Linked"
        />
        <span className="truncate">{request.name}</span>
        {hasOverride && (
          <span
            aria-label="locally modified"
            title="Locally modified — open to view or reset"
            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
          />
        )}
      </button>
    </li>
  );
}

function buildChildrenByFolder(
  folders: Record<string, Folder>,
  requests: Record<string, ApiRequest>,
): Map<string, RenderNode[]> {
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
  const compare = byName(folders, requests);
  for (const list of out.values()) list.sort(compare);
  return out;
}

function byName(folders: Record<string, Folder>, requests: Record<string, ApiRequest>) {
  return (a: RenderNode, b: RenderNode): number => {
    const aName = a.kind === 'folder' ? (folders[a.id]?.name ?? '') : (requests[a.id]?.name ?? '');
    const bName = b.kind === 'folder' ? (folders[b.id]?.name ?? '') : (requests[b.id]?.name ?? '');
    return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  };
}

/**
 * Inline "Refresh link" affordance shown when a linked workspace has been
 * declared in `synced.linkedWorkspaces` but its snapshot hasn't been
 * fetched yet (common on first clone, or after a remote pull that adds
 * a new link). Saves the user a trip to the Link Workspace panel.
 */
function RefreshLinkInline({ linkId }: { linkId: string }) {
  const refreshLinkedWorkspace = useWorkspaceStore((s) => s.refreshLinkedWorkspace);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [refreshing, setRefreshing] = useState(false);
  const onClick = async () => {
    setRefreshing(true);
    try {
      await refreshLinkedWorkspace(linkId);
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Refresh link failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="space-y-1.5 rounded-sm border border-dashed border-border-subtle px-2 py-1.5 text-[0.6875rem] text-text-dim">
      <p>Snapshot not loaded yet.</p>
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={refreshing}
        className="inline-flex h-6 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 text-[0.625rem] text-accent hover:bg-accent/20 disabled:opacity-50"
      >
        <RefreshCw size={9} aria-hidden="true" />
        {refreshing ? 'Refreshing…' : 'Refresh link'}
      </button>
    </div>
  );
}
