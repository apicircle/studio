import * as os from 'os';
import { MCP_TOOL_NAMES, type McpToolName } from '@apicircle/shared';
import type { ConfigSnippetVariants } from '@apicircle/ui-components';
import {
  buildSnippetVariants as sharedBuildSnippetVariants,
  resolveAiClientConfigPath,
  type AiClient as SharedAiClient,
} from '@apicircle/mcp-server';
import { defaultApicircleRoot } from '@apicircle/core/workspace/registry';

// =============================================================================
// McpManager — surfaces config snippets that the user pastes into their AI
// client of choice. We do NOT spawn `apicircle-mcp` from the desktop; the AI
// client (Claude Desktop, Cursor, etc) spawns it as its own child so the
// process lifecycle stays scoped to the AI client's session.
//
// `getConfigSnippet(client)` returns the config snippet the user pastes into
// their AI client's config file (JSON for most, TOML for Codex, YAML for
// Continue). Renderer surfaces a "Copy to clipboard" button that calls this
// through IPC.
// =============================================================================

/**
 * AiClient union — re-exported from `@apicircle/mcp-server` (Phase 5
 * extraction). Both Desktop and VS Code consume the shared definition so a
 * new client gets a single source of truth.
 */
export type AiClient = SharedAiClient;

interface ResolvedPaths {
  binary: string;
  workspace: string;
}

export class McpManager {
  /**
   * Path the MCP server should bind to. This is the registry root
   * (`~/.apicircle/`), not a single-workspace dir — the server resolves
   * the active workspace from `registry.json` inside it and exposes the
   * others via `workspace.list`.
   */
  readonly workspaceDir: string;

  constructor(workspaceDir?: string) {
    this.workspaceDir = workspaceDir ?? defaultApicircleRoot();
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
   *   - `forwardSlash`: the workspace path uses `/` separators on Windows —
   *     easier to read, and accepted by Node.js, Electron, and Windows APIs.
   *   - `escaped`: the literal OS path, which on Windows means `\\` escapes
   *     inside quoted strings (both JSON and TOML use `\` as escape char).
   *
   * On macOS and Linux paths contain no backslashes, so the two strings are
   * byte-identical and `identical` is true — the UI uses that to suppress
   * the picker on those platforms.
   *
   * Format is client-dependent: JSON for most, TOML for Codex, YAML for
   * Continue. The shared builder in `@apicircle/mcp-server` dispatches.
   */
  getConfigSnippet(client: AiClient): ConfigSnippetVariants {
    const { binary, workspace } = this.resolvePaths();
    // Phase 5: delegates to the shared builder in @apicircle/mcp-server so
    // VS Code's MCP manager produces byte-identical snippets for the same
    // (binary, workspace) tuple.
    return sharedBuildSnippetVariants(client, binary, workspace);
  }

  /**
   * Document the conventional path of the config file for each client so
   * the renderer can surface "Open in Finder / File Explorer" buttons.
   *
   * Phase 5: delegates to the shared resolver in `@apicircle/mcp-server` —
   * Desktop + VS Code share the per-OS path conventions.
   */
  getConfigPath(client: AiClient): string | null {
    return resolveAiClientConfigPath(client, {
      homedir: os.homedir(),
      platform: process.platform,
      appdata: process.env.APPDATA,
    });
  }
}
