import { McpHost } from './host/McpHost';
import { TOOL_REGISTRY } from './tools/registry';
import type { WorkspaceProvider } from './providers/WorkspaceProvider';
import type { MockController } from './providers/MockController';
import type { AnyToolDef } from './tools/types';
import { SingleWorkspaceAdapter, type Workspaces } from './providers/Workspaces';

// Public API for `@apicircle/mcp-server`.
//
// The host is intentionally non-opinionated about *where* the workspace and
// mock runtime live — pass in the right provider for your environment:
//
//   • CLI / headless (single workspace)  → FileBackedWorkspaceProvider
//   • CLI / headless (multi-workspace)   → MultiWorkspaceProvider
//   • Electron desktop                   → IpcWorkspaceProvider
//   • Embedded test / demo               → InMemoryWorkspaceProvider

export { McpHost } from './host/McpHost';
export { TOOL_REGISTRY, getTool } from './tools/registry';
export type { AnyToolDef, ToolDef, ToolHandlerContext } from './tools/types';
export type { WorkspaceProvider } from './providers/WorkspaceProvider';
export type { MockController, StartMockResult } from './providers/MockController';
export {
  SingleWorkspaceAdapter,
  WorkspaceNotFoundError,
  type WorkspaceSummary,
  type Workspaces,
} from './providers/Workspaces';
export { InMemoryWorkspaceProvider } from './providers/InMemoryWorkspaceProvider';
export { FileBackedWorkspaceProvider } from './providers/FileBackedWorkspaceProvider';
export { MultiWorkspaceProvider } from './providers/MultiWorkspaceProvider';
export { InProcessMockController } from './providers/InProcessMockController';

export interface CreateMcpServerOptions {
  /**
   * Provider for the ACTIVE workspace. Tools that consume `ctx.workspace`
   * see this directly. When you pass a `MultiWorkspaceProvider`, use its
   * `activeProvider()` here.
   */
  workspace: WorkspaceProvider;
  /**
   * Optional multi-workspace surface. When omitted, the host wraps
   * `workspace` in a `SingleWorkspaceAdapter` so `workspace.list` and the
   * multi-workspace envelope still work (with one entry).
   */
  workspaces?: Workspaces;
  mock: MockController;
  /** Override the registered tool list. Defaults to `TOOL_REGISTRY`. */
  tools?: AnyToolDef[];
  serverInfo?: { name: string; version: string };
}

/**
 * Build a fully-wired McpHost ready to `await host.connect()` over stdio.
 * Tool implementations come from `TOOL_REGISTRY` by default; pass `tools`
 * to inject a curated subset (useful for tests or for hosting only the
 * import surface).
 */
export function createMcpServer(options: CreateMcpServerOptions): McpHost {
  const workspaces =
    options.workspaces ??
    new SingleWorkspaceAdapter(options.workspace, null /* discovered on first list() */);
  return new McpHost({
    serverInfo: options.serverInfo,
    tools: options.tools ?? TOOL_REGISTRY,
    context: {
      workspace: options.workspace,
      workspaces,
      mock: options.mock,
    },
  });
}
