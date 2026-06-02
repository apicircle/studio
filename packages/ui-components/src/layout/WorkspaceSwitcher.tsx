import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Modal } from '../primitives/Modal';
import { ConfirmDialog } from '../primitives/ConfirmDialog';

// B.6 — Top-bar workspace switcher. Replaces the static `/ <name>` chip
// with a dropdown that lists all registered workspaces, lets the user
// switch with a click, and exposes "New workspace" + per-row delete.
//
// Sorting matches lastOpenedAt (most recent first) so the switch list
// behaves like a "recents" list — the workspace you just used is at the
// top, and the active one is always pinned at index 0 anyway.

export function WorkspaceSwitcher() {
  const registry = useWorkspaceStore((s) => s.workspaceRegistry);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const createNewWorkspace = useWorkspaceStore((s) => s.createNewWorkspace);
  const deleteWorkspaceById = useWorkspaceStore((s) => s.deleteWorkspaceById);

  // The active workspace's display name comes from the registry — the
  // git-synced doc no longer carries a name, so the dropdown and the
  // active-name chip share the same source and can never disagree.
  const activeWorkspaceName =
    registry?.workspaces.find((w) => w.id === registry.activeWorkspaceId)?.name ?? '';

  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside to close the dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  if (!registry) return null;

  const sorted = [...registry.workspaces].sort((a, b) =>
    a.id === registry.activeWorkspaceId
      ? -1
      : b.id === registry.activeWorkspaceId
        ? 1
        : b.lastOpenedAt.localeCompare(a.lastOpenedAt),
  );

  // Pre-launch builds + legacy migrations sometimes produced multiple
  // registry entries with the same (case-insensitive) display name —
  // e.g. a legacy single-workspace migration plus a UI "create new"
  // both defaulting to "My Workspace". The 1.0.8 create / rename
  // guards block new collisions, but existing rows still render here,
  // and showing two identical rows leaves the user with no way to
  // tell them apart. Detect collisions and append a short id suffix
  // (first 4 hex chars) to ONLY the colliding rows — unique names
  // stay clean.
  const nameCounts = new Map<string, number>();
  for (const w of sorted) {
    const key = w.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const disambiguatorFor = (name: string, id: string): string | null => {
    if ((nameCounts.get(name.toLowerCase()) ?? 0) <= 1) return null;
    return id.slice(0, 4);
  };

  const onSwitch = async (id: string) => {
    setError(null);
    setOpen(false);
    try {
      await switchWorkspace(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Switch failed');
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        data-tour="workspace-switcher"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Switch workspace (current: ${activeWorkspaceName})`}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Always visible — the workspace name hides on narrow viewports but
        // the chevron stays so the switcher remains reachable. Previously
        // the entire button was `hidden sm:inline-flex`, leaving mobile
        // users with no way to switch workspaces (audit gap #12).
        className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
      >
        <span className="hidden text-text-dim sm:inline">/</span>
        <span className="hidden max-w-[10rem] truncate font-medium text-text-primary sm:inline">
          {activeWorkspaceName}
        </span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Workspaces"
          className="absolute left-0 top-full z-30 mt-1 min-w-[18rem] rounded-sm border border-border-strong bg-card p-1 shadow-elevated"
        >
          {sorted.map((w) => {
            const isActive = w.id === registry.activeWorkspaceId;
            const disambiguator = disambiguatorFor(w.name, w.id);
            const ariaLabel = disambiguator
              ? `Switch to ${w.name} (id ${disambiguator})`
              : `Switch to ${w.name}`;
            return (
              <li key={w.id}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    aria-label={ariaLabel}
                    onClick={() => void onSwitch(w.id)}
                    className={
                      isActive
                        ? 'flex flex-1 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-2 py-1.5 text-left text-xs text-accent'
                        : 'flex flex-1 items-center gap-2 rounded-sm border border-transparent px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface hover:text-text-primary'
                    }
                  >
                    <span className="flex-1 truncate">{w.name}</span>
                    {disambiguator && (
                      <span
                        className="font-mono text-[0.625rem] text-text-faint"
                        aria-hidden="true"
                      >
                        #{disambiguator}
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[0.625rem] uppercase tracking-wider">active</span>
                    )}
                  </button>
                  {sorted.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ id: w.id, name: w.name })}
                      aria-label={
                        disambiguator
                          ? `Delete ${w.name} (id ${disambiguator})`
                          : `Delete ${w.name}`
                      }
                      className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-text-faint hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          <li className="mt-1 border-t border-border-subtle pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNewOpen(true);
              }}
              aria-label="New workspace"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-accent hover:bg-accent/5"
            >
              <Plus size={11} aria-hidden="true" />
              New workspace…
            </button>
          </li>
        </ul>
      )}
      {error && (
        <p
          className="absolute left-0 top-full z-20 mt-1 max-w-[18rem] rounded-sm border border-danger/40 bg-danger/10 px-2 py-1 text-[0.625rem] text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
      <NewWorkspaceModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={async (name) => {
          await createNewWorkspace(name);
          setNewOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete ${confirmDelete?.name ?? ''}?`}
        tone="danger"
        confirmLabel="Delete workspace"
        description={
          <p>
            Removes the workspace and every request, environment, link, and release inside it from
            this browser. The workspace's GitHub repo (if connected) is untouched. This cannot be
            undone.
          </p>
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          try {
            await deleteWorkspaceById(confirmDelete.id);
            setConfirmDelete(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Delete failed');
            setConfirmDelete(null);
          }
        }}
      />
    </div>
  );
}

function NewWorkspaceModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="New workspace">
      <div className="space-y-3">
        <p className="text-[0.6875rem] text-text-dim">
          Each workspace has its own collections, environments, links, releases, and GitHub
          connection. Switching workspaces reloads the editor.
        </p>
        <div>
          <label htmlFor="new-workspace-name" className="block text-[0.6875rem] text-text-dim">
            Workspace name
          </label>
          <input
            id="new-workspace-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My API"
            aria-label="New workspace name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting) void onSubmit();
            }}
            className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting || !name.trim()}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <Plus size={11} aria-hidden="true" />
            {submitting ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
