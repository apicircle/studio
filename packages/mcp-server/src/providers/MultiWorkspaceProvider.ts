import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import type { WorkspacePatch, WorkspaceState } from '@apicircle/core';
import {
  loadRegistry,
  loadWorkspaceById,
  saveRegistry,
  setActiveWorkspace as setActiveWorkspaceOnDisk,
  workspaceDirFor,
  type WorkspaceRegistry,
} from '@apicircle/core/workspace/registry';
import { FileBackedWorkspaceProvider } from './FileBackedWorkspaceProvider';
import type { WorkspaceProvider } from './WorkspaceProvider';
import { WorkspaceNotFoundError, type WorkspaceSummary, type Workspaces } from './Workspaces';

// =============================================================================
// MultiWorkspaceProvider — `Workspaces` impl backed by a registry root on
// disk (`<root>/registry.json` + per-id subdirectories). Wraps a
// `FileBackedWorkspaceProvider` per active id and rebuilds it whenever the
// active workspace changes.
//
// Used by the MCP server when launched against a registry root (the
// desktop's `userData/workspaces/`). Tools that consume `ctx.workspace`
// keep working — they always see the current active workspace; tools that
// consume `ctx.workspaces` can drill into any registered workspace.
// =============================================================================

/**
 * Lazy `WorkspaceProvider` that re-resolves the active workspace id from
 * `registry.json` on every `read` / `apply` / `write` call.
 *
 * Why this exists: the desktop owns `registry.json`. The user can switch
 * active workspaces in the UI at any time while their AI client's MCP
 * server keeps running. Before this wrapper landed, `MultiWorkspaceProvider`
 * cached the per-id `FileBackedWorkspaceProvider` at `init()` time, so a
 * mid-session workspace switch left the MCP writing to the OLD workspace.
 * Now each call re-reads the registry and routes to whichever id is
 * currently active.
 *
 * Cost: one small JSON file read + a `proper-lockfile` acquire per tool
 * call. The registry is a few hundred bytes; the cost is negligible
 * compared to the patch application itself.
 */
class LazyActiveWorkspaceProvider implements WorkspaceProvider {
  constructor(
    private readonly registryRoot: string,
    private readonly onActiveResolved: (workspaceId: string) => void,
  ) {}

  private async resolveActive(): Promise<FileBackedWorkspaceProvider> {
    const registry = await loadRegistry(this.registryRoot);
    const activeId = registry?.activeWorkspaceId ?? null;
    if (!activeId) {
      throw new Error(
        'No active workspace. Open the desktop app at least once, or run `apicircle workspaces create <name>`.',
      );
    }
    this.onActiveResolved(activeId);
    return new FileBackedWorkspaceProvider(workspaceDirFor(this.registryRoot, activeId));
  }

  async read(): Promise<WorkspaceState> {
    const provider = await this.resolveActive();
    return provider.read();
  }

  async apply(patch: WorkspacePatch): Promise<{ state: WorkspaceState; changedIds: string[] }> {
    const provider = await this.resolveActive();
    return provider.apply(patch);
  }

  async write(next: { synced?: WorkspaceSynced; local?: WorkspaceLocal }): Promise<WorkspaceState> {
    const provider = await this.resolveActive();
    return provider.write(next);
  }
}

export class MultiWorkspaceProvider implements Workspaces {
  /** Last-known active workspace id. Refreshed every time the lazy
   *  provider resolves; reflects what the most recent operation saw on
   *  disk, not a stale boot-time snapshot. */
  private activeWorkspaceId: string | null = null;
  /** The lazy provider tool handlers consume as `ctx.workspace`. Holds a
   *  reference back to this instance so each call updates
   *  `activeWorkspaceId` for `activeId()` callers + diagnostic logs. */
  private readonly lazyProvider: LazyActiveWorkspaceProvider;

  constructor(private readonly registryRoot: string) {
    this.lazyProvider = new LazyActiveWorkspaceProvider(this.registryRoot, (id) => {
      this.activeWorkspaceId = id;
    });
  }

  /**
   * Read the registry from disk so the host can log a boot banner. Does
   * NOT cache a per-id provider — each `activeProvider()` call re-reads
   * the registry, so a workspace switch in the desktop is picked up by
   * the next tool call without restarting the MCP server.
   */
  async init(): Promise<WorkspaceRegistry> {
    const registry = (await loadRegistry(this.registryRoot)) ?? {
      schemaVersion: 1 as const,
      activeWorkspaceId: null,
      workspaces: [],
    };
    this.activeWorkspaceId = registry.activeWorkspaceId;
    return registry;
  }

  /**
   * The provider tool handlers see as `ctx.workspace`. Returns a lazy
   * provider whose `read` / `apply` / `write` calls re-read
   * `registry.json` so the right active workspace is always targeted
   * even if the desktop switched workspaces since this MCP process
   * started.
   */
  activeProvider(): WorkspaceProvider {
    return this.lazyProvider;
  }

  // ─── Workspaces interface ──────────────────────────────────────────────────

  async list(): Promise<WorkspaceSummary[]> {
    const registry = (await loadRegistry(this.registryRoot)) ?? {
      schemaVersion: 1 as const,
      activeWorkspaceId: null,
      workspaces: [],
    };
    const out: WorkspaceSummary[] = [];
    for (const entry of registry.workspaces) {
      let counts: WorkspaceSummary['counts'] = null;
      try {
        const state = await loadWorkspaceById(this.registryRoot, entry.id);
        if (state) {
          counts = {
            requests: Object.keys(state.synced.collections.requests).length,
            folders: Object.keys(state.synced.collections.folders).length,
            environments: Object.keys(state.synced.environments.items).length,
            mockServers: Object.keys(state.synced.mockServers ?? {}).length,
            plans: Object.keys(state.synced.executionPlans ?? {}).length,
          };
        }
      } catch {
        // Treat a missing / unreadable per-workspace file as null counts.
        counts = null;
      }
      out.push({
        id: entry.id,
        name: entry.name,
        isActive: entry.id === registry.activeWorkspaceId,
        createdAt: entry.createdAt,
        lastOpenedAt: entry.lastOpenedAt,
        counts,
      });
    }
    return out;
  }

  for(workspaceId: string): WorkspaceProvider {
    return new FileBackedWorkspaceProvider(workspaceDirFor(this.registryRoot, workspaceId));
  }

  activeId(): string | null {
    return this.activeWorkspaceId;
  }

  async setActive(workspaceId: string): Promise<void> {
    const registry = await loadRegistry(this.registryRoot);
    if (!registry || !registry.workspaces.some((w) => w.id === workspaceId)) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    await setActiveWorkspaceOnDisk(this.registryRoot, workspaceId);
    // The lazy provider re-reads `registry.json` on its next operation,
    // so we don't need to construct a new provider here — just update the
    // cached `activeId()` value so diagnostic callers see the new id
    // without waiting for the next tool call.
    this.activeWorkspaceId = workspaceId;
  }

  /**
   * Idempotent registry write — used by tests / tools that need to
   * persist registry updates that didn't go through `setActive`. The
   * lazy active provider picks the new id up on its next operation.
   */
  async writeRegistry(registry: WorkspaceRegistry): Promise<void> {
    await saveRegistry(this.registryRoot, registry);
    this.activeWorkspaceId = registry.activeWorkspaceId;
  }
}
