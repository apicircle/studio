import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import type { WorkspacePatch, WorkspaceState } from '@apicircle/core';
import { applyMutation } from '@apicircle/core';
import { loadFromFile, saveToFile, withWorkspace } from '@apicircle/core/workspace/file-backed';
import type { WorkspaceProvider } from './WorkspaceProvider';

/**
 * Disk-backed provider used by the standalone CLI and the headless MCP
 * server when launched outside Electron. Each `apply` runs a full
 * load → mutate → save cycle under a `proper-lockfile` advisory lock so
 * concurrent writers (a second CLI invocation, the desktop app on the
 * same workspace) can't clobber each other.
 */
export class FileBackedWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly dir: string) {}

  async read(): Promise<WorkspaceState> {
    const out = await loadFromFile(this.dir);
    if (!out) {
      throw new Error(`No workspace found at ${this.dir}`);
    }
    return out;
  }

  async apply(patch: WorkspacePatch): Promise<{ state: WorkspaceState; changedIds: string[] }> {
    let captured: { state: WorkspaceState; changedIds: string[] } | null = null;
    await withWorkspace(this.dir, async (state) => {
      const result = applyMutation(state, patch);
      captured = { state: result.next, changedIds: result.changedIds };
      return { next: result.next };
    });
    if (!captured) throw new Error('apply did not run');
    return captured;
  }

  async write(next: { synced?: WorkspaceSynced; local?: WorkspaceLocal }): Promise<WorkspaceState> {
    const current = await this.read();
    const merged: WorkspaceState = {
      synced: next.synced ?? current.synced,
      local: next.local ?? current.local,
    };
    await saveToFile(this.dir, merged);
    return merged;
  }
}
