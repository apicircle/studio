import * as os from 'node:os';
import {
  AI_CLIENTS,
  buildSnippetVariants,
  resolveAiClientConfigPath,
  type AiClient,
  type ConfigSnippetVariants,
} from '@apicircle/mcp-server';
import { MCP_TOOL_NAMES, type McpToolName } from '@apicircle/shared';
import { resolveApicircleRoot } from '@apicircle/core/workspace/registry';
import type { VsCodeBridge } from './vscodeBridge';

// =============================================================================
// VsCodeMcpManager — VS Code's MCP host surface.
//
// The model mirrors the desktop app's `McpManager`: VS Code does NOT spawn
// `apicircle-mcp` itself. External AI clients (Claude Desktop, Cursor,
// Continue, …) launch it as a stdio child process from their own config.
// What this manager DOES is surface the exact JSON snippet the user pastes
// into each client's config + the conventional config-file path so the
// extension can offer "Open Config File" affordances.
//
// **Workspace pointed at:**
//   • Default: the active workspace's `.apicircle/` directory — the same
//     dir the GitWorkspaceProvider reads. External clients launched with
//     this `--workspace` arg see the same workspace document the
//     extension does. If the user has multiple workspaces open, only the
//     ACTIVE one is exposed; switching active workspaces re-renders the
//     snippet.
//   • Fallback when no workspace is active: an empty string — callers
//     surface a "no active workspace" UX rather than emitting a snippet
//     pointing at a non-existent path.
//
// **Binary path:** defaults to `'apicircle-mcp'` (assumes it's on PATH from
// `pnpm install -g @apicircle/mcp-server` or the project's bin entry). The
// `apicircle.mcp.binaryPath` setting overrides it for users who have
// installed it elsewhere.
// =============================================================================

export interface VsCodeMcpManagerDeps {
  bridge: VsCodeBridge;
  /** Override for the `apicircle-mcp` binary path. Wired from the
   * `apicircle.mcp.binaryPath` setting. */
  getBinaryPath: () => string;
  /**
   * Optional os/process injection so tests can pin `homedir` / `platform`
   * / `APPDATA`. Production callers omit it; the manager reads from
   * `os.homedir()` + `process.platform` + `process.env.APPDATA`.
   */
  configPathEnv?: () => {
    homedir: string;
    platform: NodeJS.Platform;
    appdata?: string;
  };
}

export interface ResolvedMcpPaths {
  binary: string;
  /**
   * The workspace path the snippet's `--workspace` arg points at. Empty
   * string when no workspace is active.
   */
  workspace: string;
  /** `true` when there is an active API Circle workspace registered. */
  hasActiveWorkspace: boolean;
  /** Whether the active workspace came from `~/.apicircle/registry.json`
   * (vs a `.apicircle/` dir inside a project folder). Callers use this to
   * decide fallback behavior — registry workspaces won't match any open
   * VS Code folder. */
  isRegistryWorkspace: boolean;
}

export class VsCodeMcpManager {
  constructor(private readonly deps: VsCodeMcpManagerDeps) {}

  /** Snapshot of the binary + workspace paths the manager would emit RIGHT
   * NOW. UI surfaces consume this when rendering the "MCP Server" header
   * row.
   *
   * P5R1-G6: an empty `binaryPath` setting would emit
   * `"command": ""` snippets which AI clients reject silently. Coerce
   * empty / whitespace-only settings back to the default `apicircle-mcp`
   * so the user gets a working snippet instead of a broken one — they
   * can still override with a real path. */
  resolvePaths(): ResolvedMcpPaths {
    const active = this.deps.bridge.activeWorkspace();
    const rawBinary = this.deps.getBinaryPath();
    const binary = rawBinary.trim().length > 0 ? rawBinary.trim() : 'apicircle-mcp';
    if (!active) {
      return { binary, workspace: '', hasActiveWorkspace: false, isRegistryWorkspace: false };
    }
    const isRegistry = active.workspace.source === 'registry';
    return {
      binary,
      // Registry workspaces: point at the multi-workspace root
      // (`~/.apicircle/`, or the `APICIRCLE_WORKSPACES_ROOT` override — kept in
      // step with discovery so the MCP snippet targets the same root the
      // extension actually reads).
      // Git-folder workspaces: point at the repo's `.apicircle/` dir.
      workspace: isRegistry ? resolveApicircleRoot() : active.workspace.apicircleDir,
      hasActiveWorkspace: true,
      isRegistryWorkspace: isRegistry,
    };
  }

  /** The full set of MCP tool names this server exposes (78 today). Sourced
   * from `@apicircle/shared` — single source of truth shared with the
   * desktop. */
  toolCatalog(): readonly McpToolName[] {
    return MCP_TOOL_NAMES;
  }

  /** The list of AI clients the snippet builder knows about. */
  supportedClients(): readonly AiClient[] {
    return AI_CLIENTS;
  }

  /**
   * Generate the JSON snippet for `client`. Returns null when no workspace
   * is active — callers surface "no active workspace" UX instead of
   * emitting a snippet pointing at "" which would create an invalid
   * external-client config.
   */
  getConfigSnippet(client: AiClient): ConfigSnippetVariants | null {
    const { binary, workspace, hasActiveWorkspace } = this.resolvePaths();
    if (!hasActiveWorkspace) return null;
    return buildSnippetVariants(client, binary, workspace);
  }

  /** Conventional config-file path per OS for `client`, or `null` if the
   * client has no fixed location. */
  getConfigPath(client: AiClient): string | null {
    const env = this.deps.configPathEnv?.() ?? {
      homedir: os.homedir(),
      platform: process.platform,
      appdata: process.env.APPDATA,
    };
    return resolveAiClientConfigPath(client, env);
  }
}

/** Human-friendly display label for each AI client. Stable strings — the
 * MCP view + commands use this for QuickPick + tree-item labels. */
export function aiClientDisplayName(client: AiClient): string {
  switch (client) {
    case 'claude-desktop':
      return 'Claude Desktop';
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor':
      return 'Cursor';
    case 'continue':
      return 'Continue';
    case 'cline':
      return 'Cline';
    case 'zed':
      return 'Zed';
    case 'windsurf':
      return 'Windsurf';
    case 'github-copilot':
      return 'GitHub Copilot';
    case 'chatgpt':
      return 'ChatGPT';
    case 'generic':
      return 'Other (Generic stdio MCP)';
  }
}
