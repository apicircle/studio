import { Plug, Sparkles } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { MCP_PANEL_SECTIONS, type McpPanelSection } from './mcpPanelTypes';

/**
 * MCP sidebar — top-level navigation between "Connection" (the unified
 * setup-and-mirror surface) and "Prompts" (curated starter prompts).
 * One section visible at a time; the panel renders the matching component
 * in its main pane.
 */
export function McpSidebar() {
  const activeSection = useWorkspaceStore((s) => s.mcpActiveSection);
  const setActiveSection = useWorkspaceStore((s) => s.setMcpActiveSection);

  return (
    <div className="flex h-full flex-col gap-2">
      <ul className="flex flex-col gap-0.5">
        {MCP_PANEL_SECTIONS.map((section) => {
          const active = activeSection === section.id;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => setActiveSection(section.id)}
                aria-current={active ? 'page' : undefined}
                title={section.description}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[0.6875rem] transition-colors',
                  active
                    ? 'border border-accent/40 bg-accent/10 text-accent'
                    : 'border border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
                )}
              >
                <SectionIcon id={section.id} />
                <span>{section.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SectionIcon({ id }: { id: McpPanelSection }) {
  const props = { size: 12, 'aria-hidden': true } as const;
  switch (id) {
    case 'connection':
      return <Plug {...props} />;
    case 'prompts':
      return <Sparkles {...props} />;
  }
}
