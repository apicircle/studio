import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  Link2,
  Package,
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
export function LinkedWorkspaceTreeSection() {
  const links = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.linkedWorkspaces) : [],
  );
  if (links.length === 0) return null;
  return (
    <section aria-label="Linked workspaces" className="mt-3 border-t border-border-subtle pt-3">
      <h2 className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-text-dim">
        Linked workspaces
      </h2>
      <ul className="flex flex-col gap-0.5" role="tree" aria-label="Linked workspaces">
        {links.map((link) => (
          <LinkedRoot key={link.id} link={link} />
        ))}
      </ul>
    </section>
  );
}

function LinkedRoot({ link }: { link: LinkedWorkspace }) {
  const snapshot = useWorkspaceStore((s) => s.local?.linkedCollections[link.id] ?? null);
  const [open, setOpen] = useState(false);
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
    <li role="treeitem" aria-expanded={open}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${open ? 'Collapse' : 'Expand'} linked workspace ${link.name}`}
        className="group flex w-full items-center gap-1.5 rounded-sm border border-transparent px-1 py-1.5 text-xs text-text-muted transition-colors hover:border-border-subtle hover:bg-surface hover:text-text-primary"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0 text-text-faint" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-text-faint" />
        )}
        <Package size={12} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="truncate">{link.name}</span>
        {link.pinnedVersion && (
          <span
            className="shrink-0 rounded-sm border border-border bg-card px-1 py-0.5 font-mono text-[9px] text-text-dim"
            title={`Pinned version v${link.pinnedVersion}`}
          >
            v{link.pinnedVersion}
          </span>
        )}
        {overrideCount > 0 && (
          <span
            className="shrink-0 rounded-sm border border-accent/40 bg-accent/10 px-1 py-0.5 text-[9px] text-accent"
            title={`${overrideCount} local modification${overrideCount === 1 ? '' : 's'}`}
          >
            {overrideCount} mod{overrideCount === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {open && (
        <div className="pl-3">
          {snapshot ? (
            <LinkedTree link={link} snapshot={snapshot} />
          ) : (
            <p className="rounded-sm border border-dashed border-border-subtle px-2 py-1.5 text-[11px] text-text-dim">
              Refresh this link from the Link Workspace panel to load its content.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function LinkedTree({ link, snapshot }: { link: LinkedWorkspace; snapshot: LinkedSnapshot }) {
  const tree = snapshot.collections.tree;
  const folders = snapshot.collections.folders;
  const requests = snapshot.collections.requests;
  const childrenByFolder = buildChildrenByFolder(folders, requests);

  const topLevel: RenderNode[] = tree.children
    .filter((c) => {
      if (c.kind === 'folder') {
        const f = folders[c.id];
        return Boolean(f && f.parentId === null);
      }
      const r = requests[c.id];
      return Boolean(r && r.folderId === null);
    })
    .sort(byName(folders, requests));

  if (topLevel.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-border-subtle px-2 py-1.5 text-[11px] text-text-dim">
        Source has no requests or folders yet.
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
}

function LinkedNode(props: LinkedNodeProps) {
  const { node, depth, link, folders, requests, childrenByFolder } = props;
  const indentPx = depth * 12;
  const [open, setOpen] = useState(false);

  if (node.kind === 'folder') {
    const folder = folders[node.id];
    if (!folder) return null;
    const children = childrenByFolder.get(folder.id) ?? [];
    return (
      <li role="treeitem" aria-expanded={open}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 rounded-sm border border-transparent px-1 py-1.5 text-xs text-text-muted transition-colors hover:border-border-subtle hover:bg-surface hover:text-text-primary"
          style={{ paddingLeft: 4 + indentPx }}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${folder.name}`}
        >
          {open ? (
            <ChevronDown size={12} className="shrink-0 text-text-faint" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-text-faint" />
          )}
          {open ? (
            <FolderOpen size={12} className="shrink-0 text-text-faint" />
          ) : (
            <FolderIcon size={12} className="shrink-0 text-text-faint" />
          )}
          <span className="truncate">{folder.name}</span>
          <span className="ml-1 text-[10px] text-text-dim">{children.length}</span>
        </button>
        {open && (
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
  const overrideKey = request ? `${link.id}:${request.id}` : null;
  const hasOverride = useWorkspaceStore((s) =>
    overrideKey ? Boolean(s.synced?.linkedOverrides.requests[overrideKey]) : false,
  );
  if (!request) return null;
  const indentPx = depth * 12;
  return (
    <li role="treeitem">
      <button
        type="button"
        onClick={() => setActiveLinkedRequest({ linkedWorkspaceId: link.id, itemId: request.id })}
        className="group flex w-full items-center gap-2 rounded-sm border border-transparent px-2 py-1.5 text-xs text-text-muted transition-colors hover:border-border-subtle hover:bg-surface hover:text-text-primary"
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
