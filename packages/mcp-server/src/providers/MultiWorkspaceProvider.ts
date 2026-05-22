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

export class MultiWorkspaceProvider implements Workspaces {
  private active: WorkspaceProvider | null = null;
  private activeWorkspaceId: string | null = null;

  constructor(private readonly registryRoot: string) {}

  /**
   * Hydrate the active provider from disk. Must be called once before the
   * MCP host boots so `ctx.workspace.read()` doesn't race the first
   * registry-load. Returns the registry the boot can log.
   */
  async init(): Promise<WorkspaceRegistry> {
    const registry = (await loadRegistry(this.registryRoot)) ?? {
      schemaVersion: 1 as const,
      activeWorkspaceId: null,
      workspaces: [],
    };
    if (registry.activeWorkspaceId) {
      this.activeWorkspaceId = registry.activeWorkspaceId;
      this.active = new FileBackedWorkspaceProvider(
        workspaceDirFor(this.registryRoot, registry.activeWorkspaceId),
      );
    }
    return registry;
  }

  /** The provider tool handlers see as `ctx.workspace`. */
  activeProvider(): WorkspaceProvider {
    if (!this.active) {
      throw new Error(
        'No active workspace. Open the desktop app at least once, or run `apicircle workspaces create <name>`.',
      );
    }
    return this.active;
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
    const next = await setActiveWorkspaceOnDisk(this.registryRoot, workspaceId);
    void next;
    this.activeWorkspaceId = workspaceId;
    this.active = new FileBackedWorkspaceProvider(workspaceDirFor(this.registryRoot, workspaceId));
  }

  /**
   * Idempotent registry write — used by tests / tools that need to
   * persist registry updates that didn't go through `setActive`.
   */
  async writeRegistry(registry: WorkspaceRegistry): Promise<void> {
    await saveRegistry(this.registryRoot, registry);
    this.activeWorkspaceId = registry.activeWorkspaceId;
    if (registry.activeWorkspaceId) {
      this.active = new FileBackedWorkspaceProvider(
        workspaceDirFor(this.registryRoot, registry.activeWorkspaceId),
      );
    }
  }
}
