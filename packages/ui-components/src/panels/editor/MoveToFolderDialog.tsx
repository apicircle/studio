import { useId, useMemo, useState } from 'react';
import { CornerLeftUp, Folder as FolderIcon, Search } from 'lucide-react';
import type { Folder, WorkspaceSynced } from '@apicircle/shared';
import { Button } from '../../primitives/Button';
import { cn } from '../../primitives/cn';
import { Modal } from '../../primitives/Modal';
import { moveRefusal, type CollectionNodeRef } from '../../store/editorActions';

interface MoveToFolderDialogProps {
  synced: WorkspaceSynced;
  /** What is being moved; the dialog is shut while this is null. */
  node: CollectionNodeRef | null;
  onClose: () => void;
  /** Moves `node` into `destination` (`null`: the top level). */
  onMove: (node: CollectionNodeRef, destination: string | null) => void;
}

interface Destination {
  /** `null` is the top level. */
  id: string | null;
  name: string;
  /** The names from the top level down to it, for a filtered list. */
  path: string[];
  depth: number;
}

/** Every folder, depth first and by name at each level, as the sidebar lists them. */
function folderDestinations(folders: Record<string, Folder>): Destination[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of Object.values(folders)) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  const out: Destination[] = [];
  const visit = (parentId: string | null, path: string[]): void => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    for (const folder of children) {
      const own = [...path, folder.name];
      out.push({ id: folder.id, name: folder.name, path: own, depth: path.length });
      // Only folders hanging from the top level are reached, so a malformed
      // loop of parents (which never reaches it) is never walked.
      visit(folder.id, own);
    }
  };
  visit(null, []);
  return out;
}

/**
 * Where a request or a folder goes, picked from the top level and every
 * folder. A place it cannot go stays in the list, disabled, with the reason on
 * its row — already there, inside itself, or a name taken there.
 */
export function MoveToFolderDialog({ synced, node, onClose, onMove }: MoveToFolderDialogProps) {
  if (!node) return null;
  return <MoveToFolderBody synced={synced} node={node} onClose={onClose} onMove={onMove} />;
}

function MoveToFolderBody({
  synced,
  node,
  onClose,
  onMove,
}: MoveToFolderDialogProps & { node: CollectionNodeRef }) {
  const [filter, setFilter] = useState('');
  const reasonPrefix = useId();
  const { folders, requests } = synced.collections;
  const name = (node.kind === 'folder' ? folders[node.id]?.name : requests[node.id]?.name) ?? '';
  const all = useMemo(() => folderDestinations(folders), [folders]);
  const query = filter.trim().toLowerCase();
  const filtered = query
    ? all.filter((d) => d.path.join(' / ').toLowerCase().includes(query))
    : all;
  const destinations: Destination[] = [
    ...(query ? [] : [{ id: null, name: 'Top level', path: [], depth: 0 }]),
    ...filtered,
  ];

  return (
    <Modal open onClose={onClose} title={`Move “${name}”`} className="max-w-md">
      <div className="flex flex-col gap-3 text-xs">
        <p className="text-text-muted">
          {node.kind === 'folder'
            ? 'Pick where the folder goes. Everything in it moves with it.'
            : 'Pick where the request goes.'}
        </p>
        {all.length > 0 && (
          <div className="relative">
            <Search
              size={11}
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
            />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter folders…"
              aria-label="Filter folders"
              className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        )}
        {all.length === 0 && (
          <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-text-dim">
            There are no folders yet. Make one with New folder in the Editor menu.
          </p>
        )}
        {destinations.length === 0 ? (
          <p className="text-text-dim">No folder matches “{filter.trim()}”.</p>
        ) : (
          <ul aria-label="Destinations" className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {destinations.map((d, i) => {
              const reason = moveRefusal(synced, node, d.id);
              const reasonId = `${reasonPrefix}-${i}`;
              const label = d.id === null || !query ? d.name : d.path.join(' / ');
              return (
                <li key={d.id ?? 'top'}>
                  <button
                    type="button"
                    disabled={reason !== null}
                    aria-describedby={reason !== null ? reasonId : undefined}
                    onClick={() => onMove(node, d.id)}
                    style={query ? undefined : { paddingLeft: `${0.5 + d.depth * 0.875}rem` }}
                    className={cn(
                      'flex min-h-7 w-full items-center gap-1.5 rounded-sm border border-transparent px-2 py-1 text-left',
                      'enabled:hover:border-border-subtle enabled:hover:bg-surface enabled:hover:text-text-primary',
                      'disabled:cursor-not-allowed',
                      reason === null ? 'text-text-muted' : 'text-text-faint',
                    )}
                  >
                    {d.id === null ? (
                      <CornerLeftUp size={12} aria-hidden="true" className="shrink-0" />
                    ) : (
                      <FolderIcon size={12} aria-hidden="true" className="shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{label}</span>
                    {reason !== null && (
                      <span id={reasonId} className="ml-auto shrink-0 pl-2 text-text-dim">
                        {reason}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
