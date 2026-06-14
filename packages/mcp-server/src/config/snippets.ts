import * as path from 'node:path';

// =============================================================================
// MCP config snippet builder — shared between Desktop and VS Code.
//
// External AI clients (Claude Desktop, Cursor, Codex, etc.) launch the
// `apicircle-mcp` binary themselves as a stdio child process — neither the
// Desktop app nor the VS Code extension spawns it directly. What both apps
// DO provide is the exact config snippet the user pastes into the client's
// config file (JSON for most clients, TOML for Codex, YAML for Continue).
// This module centralises:
//
//   • The `AiClient` type + `AI_CLIENTS` runtime allowlist
//   • `buildSnippetVariants(client, binary, workspace)` — forward-slash +
//     escaped renderings (Windows backslash handling)
//   • `resolveAiClientConfigPath(client, env)` — conventional config file
//     path per OS for clients that have one
//
// Promoted to `@apicircle/mcp-server` so the VS Code extension (which
// cannot depend on the workspace-private `@apicircle/ui-components`) and
// the desktop main process both consume the same logic.
// =============================================================================

export type AiClient =
  | 'claude-desktop'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'continue'
  | 'cline'
  | 'zed'
  | 'windsurf'
  | 'github-copilot'
  | 'chatgpt'
  | 'generic';

export const AI_CLIENTS: readonly AiClient[] = [
  'claude-desktop',
  'claude-code',
  'codex',
  'cursor',
  'continue',
  'cline',
  'zed',
  'windsurf',
  'github-copilot',
  'chatgpt',
  'generic',
] as const;

/**
 * Two byte-identical-but-for-path-escaping renderings of the same snippet.
 *
 *   - `forwardSlash`: workspace path uses `/` separators on Windows
 *     (`"C:/Users/.../workspaces"`). No backslash escapes needed — easier
 *     to read, accepted by Node, Electron, and Windows file APIs.
 *   - `escaped`: literal OS path. On Windows that means `\\` escapes
 *     inside quoted strings (JSON and TOML both use `\` as the escape
 *     character).
 *
 * On POSIX both strings are byte-identical and `identical` is `true` — the
 * UI uses that flag to suppress the variant picker.
 */
export interface ConfigSnippetVariants {
  forwardSlash: string;
  escaped: string;
  identical: boolean;
}

/**
 * Build the snippet for a given AI client + workspace path. Most clients
 * use JSON with `mcpServers: { apicircle: ... }`; Codex uses TOML with
 * `[mcp_servers.apicircle]`. The `client` arg selects the format.
 */
export function buildSnippetVariants(
  client: AiClient,
  binary: string,
  workspace: string,
): ConfigSnippetVariants {
  const forwardWorkspace = workspace.replace(/\\/g, '/');
  const render = client === 'codex' ? renderTomlSnippet : renderJsonSnippet;
  const escaped = render(binary, workspace);
  const forwardSlash = render(binary, forwardWorkspace);
  return {
    forwardSlash,
    escaped,
    identical: forwardSlash === escaped,
  };
}

function renderJsonSnippet(binary: string, workspace: string): string {
  const entry = {
    command: binary,
    args: ['--workspace', workspace],
    env: { APICIRCLE_WORKSPACE: workspace },
  };
  return JSON.stringify({ mcpServers: { apicircle: entry } }, null, 2);
}

function renderTomlSnippet(binary: string, workspace: string): string {
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `[mcp_servers.apicircle]`,
    `command = "${esc(binary)}"`,
    `args = ["--workspace", "${esc(workspace)}"]`,
    ``,
    `[mcp_servers.apicircle.env]`,
    `APICIRCLE_WORKSPACE = "${esc(workspace)}"`,
  ].join('\n');
}

/**
 * Host-environment shape the config-path resolver depends on. Both the
 * desktop main process and the VS Code extension run on Node — they pass
 * the standard `os.homedir()` / `process.platform` / `process.env.APPDATA`
 * values straight through. Tests pin them explicitly.
 */
export interface ConfigPathEnv {
  /** e.g. `os.homedir()` */
  homedir: string;
  /** `process.platform` — one of "darwin" / "win32" / "linux" / ... */
  platform: NodeJS.Platform;
  /** Windows-only: `process.env.APPDATA`, used by Claude Desktop's config. */
  appdata?: string;
}

/**
 * Conventional path of the config file for each client on the current OS,
 * or `null` if the client has no fixed location (manual paste).
 */
export function resolveAiClientConfigPath(client: AiClient, env: ConfigPathEnv): string | null {
  const { homedir, platform, appdata } = env;
  switch (client) {
    case 'claude-desktop':
      if (platform === 'darwin') {
        return path.join(homedir, 'Library/Application Support/Claude/claude_desktop_config.json');
      }
      if (platform === 'win32') {
        return path.join(
          appdata ?? path.join(homedir, 'AppData/Roaming'),
          'Claude/claude_desktop_config.json',
        );
      }
      return path.join(homedir, '.config/Claude/claude_desktop_config.json');
    case 'claude-code':
      // Claude Code CLI's MCP config lives under `.claude/mcp.json` —
      // same shape as Claude Desktop's mcpServers wrapper. P5R1-G11.
      return path.join(homedir, '.claude/mcp.json');
    case 'cursor':
      return path.join(homedir, '.cursor/mcp.json');
    case 'continue':
      return path.join(homedir, '.continue/config.yaml');
    case 'zed':
      return path.join(homedir, '.config/zed/settings.json');
    case 'windsurf':
      // Windsurf (Codeium IDE) reads MCP servers from
      // `.codeium/windsurf/mcp_config.json` under the user's home. P5R1-G11.
      return path.join(homedir, '.codeium/windsurf/mcp_config.json');
    case 'codex':
      return path.join(homedir, '.codex/config.toml');
    default:
      return null;
  }
}
