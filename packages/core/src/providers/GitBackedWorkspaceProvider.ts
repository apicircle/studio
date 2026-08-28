import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import type { WorkspacePatch, WorkspaceState } from '../workspace/patches';
import { applyMutation } from '../workspace/applyMutation';
import { loadFromFile, saveToFile, withWorkspace } from '../workspace/fileBackedWorkspace';
import type { WorkspaceProvider } from './WorkspaceProvider';

// =============================================================================
// GitBackedWorkspaceProvider — WorkspaceProvider for a `.apicircle/` directory
// inside a Git repo.
//
// Differs from `FileBackedWorkspaceProvider` (which reads workspace.json
// from the desktop's disk mirror) in one critical way: the synced file is
// `workspace.json` — the canonical Git-tracked workspace document that lives
// at `.apicircle/workspace-<id>/workspace.json` in a user's repo (discovered
// via `.apicircle/registry.json`).
//
// This enables the `apicircle-mcp` binary to operate directly on a cloned repo
// without requiring the desktop app's disk mirror. External AI clients (Codex,
// Cursor, Claude Code) that point `--workspace` at a repo's `.apicircle/`
// directory hit this path.
//
// Layout (relative to the directory passed in):
//   workspace.json        ← WorkspaceSynced (Git-tracked, collaborators share)
//   workspace.local.json  ← WorkspaceLocal (gitignored, per-device runtime)
//
// Uses the same `proper-lockfile` locking as `FileBackedWorkspaceProvider` via
// the shared core helpers, with `syncedFilename: 'workspace.json'`.
// =============================================================================

const GIT_SYNCED_FILENAME = 'workspace.json';

export class GitBackedWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly dir: string) {}

  async read(): Promise<WorkspaceState> {
    const out = await loadFromFile(this.dir, {
      syncedFilename: GIT_SYNCED_FILENAME,
      allowMissing: true,
    });
    if (!out) {
      throw new Error(
        `No workspace found at ${this.dir}. Expected .apicircle/registry.json and .apicircle/workspace-<id>/workspace.json in the repo.`,
      );
    }
    return out;
  }

  async apply(patch: WorkspacePatch): Promise<{ state: WorkspaceState; changedIds: string[] }> {
    let captured: { state: WorkspaceState; changedIds: string[] } | null = null;
    await withWorkspace(
      this.dir,
      async (state) => {
        const result = applyMutation(state, patch);
        captured = { state: result.next, changedIds: result.changedIds };
        return { next: result.next };
      },
      { syncedFilename: GIT_SYNCED_FILENAME },
    );
    if (!captured) throw new Error('apply did not run');
    return captured;
  }

  async write(next: { synced?: WorkspaceSynced; local?: WorkspaceLocal }): Promise<WorkspaceState> {
    const current = await this.read();
    const merged: WorkspaceState = {
      synced: next.synced ?? current.synced,
      local: next.local ?? current.local,
    };
    await saveToFile(this.dir, merged, { syncedFilename: GIT_SYNCED_FILENAME });
    return merged;
  }
}
