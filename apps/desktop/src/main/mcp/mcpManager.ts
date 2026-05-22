import { app } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { MCP_TOOL_NAMES, type McpToolName } from '@apicircle/shared';
import type { ConfigSnippetVariants } from '@apicircle/ui-components';

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
  /**
   * Path the MCP server should bind to. This is the *registry root*
   * (`userData/workspaces/`), not a single-workspace dir — the server
   * resolves the active workspace from `registry.json` inside it and
   * exposes the others via `workspace.list`.
   */
  readonly workspaceDir: string;

  constructor(workspaceDir?: string) {
    this.workspaceDir = workspaceDir ?? path.join(app.getPath('userData'), 'workspaces');
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
   * Generate the MCP config snippet the user pastes into their AI client's
   * config file. Returns two byte-identical-but-for-path-escaping renderings:
   *
   *   - `forwardSlash`: the workspace path uses `/` separators on Windows
   *     (`"C:/Users/.../workspaces"`). This is valid JSON without any
   *     backslash escapes — easier to read, and accepted by Node.js,
   *     Electron, and Windows file APIs.
   *   - `escaped`: the literal OS path, which on Windows means `\\` escapes
   *     inside JSON strings (`"C:\\Users\\...\\workspaces"`). This is what
   *     `JSON.stringify` emits by default.
   *
   * On macOS and Linux paths contain no backslashes, so the two strings are
   * byte-identical and `identical` is true — the UI uses that to suppress
   * the picker on those platforms.
   *
   * All clients share the same outer shape (`mcpServers: { apicircle: ... }`)
   * today; per-client tailoring of the wrapper lives here in case a future
   * client (e.g. Zed-style nested key) needs a different envelope.
   */
  getConfigSnippet(client: AiClient): ConfigSnippetVariants {
    const { binary, workspace } = this.resolvePaths();
    return buildSnippetVariants(client, binary, workspace);
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

// Centralized snippet builder. Kept outside the class so it's trivially
// unit-testable without instantiating an Electron-coupled McpManager.
function buildSnippetVariants(
  _client: AiClient,
  binary: string,
  workspace: string,
): ConfigSnippetVariants {
  const forwardWorkspace = workspace.replace(/\\/g, '/');
  const escaped = renderSnippet(binary, workspace);
  const forwardSlash = renderSnippet(binary, forwardWorkspace);
  return {
    forwardSlash,
    escaped,
    identical: forwardSlash === escaped,
  };
}

function renderSnippet(binary: string, workspace: string): string {
  const entry = {
    command: binary,
    args: ['--workspace', workspace],
    env: { APICIRCLE_WORKSPACE: workspace },
  };
  return JSON.stringify({ mcpServers: { apicircle: entry } }, null, 2);
}
