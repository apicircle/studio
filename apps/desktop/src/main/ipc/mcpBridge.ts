import { ipcMain } from 'electron';
import type { AiClient, McpManager } from '../mcp/mcpManager';
import { assertTrustedSender } from '../security/assertTrustedSender';

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

// Runtime allowlist that mirrors the AiClient union in mcpManager.ts. We don't
// trust the TS type at the IPC boundary; an unvalidated value would still go
// through getConfigPath's switch (which falls through safely today, but
// defense-in-depth means rejecting bogus inputs up front).
const AI_CLIENTS: ReadonlySet<AiClient> = new Set<AiClient>([
  'claude-desktop',
  'claude-code',
  'cursor',
  'continue',
  'cline',
  'zed',
  'windsurf',
  'github-copilot',
  'chatgpt',
  'generic',
]);

function assertAiClient(value: unknown): AiClient {
  if (typeof value !== 'string' || !AI_CLIENTS.has(value as AiClient)) {
    throw new Error(`Unknown MCP client: ${String(value)}`);
  }
  return value as AiClient;
}

export function registerMcpBridge(manager: McpManager): void {
  ipcMain.handle(CHANNEL.status, (event) => {
    assertTrustedSender(event);
    return {
      workspaceDir: manager.workspaceDir,
      binary: manager.resolvePaths().binary,
    };
  });
  ipcMain.handle(CHANNEL.getConfigSnippet, (event, client: unknown) => {
    assertTrustedSender(event);
    return manager.getConfigSnippet(assertAiClient(client));
  });
  ipcMain.handle(CHANNEL.getConfigPath, (event, client: unknown) => {
    assertTrustedSender(event);
    return manager.getConfigPath(assertAiClient(client));
  });
  ipcMain.handle(CHANNEL.toolCatalog, (event) => {
    assertTrustedSender(event);
    return manager.toolCatalog();
  });
}

export const MCP_CHANNELS = CHANNEL;
