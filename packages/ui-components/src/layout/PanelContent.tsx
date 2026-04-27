import { useWorkspaceStore } from '../store/workspaceStore';
import { GitPanel } from '../panels/git/GitPanel';
import { ApiConnectionsPanel } from '../panels/api-connections/ApiConnectionsPanel';
import { EditorPanel } from '../panels/editor/EditorPanel';
import { EnvironmentsPanel } from '../panels/env/EnvironmentsPanel';
import { ExecutionPanel } from '../panels/execution/ExecutionPanel';
import { HistoryPanel } from '../panels/history/HistoryPanel';
import { SettingsPanel } from '../panels/settings/SettingsPanel';
import { HelpPanel } from '../panels/help/HelpPanel';

export function PanelContent() {
  const activePanel = useWorkspaceStore((s) => s.local?.ui.activePanel ?? 'editor');

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-surface">
      {activePanel === 'git' && <GitPanel />}
      {activePanel === 'api-connections' && <ApiConnectionsPanel />}
      {activePanel === 'editor' && <EditorPanel />}
      {activePanel === 'env' && <EnvironmentsPanel />}
      {activePanel === 'execution' && <ExecutionPanel />}
      {activePanel === 'history' && <HistoryPanel />}
      {activePanel === 'settings' && <SettingsPanel />}
      {activePanel === 'help' && <HelpPanel />}
    </main>
  );
}
