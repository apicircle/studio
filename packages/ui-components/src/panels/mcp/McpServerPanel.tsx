import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConnectionSection } from './ConnectionSection';
import { PromptsSection } from './PromptsSection';
import { MCP_PANEL_SECTIONS } from './mcpPanelTypes';

// =============================================================================
// McpServerPanel — router shell that swaps the active section in the right
// pane. The sidebar (McpSidebar) drives `mcpActiveSection` in the store;
// this component reads it and renders the matching component.
//
// Each section is self-contained (its own header, layout, data fetching),
// so this file stays a thin wrapper.
// =============================================================================

export function McpServerPanel() {
  const activeSection = useWorkspaceStore((s) => s.mcpActiveSection);
  const activeMeta =
    MCP_PANEL_SECTIONS.find((s) => s.id === activeSection) ?? MCP_PANEL_SECTIONS[0];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-baseline gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="text-lg font-medium text-text-primary">MCP</h1>
        <p className="text-[0.6875rem] text-text-dim">{activeMeta.description}</p>
      </header>
      <div
        className="flex-1 overflow-y-auto px-6 py-4 focus:outline-none focus:ring-1 focus:ring-accent/30"
        tabIndex={0}
        role="region"
        aria-label={activeMeta.label}
      >
        <ActiveSection />
      </div>
    </div>
  );
}

function ActiveSection() {
  const activeSection = useWorkspaceStore((s) => s.mcpActiveSection);
  switch (activeSection) {
    case 'connection':
      return <ConnectionSection />;
    case 'prompts':
      return <PromptsSection />;
  }
}
