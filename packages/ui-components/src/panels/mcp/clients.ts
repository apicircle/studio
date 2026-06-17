// Shared list of MCP-compatible AI clients. Both the McpSidebar (selection)
// and McpServerPanel (per-client snippet cards) consume this so the order
// stays in sync.
export interface McpClient {
  id: string;
  label: string;
}

export const MCP_CLIENTS: ReadonlyArray<McpClient> = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'github-copilot', label: 'GitHub Copilot' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'continue', label: 'Continue' },
  { id: 'cline', label: 'Cline' },
  { id: 'zed', label: 'Zed' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'generic', label: 'Generic stdio' },
];
