import { useWorkspaceStore } from '../store/workspaceStore';
import { EditorSidebar, EditorSidebarActions } from '../panels/editor/EditorSidebar';
import { EnvironmentsSidebar, EnvironmentsSidebarActions } from '../panels/env/EnvironmentsSidebar';
import { ExecutionSidebar, ExecutionSidebarActions } from '../panels/execution/ExecutionSidebar';
import { HistorySidebar } from '../panels/history/HistorySidebar';
import { MocksSidebar, MocksSidebarActions } from '../panels/mocks/MocksSidebar';
import { HelpSidebar } from '../panels/help/HelpSidebar';
import { useExtraPanels, resolveActivePanel } from './extraPanels';

export function Sidebar() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const extraPanels = useExtraPanels();
  const resolved = resolveActivePanel(activePanel, extraPanels);
  if (!resolved.hasSidebar) return null;
  const ExtraSidebar = resolved.extra?.Sidebar;
  const ExtraSidebarActions = resolved.extra?.SidebarActions;

  return (
    <aside className="flex h-full w-full flex-col border-r border-border-subtle bg-card">
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 text-xs font-medium uppercase tracking-wider text-text-dim">
        <span>{resolved.label}</span>
        {activePanel === 'editor' && <EditorSidebarActions />}
        {activePanel === 'env' && <EnvironmentsSidebarActions />}
        {activePanel === 'execution' && <ExecutionSidebarActions />}
        {activePanel === 'mocks' && <MocksSidebarActions />}
        {ExtraSidebarActions ? <ExtraSidebarActions /> : null}
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {activePanel === 'editor' && <EditorSidebar />}
        {activePanel === 'env' && <EnvironmentsSidebar />}
        {activePanel === 'execution' && <ExecutionSidebar />}
        {activePanel === 'history' && <HistorySidebar />}
        {activePanel === 'mocks' && <MocksSidebar />}
        {activePanel === 'help' && <HelpSidebar />}
        {ExtraSidebar ? <ExtraSidebar /> : null}
      </div>
    </aside>
  );
}
