import { app } from 'electron';
import * as path from 'path';
import type { WorkspaceState } from '@apicircle/core';
import {
  deleteWorkspaceById,
  emptyRegistry,
  loadRegistry,
  loadWorkspaceById,
  migrateLegacyWorkspace,
  registerWorkspace,
  saveRegistry,
  saveWorkspaceById,
  setActiveWorkspace as setActiveWorkspaceOnDisk,
  type WorkspaceRegistry,
  type WorkspaceRegistryEntry,
} from '@apicircle/core/workspace/registry';

// =============================================================================
// WorkspaceFileManager — multi-workspace mirror on top of `workspaceRegistry`.
//
// Layout owned by this manager:
//
//   <root>/                                 ← `userData/workspaces`
//     registry.json
//     <workspace-id-1>/
//       workspace.synced.json
//       workspace.local.json
//     <workspace-id-2>/
//       ...
//
// The desktop renderer writes its state to IndexedDB on every mutation and
// fans the same state out through the IPC bridge so the on-disk per-workspace
// pair stays in sync. CLI / MCP consumers read those files directly; switching
// workspaces in the UI bumps `activeWorkspaceId` here, not the file contents.
//
// Writes coalesce per workspace id. A second `write(id, state)` while the
// first is on the wire drops the older state — only the latest snapshot
// for each id needs to land. `flush()` awaits every queued write across
// every id so callers (app-quit, git push) can be sure disk reflects memory.
//
// On first boot we migrate the legacy `userData/workspace/` layout (single
// workspace next to no registry) into `userData/workspaces/<id>/`.
// =============================================================================

const WORKSPACES_DIRNAME = 'workspaces';
const LEGACY_WORKSPACE_DIRNAME = 'workspace';
const DEFAULT_LEGACY_NAME = 'My Workspace';

