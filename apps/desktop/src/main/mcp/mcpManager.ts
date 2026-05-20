import { app } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { MCP_TOOL_NAMES, type McpToolName } from '@apicircle/shared';

// =============================================================================
// McpManager — surfaces config snippets that the user pastes into their AI
// client of choice. We do NOT spawn `apicircle-mcp` from the desktop; the AI
// client (Claude Desktop, Cursor, etc) spawns it as its own child so the
// process lifecycle stays scoped to the AI client's session.
//
// `getConfigSnippet(client)` returns the exact JSON the user pastes into
// e.g. `~/.claude/mcp.json`. Renderer surfaces a "Copy to clipboard" button
// that calls this through IPC.
// =============================================================================

export type AiClient =
  | 'claude-desktop'
  | 'claude-code'
  | 'cursor'
  | 'continue'
  | 'cline'
  | 'zed'
  | 'windsurf'
  | 'github-copilot'
  | 'chatgpt'
  | 'generic';

interface ResolvedPaths {
  binary: string;
  workspace: string;
}

export class McpManager {
  /** Path to the workspace directory the MCP server should bind to. */
  readonly workspaceDir: string;

  constructor(workspaceDir?: string) {
    this.workspaceDir = workspaceDir ?? path.join(app.getPath('userData'), 'workspace');
  }

  resolvePaths(): ResolvedPaths {
    return {
      binary: 'apicircle-mcp',
      workspace: this.workspaceDir,
    };
  }

  /** The full set of tool names this server exposes. */
  toolCatalog(): readonly McpToolName[] {
    return MCP_TOOL_NAMES;
  }

  /**
   * Generate a config snippet for the given AI client. All clients share the
   * same shape (`mcpServers: { apicircle: { command, args, env } }`); we
   * tailor the wrapping outer JSON object so the user can paste verbatim
   * into the right config file.
   */
  getConfigSnippet(client: AiClient): string {
    const { binary, workspace } = this.resolvePaths();
    const env = { APICIRCLE_WORKSPACE: workspace };
    const entry = {
      command: binary,
      args: ['--workspace', workspace],
      env,
    };
    switch (client) {
      case 'claude-desktop':
      case 'claude-code':
      case 'chatgpt':
      case 'github-copilot':
      case 'continue':
      case 'cline':
      case 'cursor':
      case 'windsurf':
      case 'zed':
      case 'generic':
        return JSON.stringify({ mcpServers: { apicircle: entry } }, null, 2);
    }
  }

  /**
   * Document the conventional path of the config file for each client so
   * the renderer can surface "Open in Finder / File Explorer" buttons.
   */
  getConfigPath(client: AiClient): string | null {
    const home = os.homedir();
    const platform = process.platform;
    switch (client) {
      case 'claude-desktop':
        if (platform === 'darwin') {
          return path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
        }
        if (platform === 'win32') {
          return path.join(
            process.env.APPDATA ?? path.join(home, 'AppData/Roaming'),
            'Claude/claude_desktop_config.json',
          );
        }
        return path.join(home, '.config/Claude/claude_desktop_config.json');
      case 'cursor':
        return path.join(home, '.cursor/mcp.json');
      case 'continue':
        return path.join(home, '.continue/config.json');
      case 'zed':
        return path.join(home, '.config/zed/settings.json');
      default:
        return null;
    }
  }
}
