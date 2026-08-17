// Folder-level auth editor. Opens as a centered modal from the EditorSidebar
// kebab on each folder row. Reuses <AuthEditor> so the full 15-scheme picker
// is available — the resolver (core/resolveInheritedAuth) walks up the chain
// when a request sets `auth.type === 'inherit'`.

import { useEffect } from 'react';
import { Shield, X } from 'lucide-react';
import type { Folder, RequestAuth } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AuthEditor } from './AuthEditor';

interface FolderAuthModalProps {
  folder: Folder;
  onClose: () => void;
}

export function FolderAuthModal({ folder, onClose }: FolderAuthModalProps) {
  const setFolderAuth = useWorkspaceStore((s) => s.setFolderAuth);
  const auth: RequestAuth = folder.auth ?? { type: 'none' };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Folder auth — ${folder.name}`}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-accent" />
            <h2 className="text-sm font-medium text-text-primary">
              Folder auth — <span className="text-text-muted">{folder.name}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-card hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </header>

        <p className="border-b border-border-subtle bg-card px-4 py-2 text-[0.6875rem] text-text-muted">
          This auth applies to any descendant request whose own auth is set to{' '}
          <code className="text-text-primary">Inherit</code>. The resolver walks up the folder chain
          and uses the first folder with an explicit auth.
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <AuthEditor
            auth={auth}
            onChange={(next) => setFolderAuth(folder.id, next)}
            disableInherit
            noneNote="No folder-level auth. Descendants set to 'Inherit' will keep walking up the chain."
          />
        </div>

        <footer className="flex items-center justify-between border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={() => setFolderAuth(folder.id, undefined)}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-muted hover:border-danger hover:text-danger"
            title="Clear folder auth — descendants will continue walking up to find one"
          >
            Clear folder auth
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-3 text-[0.6875rem] text-accent hover:bg-accent/20"
          >
            Done
          </button>
        </footer>
      </div>
    </>
  );
}