interface PendingEntry {
  state: WorkspaceState;
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class WorkspaceFileManager {
  /** Root holding `registry.json` + per-workspace subdirectories. */
  readonly workspacesRoot: string;
  /** Legacy single-workspace dir to migrate from on first boot. */
  readonly legacyDir: string;

  /** Per-workspaceId queue of {state, resolved-when-landed} entries. */
  private pending = new Map<string, PendingEntry>();
  /** Per-workspaceId in-flight drain promise. */
  private inflight = new Map<string, Promise<void>>();

  constructor(opts?: { workspacesRoot?: string; legacyDir?: string }) {
    const userData = (() => {
      try {
        return app.getPath('userData');
      } catch {
        // Allow construction outside Electron (unit tests pass explicit
        // paths). `app.getPath` throws when called before `app.whenReady`.
        return '';
      }
    })();
    this.workspacesRoot = opts?.workspacesRoot ?? path.join(userData, WORKSPACES_DIRNAME);
    this.legacyDir = opts?.legacyDir ?? path.join(userData, LEGACY_WORKSPACE_DIRNAME);
  }

  /**
   * One-time init: migrate the legacy single-workspace dir if present, then
   * load the registry. Returns the resolved registry the desktop UI can
   * boot from. Safe to call on every app launch — migrations are idempotent
   * via the `loadRegistry() !== null` short-circuit in
   * `migrateLegacyWorkspace`.
   */
  async init(): Promise<{ registry: WorkspaceRegistry; migrated: boolean }> {
    const { migrated, registry } = await migrateLegacyWorkspace({
      legacyDir: this.legacyDir,
      registryRoot: this.workspacesRoot,
      defaultName: DEFAULT_LEGACY_NAME,
    });
    if (migrated || registry.workspaces.length > 0) {
      return { registry, migrated };
    }
    // No legacy dir AND no registry yet — start with an empty registry.
    // The first desktop hydrate will seed a workspace and call writeWorkspace.
    return { registry, migrated: false };
  }

  /** Read the registry, refreshing from disk. */
  async readRegistry(): Promise<WorkspaceRegistry> {
    const fromDisk = await loadRegistry(this.workspacesRoot);
    return fromDisk ?? emptyRegistry();
  }

  /** Write the registry, replacing whatever is on disk. */
  async writeRegistry(registry: WorkspaceRegistry): Promise<void> {
    await saveRegistry(this.workspacesRoot, registry);
  }

  /** Read a single workspace's pair. Returns `null` if the dir / file is missing. */
  async readWorkspace(workspaceId: string): Promise<WorkspaceState | null> {
    return loadWorkspaceById(this.workspacesRoot, workspaceId);
  }

  /**
   * Queue a write for the workspace at `workspaceId`. Returns once the
   * write has landed (or has been superseded by a newer queued write for
   * the same id). Concurrent writes to *different* workspaceIds run in
   * parallel — each id has its own in-flight slot.
   */
  async writeWorkspace(workspaceId: string, state: WorkspaceState): Promise<void> {
    if (state.synced.workspaceId !== workspaceId) {
      throw new Error(
        `writeWorkspace: workspaceId mismatch (arg=${workspaceId}, synced.workspaceId=${state.synced.workspaceId})`,
      );
    }
    const prior = this.pending.get(workspaceId);
    if (prior) {
      // Replace the prior pending state — only the latest matters. The
      // earlier caller's promise resolves when *this* state lands.
      prior.state = state;
      return prior.promise;
    }
    // Build a new pending entry with a deferred promise we can hand out.
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry: PendingEntry = { state, promise, resolve, reject };
    this.pending.set(workspaceId, entry);
    void this.kickDrain(workspaceId);
    return promise;
  }

  /**
   * Delete a workspace's directory + registry entry. Returns the updated
   * registry. Concurrent reads / writes for the same id race the delete;
   * we drain in-flight writes first so the deletion is final.
   */
  async deleteWorkspaceFile(workspaceId: string): Promise<WorkspaceRegistry> {
    // Wait for any in-flight write for this id before deleting.
    const inflight = this.inflight.get(workspaceId);
    if (inflight) await inflight.catch(() => {});
    this.pending.delete(workspaceId);
    return deleteWorkspaceById(this.workspacesRoot, workspaceId);
  }

  /**
   * Register a workspace (idempotent). Caller must have written
   * `workspace.synced.json` first via `writeWorkspace`.
   */
  async registerWorkspaceEntry(entry: WorkspaceRegistryEntry): Promise<WorkspaceRegistry> {
    return registerWorkspace(this.workspacesRoot, entry);
  }

  /** Move the active-workspace pointer to a new id. */
  async setActiveWorkspace(workspaceId: string): Promise<WorkspaceRegistry> {
    return setActiveWorkspaceOnDisk(this.workspacesRoot, workspaceId);
  }

  /** Await every queued write across every workspace id. */
  async flush(): Promise<void> {
    // Snapshot the inflight map at call time — drain any pending entries
    // by waiting on their per-id promises (which resolve once the drain
    // loop empties their slot).
    const promises: Promise<void>[] = [];
    for (const inflight of this.inflight.values()) promises.push(inflight.catch(() => {}));
    for (const entry of this.pending.values()) promises.push(entry.promise.catch(() => {}));
    if (promises.length === 0) return;
    await Promise.all(promises);
    // A flush mid-drain could have triggered another write — recurse once
    // to drain that too. Bounded: each kick is monotonic per id.
    if (this.pending.size > 0 || this.inflight.size > 0) {
      await this.flush();
    }
  }

  private kickDrain(workspaceId: string): Promise<void> {
    if (this.inflight.has(workspaceId)) {
      return this.inflight.get(workspaceId)!;
    }
    const work = this.drain(workspaceId);
    this.inflight.set(workspaceId, work);
    void work.finally(() => {
      if (this.inflight.get(workspaceId) === work) {
        this.inflight.delete(workspaceId);
      }
    });
    return work;
  }

  private async drain(workspaceId: string): Promise<void> {
    while (this.pending.has(workspaceId)) {
      const entry = this.pending.get(workspaceId)!;
      // Pop the entry BEFORE writing so a concurrent `writeWorkspace` for
      // the same id queues a fresh entry rather than mutating ours.
      this.pending.delete(workspaceId);
      try {
        await saveWorkspaceById(this.workspacesRoot, workspaceId, entry.state);
        entry.resolve();
      } catch (err) {
        entry.reject(err);
      }
    }
  }
}
