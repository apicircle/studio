import { GitBranch, Lock } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { Tooltip } from '../primitives/Tooltip';
import { useWorkspaceGitStatus, workspaceStatusCopy } from './workspaceGitStatus';

/**
 * The workspace's Git status as a top-bar chip: which repository and working
 * branch it is on and how many changes are waiting to be pushed, or the step
 * still missing. One click opens the Workspace page from any panel.
 *
 * An edition places it through `<App workspaceStatus={…} />`. Studio renders it
 * nowhere by itself, so its own top bar is unchanged.
 *
 * It narrows with the window rather than wrapping the bar: the repository name
 * goes first, then the branch, and the unpushed count stays.
 */
export function WorkspaceStatusChip() {
  const status = useWorkspaceGitStatus();
  const onWorkspace = useWorkspaceStore((s) => s.activePanel === 'workspace');
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  const copy = workspaceStatusCopy(status);
  const Icon = status.kind === 'locked' ? Lock : GitBranch;
  const repo = status.kind === 'branch' || status.kind === 'no-branch' ? status.repo : null;
  const unpushed = status.kind === 'branch' ? status.unpushed : null;

  return (
    <Tooltip content={copy.hint} side="bottom" align="start">
      <button
        type="button"
        data-workspace-status={status.kind}
        onClick={() => setActivePanel('workspace')}
        // Named in full because the visible text thins out as the window narrows.
        aria-label={`Open Workspace: ${copy.summary}`}
        aria-current={onWorkspace ? 'page' : undefined}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
          onWorkspace
            ? 'border-accent/40 bg-accent/10 text-accent'
            : status.kind === 'locked'
              ? 'border-warning/40 bg-warning/10 text-warning hover:border-warning/60'
              : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text-primary',
        )}
      >
        <Icon size={12} aria-hidden="true" className="shrink-0" />
        {copy.label !== null ? <span className="hidden md:inline">{copy.label}</span> : null}
        {repo !== null ? (
          <span className="hidden items-center gap-1.5 xl:inline-flex">
            <span className="max-w-[12rem] truncate font-medium text-text-primary">{repo}</span>
            <span aria-hidden="true" className="text-text-dim">
              ·
            </span>
          </span>
        ) : null}
        {status.kind === 'branch' ? (
          <span className="hidden max-w-[9rem] truncate md:inline">{status.branch}</span>
        ) : null}
        {status.kind === 'no-branch' ? (
          <span className="hidden md:inline">no working branch</span>
        ) : null}
        {unpushed !== null && unpushed > 0 ? (
          <span className="rounded-sm bg-accent/15 px-1.5 py-px text-[0.625rem] font-medium text-accent">
            {unpushed} unpushed
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
