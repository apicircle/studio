import { useWorkspaceStore } from '../../store/workspaceStore';
import { SidebarStub } from '../PanelStub';

export function WorkspaceSidebar() {
  const session = useWorkspaceStore((s) => s.local?.sessions.github.workspace ?? null);
  const workingBranch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);

  if (!session) {
    return (
      <SidebarStub message="Local Workspace — no GitHub connection. Use Secret Vault → Sessions to connect a PAT." />
    );
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="rounded-sm border border-border-subtle bg-surface px-2.5 py-2">
        <div className="text-[0.625rem] uppercase tracking-wider text-text-dim">Account</div>
        <div className="mt-0.5 text-text-primary">{session.accountLogin}</div>
      </div>
      <div className="rounded-sm border border-border-subtle bg-surface px-2.5 py-2">
        <div className="text-[0.625rem] uppercase tracking-wider text-text-dim">Working branch</div>
        <div className="mt-0.5 text-text-primary">{workingBranch?.name ?? '—'}</div>
      </div>
      <div className="rounded-sm border border-dashed border-border-subtle px-2.5 py-2 text-[0.6875rem] leading-snug text-text-dim">
        Push, refresh, and PR creation live on the working-branch card to the right.
      </div>
    </div>
  );
}
