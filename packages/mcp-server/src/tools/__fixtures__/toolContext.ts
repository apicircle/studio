import { InMemoryWorkspaceProvider } from '@apicircle/core/providers';
import { InProcessMockController } from '@apicircle/core/providers';
import { SingleWorkspaceAdapter } from '@apicircle/core/providers';
import type { ToolHandlerContext } from '../types';
import type { WorkspaceState } from '@apicircle/core';

/**
 * Test helper — build a fully-wired `ToolHandlerContext` from a fresh
 * in-memory workspace state. Tests don't need to know about the
 * `workspaces` field; this fixture wires the `SingleWorkspaceAdapter`
 * around the in-memory provider so the surface is identical to the
 * single-workspace runtime hosts.
 */
export function makeToolContext(state: WorkspaceState): ToolHandlerContext {
  const workspace = new InMemoryWorkspaceProvider(state);
  const workspaces = new SingleWorkspaceAdapter(workspace, state.synced.workspaceId);
  return {
    workspace,
    workspaces,
    mock: new InProcessMockController(),
  };
}
