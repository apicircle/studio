import { FilePlus2, FolderPlus, Trash2 } from 'lucide-react';
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

export function EditorSidebar() {
  const tree = useWorkspaceStore((s) => s.synced?.collections.tree);
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const folders = useWorkspaceStore((s) => s.synced?.collections.folders ?? {});
  const activeRequestId = useWorkspaceStore((s) => s.local?.ui.activeRequestId ?? null);
  const addRequest = useWorkspaceStore((s) => s.addRequest);
  const addFolder = useWorkspaceStore((s) => s.addFolder);
  const removeRequest = useWorkspaceStore((s) => s.removeRequest);
  const setActiveRequestId = useWorkspaceStore((s) => s.setActiveRequestId);

  if (!tree) return null;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => addRequest(null)}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="New request"
        >
          <FilePlus2 size={12} />
          New request
        </button>
        <button
          type="button"
          onClick={() => addFolder(null)}
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="New folder"
        >
          <FolderPlus size={12} />
        </button>
      </div>

      <ul className="flex flex-col gap-0.5" role="tree" aria-label="Requests">
        {tree.children.length === 0 && (
          <li className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-dim">
            No requests yet. Create one to start.
          </li>
        )}
        {tree.children.map((child) => {
          if (child.kind === 'folder') {
            const folder = folders[child.id];
            if (!folder) return null;
            return (
              <li
                key={`folder-${child.id}`}
                className="rounded-sm border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-muted"
                role="treeitem"
              >
                {folder.name}
              </li>
            );
          }
          const request = requests[child.id];
          if (!request) return null;
          const isActive = request.id === activeRequestId;
          return (
            <li key={`request-${child.id}`} role="treeitem" aria-selected={isActive}>
              <div
                className={cn(
                  'group flex items-center gap-2 rounded-sm border px-2 py-1.5 text-xs transition-colors',
                  isActive
                    ? 'border-accent/40 bg-accent/10 text-text-primary'
                    : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveRequestId(request.id)}
                  className="flex flex-1 items-center gap-2 truncate text-left"
                >
                  <span
                    className={cn(
                      'shrink-0 font-medium tracking-wider',
                      METHOD_COLOR[request.method] ?? 'text-text-muted',
                    )}
                  >
                    {request.method}
                  </span>
                  <span className="truncate">{request.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeRequest(request.id)}
                  className="shrink-0 text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  aria-label={`Delete ${request.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
