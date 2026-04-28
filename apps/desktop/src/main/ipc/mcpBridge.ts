import { ipcMain } from 'electron';
import type { AiClient, McpManager } from '../mcp/mcpManager';

// =============================================================================
// IPC bridge for the MCP manager. Renderer uses these to render the "MCP" panel
// (config snippet copy, paths, tool catalog).
// =============================================================================

const CHANNEL = {
  status: 'apicircle:mcp:status',
  getConfigSnippet: 'apicircle:mcp:getConfigSnippet',
  getConfigPath: 'apicircle:mcp:getConfigPath',
  toolCatalog: 'apicircle:mcp:toolCatalog',
} as const;

export function registerMcpBridge(manager: McpManager): void {
  ipcMain.handle(CHANNEL.status, () => ({
    workspaceDir: manager.workspaceDir,
    binary: manager.resolvePaths().binary,
  }));
  ipcMain.handle(CHANNEL.getConfigSnippet, (_event, client: AiClient) =>
    manager.getConfigSnippet(client),
  );
  ipcMain.handle(CHANNEL.getConfigPath, (_event, client: AiClient) =>
    manager.getConfigPath(client),
  );
  ipcMain.handle(CHANNEL.toolCatalog, () => manager.toolCatalog());
}

export const MCP_CHANNELS = CHANNEL;
