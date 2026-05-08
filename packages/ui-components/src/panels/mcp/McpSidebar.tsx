import { Bot } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MCP_CLIENTS } from './clients';
import { cn } from '../../primitives/cn';

/**
 * MCP sidebar — list of AI clients. Clicking a client focuses its snippet
 * card in the main pane (the panel renders one card per client and scrolls
 * the focused one into view). Selecting here is purely navigation; every
 * client's snippet stays visible in the body.
 */
export function McpSidebar() {
  const focusedClient = useWorkspaceStore((s) => s.mcpFocusedClient);
  const setFocusedClient = useWorkspaceStore((s) => s.setMcpFocusedClient);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-wider text-text-dim">
        <Bot size={11} aria-hidden="true" />
        <span>AI Clients</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {MCP_CLIENTS.map((c) => {
          const active = focusedClient === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setFocusedClient(c.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'w-full rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors',
                  active
                    ? 'border border-accent/40 bg-accent/10 text-accent'
                    : 'border border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
                )}
              >
                {c.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
