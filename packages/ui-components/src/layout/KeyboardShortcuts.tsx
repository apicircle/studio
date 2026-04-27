import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { PANELS } from './panels';

/**
 * Plan §11.2 keyboard shortcuts. Mounted once at the App root —
 * intercepts global key presses but always defers to the active editing
 * surface (input / textarea / contenteditable) so we don't steal letters
 * the user is typing.
 *
 * Bindings:
 *   Ctrl/Cmd + Enter      → Send the active request
 *   Ctrl/Cmd + 1..7       → Switch panels (Workspace … Help)
 *   Ctrl/Cmd + K          → Open Secret Vault
 *   Ctrl/Cmd + Shift + R  → Refresh the working branch (plain Ctrl+R is the browser's reload)
 *   Ctrl/Cmd + N          → New request (only when the Editor panel is active)
 *
 * Returns null — purely behavioral.
 */
export function KeyboardShortcuts() {
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  const openSecretVault = useWorkspaceStore((s) => s.openSecretVault);
  const executeActiveRequest = useWorkspaceStore((s) => s.executeActiveRequest);
  const refreshWorkspace = useWorkspaceStore((s) => s.refreshWorkspace);
  const addRequest = useWorkspaceStore((s) => s.addRequest);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when the user is editing text — we don't want to hijack
      // letters typed into inputs / textareas / Monaco editors. The
      // exception is Ctrl/Cmd+Enter, which is the universal "send"
      // shortcut and should fire even from inside a body editor.
      const target = e.target as HTMLElement | null;
      const isEditing = isEditingTarget(target);
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // Send: works everywhere, including from inside a body editor.
      if (e.key === 'Enter') {
        e.preventDefault();
        void executeActiveRequest();
        return;
      }

      if (isEditing) return;

      // Open Secret Vault.
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSecretVault();
        return;
      }

      // Refresh the working branch (Ctrl+Shift+R disambiguates from the
      // browser's plain Ctrl+R reload).
      if (e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void refreshWorkspace().catch(() => {
          // The store action throws when there's no working branch yet;
          // swallow here — the shortcut is best-effort.
        });
        return;
      }

      // New request — only meaningful from the Editor panel.
      if (e.key.toLowerCase() === 'n') {
        const state = useWorkspaceStore.getState();
        if (state.activePanel === 'editor') {
          e.preventDefault();
          addRequest(null);
        }
        return;
      }

      // Panel switch: 1..7. Numeric keys ignore the shift modifier so
      // both rows of the top number row work consistently across layouts.
      if (e.key >= '1' && e.key <= '9') {
        const index = Number(e.key) - 1;
        if (index < PANELS.length) {
          e.preventDefault();
          setActivePanel(PANELS[index].id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setActivePanel, openSecretVault, executeActiveRequest, refreshWorkspace, addRequest]);

  return null;
}

function isEditingTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}
