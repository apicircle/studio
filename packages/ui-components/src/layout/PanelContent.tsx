import { useWorkspaceStore } from '../store/workspaceStore';
import { WorkspacePanel } from '../panels/workspace/WorkspacePanel';
import { LinkWorkspacePanel } from '../panels/link-workspace/LinkWorkspacePanel';
import { EditorPanel } from '../panels/editor/EditorPanel';
import { EnvironmentsPanel } from '../panels/env/EnvironmentsPanel';
import { ExecutionPanel } from '../panels/execution/ExecutionPanel';
import { HistoryPanel } from '../panels/history/HistoryPanel';
import { MockServersPanel } from '../panels/mocks/MockServersPanel';
import { McpServerPanel } from '../panels/mcp/McpServerPanel';
import { HelpPanel } from '../panels/help/HelpPanel';

export function PanelContent() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-surface">
      {activePanel === 'workspace' && <WorkspacePanel />}
      {activePanel === 'link-workspace' && <LinkWorkspacePanel />}
      {activePanel === 'editor' && <EditorPanel />}
      {activePanel === 'env' && <EnvironmentsPanel />}
      {activePanel === 'execution' && <ExecutionPanel />}
      {activePanel === 'history' && <HistoryPanel />}
      {activePanel === 'mocks' && <MockServersPanel />}
      {activePanel === 'mcp' && <McpServerPanel />}
      {activePanel === 'help' && <HelpPanel />}
    </main>
  );
}
