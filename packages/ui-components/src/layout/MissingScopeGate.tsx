import { KeyRound } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Modal } from '../primitives/Modal';

/**
 * Global modal for plan §3.7 — any GitHub-mutating action that fails
 * with 401 / 403 missing-scope routes through `surfaceMissingScope`,
 * and this gate renders the prompt regardless of the active panel.
 *
 * Mounted once at the app root so a failure on (say) the Link Workspace
 * panel can still surface even if the user has since navigated away.
 */
export function MissingScopeGate() {
  const scopes = useWorkspaceStore((s) => s.missingScopePrompt);
  const dismiss = useWorkspaceStore((s) => s.dismissMissingScope);
  const openRightDockTab = useWorkspaceStore((s) => s.openRightDockTab);

  return (
    <Modal open={scopes !== null} onClose={dismiss} title="Token is missing required scope">
      <div className="space-y-3 text-xs text-text-muted">
        <p>
          GitHub denied this action because the active token is missing the following scope
          {(scopes ?? []).length === 1 ? '' : 's'}:
        </p>
        <ul className="ml-4 list-disc">
          {(scopes ?? []).map((s) => (
            <li key={s}>
              <code className="text-text-primary">{s}</code>
            </li>
          ))}
        </ul>
        <p>
          Update the token in the Secret Vault → Sessions tab. Your branch and any pushes are
          preserved — only the encrypted token is replaced.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => {
              dismiss();
              openRightDockTab('vault');
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
          >
            <KeyRound size={11} />
            Open Sessions
          </button>
        </div>
      </div>
    </Modal>
  );
}
