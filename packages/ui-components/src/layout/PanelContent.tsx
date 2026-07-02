import type { ReactNode } from 'react';
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
import { PanelErrorBoundary } from '../primitives/PanelErrorBoundary';
import { useExtraPanels } from './extraPanels';

// PANEL_LABELS is what the error fallback shows in its heading, so the user
// can recognise which panel crashed without reading the URL. Keep aligned
// with `layout/panels.ts`.
const PANEL_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  'link-workspace': 'Link Workspace',
  editor: 'Editor',
  env: 'Environments',
  execution: 'Execution',
  history: 'History',
  mocks: 'Mock Servers',
  mcp: 'MCP',
  help: 'Help Center',
};

// `key={activePanel}` re-mounts the boundary on panel switch so a crash in
// one panel doesn't leak its "errored" state into the next panel a user
// opens. Without that, switching away and back to a panel would keep
// showing the previous error.
function Bounded({
  panel,
  label,
  children,
}: {
  panel: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <PanelErrorBoundary key={panel} panelLabel={label ?? PANEL_LABELS[panel] ?? panel}>
      {children}
    </PanelErrorBoundary>
  );
}

export function PanelContent() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const extraPanels = useExtraPanels();

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-surface">
      {activePanel === 'workspace' && (
        <Bounded panel="workspace">
          <WorkspacePanel />
        </Bounded>
      )}
      {activePanel === 'link-workspace' && (
        <Bounded panel="link-workspace">
          <LinkWorkspacePanel />
        </Bounded>
      )}
      {activePanel === 'editor' && (
        <Bounded panel="editor">
          <EditorPanel />
        </Bounded>
      )}
      {activePanel === 'env' && (
        <Bounded panel="env">
          <EnvironmentsPanel />
        </Bounded>
      )}
      {activePanel === 'execution' && (
        <Bounded panel="execution">
          <ExecutionPanel />
        </Bounded>
      )}
      {activePanel === 'history' && (
        <Bounded panel="history">
          <HistoryPanel />
        </Bounded>
      )}
      {activePanel === 'mocks' && (
        <Bounded panel="mocks">
          <MockServersPanel />
        </Bounded>
      )}
      {activePanel === 'mcp' && (
        <Bounded panel="mcp">
          <McpServerPanel />
        </Bounded>
      )}
      {activePanel === 'help' && (
        <Bounded panel="help">
          <HelpPanel />
        </Bounded>
      )}
      {extraPanels.map((p) =>
        activePanel === p.id ? (
          <Bounded key={p.id} panel={p.id} label={p.label}>
            <p.Panel />
          </Bounded>
        ) : null,
      )}
    </main>
  );
}
