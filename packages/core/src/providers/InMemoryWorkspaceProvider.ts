import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import type { WorkspacePatch, WorkspaceState } from '../workspace/patches';
import { applyMutation } from '../workspace/applyMutation';
import type { WorkspaceProvider } from './WorkspaceProvider';

/**
 * Pure in-memory provider. Used for unit tests and any programmatic
 * embedding where the consumer already owns workspace state and just
 * wants to drive the MCP tool catalog without disk or IPC.
 */
export class InMemoryWorkspaceProvider implements WorkspaceProvider {
  private state: WorkspaceState;

  constructor(initial: WorkspaceState) {
    this.state = initial;
  }

  async read(): Promise<WorkspaceState> {
    return this.state;
  }

  async apply(patch: WorkspacePatch): Promise<{ state: WorkspaceState; changedIds: string[] }> {
    const out = applyMutation(this.state, patch);
    this.state = out.next;
    return { state: this.state, changedIds: out.changedIds };
  }

  async write(next: { synced?: WorkspaceSynced; local?: WorkspaceLocal }): Promise<WorkspaceState> {
    this.state = {
      synced: next.synced ?? this.state.synced,
      local: next.local ?? this.state.local,
    };
    return this.state;
  }
}
