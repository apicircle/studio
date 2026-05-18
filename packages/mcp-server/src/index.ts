import { McpHost } from './host/McpHost';
import { TOOL_REGISTRY } from './tools/registry';
import type { WorkspaceProvider } from './providers/WorkspaceProvider';
import type { MockController } from './providers/MockController';
import type { AnyToolDef } from './tools/types';

// Public API for `@apicircle/mcp-server`.
//
// The host is intentionally non-opinionated about *where* the workspace and
// mock runtime live — pass in the right provider for your environment:
//
//   • CLI / headless          → FileBackedWorkspaceProvider + InProcessMockController
//   • Electron desktop        → IpcWorkspaceProvider          + IpcMockController
//   • Embedded test / demo    → InMemoryWorkspaceProvider     + InProcessMockController

export { McpHost } from './host/McpHost';
export { TOOL_REGISTRY, getTool } from './tools/registry';
export type { AnyToolDef, ToolDef, ToolHandlerContext } from './tools/types';
export type { WorkspaceProvider } from './providers/WorkspaceProvider';
export type { MockController, StartMockResult } from './providers/MockController';
export { InMemoryWorkspaceProvider } from './providers/InMemoryWorkspaceProvider';
export { FileBackedWorkspaceProvider } from './providers/FileBackedWorkspaceProvider';
export { InProcessMockController } from './providers/InProcessMockController';

export interface CreateMcpServerOptions {
  workspace: WorkspaceProvider;
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
  return new McpHost({
    serverInfo: options.serverInfo,
    tools: options.tools ?? TOOL_REGISTRY,
    context: { workspace: options.workspace, mock: options.mock },
  });
}
