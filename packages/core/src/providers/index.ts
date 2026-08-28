// Workspace and mock providers.
//
// These used to live in `@apicircle/mcp-server`, which made them look like MCP
// internals. They are not: the VS Code mock server and workspace persistence
// consume them directly, and both are free-GUI features that have nothing to do
// with MCP. They moved here when the MCP surface left the open-core repo, so
// that removing MCP could not take the free features with it.
export type { WorkspaceProvider } from './WorkspaceProvider';
export type { MockController, StartMockResult } from './MockController';
export type { WorkspaceSummary, Workspaces } from './Workspaces';
export { SingleWorkspaceAdapter, WorkspaceNotFoundError } from './Workspaces';
export { InMemoryWorkspaceProvider } from './InMemoryWorkspaceProvider';
export { FileBackedWorkspaceProvider } from './FileBackedWorkspaceProvider';
export { GitBackedWorkspaceProvider } from './GitBackedWorkspaceProvider';
export { MultiWorkspaceProvider } from './MultiWorkspaceProvider';
export { InProcessMockController } from './InProcessMockController';
