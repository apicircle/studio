import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspaceSidebar } from '../panels/workspace/WorkspaceSidebar';
import { LinkWorkspaceSidebar } from '../panels/link-workspace/LinkWorkspaceSidebar';
import { EditorSidebar } from '../panels/editor/EditorSidebar';
import { EnvironmentsSidebar } from '../panels/env/EnvironmentsSidebar';
import { ExecutionSidebar } from '../panels/execution/ExecutionSidebar';
import { HistorySidebar } from '../panels/history/HistorySidebar';
import { getPanel } from './panels';

export function Sidebar() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const panel = getPanel(activePanel);
  if (!panel.hasSidebar) return null;

  return (
    <aside className="flex h-full w-full flex-col border-r border-border-subtle bg-card">
      <header className="flex h-10 shrink-0 items-center border-b border-border-subtle px-3 text-xs font-medium uppercase tracking-wider text-text-dim">
        {panel.label}
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {activePanel === 'workspace' && <WorkspaceSidebar />}
        {activePanel === 'link-workspace' && <LinkWorkspaceSidebar />}
        {activePanel === 'editor' && <EditorSidebar />}
        {activePanel === 'env' && <EnvironmentsSidebar />}
        {activePanel === 'execution' && <ExecutionSidebar />}
        {activePanel === 'history' && <HistorySidebar />}
      </div>
    </aside>
  );
}
