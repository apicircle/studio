import { useWorkspaceStore } from '../store/workspaceStore';
import { GitSidebar } from '../panels/git/GitSidebar';
import { ApiConnectionsSidebar } from '../panels/api-connections/ApiConnectionsSidebar';
import { EditorSidebar } from '../panels/editor/EditorSidebar';
import { EnvironmentsSidebar } from '../panels/env/EnvironmentsSidebar';
import { ExecutionSidebar } from '../panels/execution/ExecutionSidebar';
import { HistorySidebar } from '../panels/history/HistorySidebar';
import { SettingsSidebar } from '../panels/settings/SettingsSidebar';
import { getPanel } from './panels';

export function Sidebar() {
  const activePanel = useWorkspaceStore((s) => s.local?.ui.activePanel ?? 'editor');
  const panel = getPanel(activePanel);
  if (!panel.hasSidebar) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border-subtle bg-card">
      <header className="flex h-10 items-center border-b border-border-subtle px-3 text-xs font-medium uppercase tracking-wider text-text-dim">
        {panel.label}
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {activePanel === 'git' && <GitSidebar />}
        {activePanel === 'api-connections' && <ApiConnectionsSidebar />}
        {activePanel === 'editor' && <EditorSidebar />}
        {activePanel === 'env' && <EnvironmentsSidebar />}
        {activePanel === 'execution' && <ExecutionSidebar />}
        {activePanel === 'history' && <HistorySidebar />}
        {activePanel === 'settings' && <SettingsSidebar />}
      </div>
    </aside>
  );
}
