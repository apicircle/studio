import type { WorkspaceProvider } from './WorkspaceProvider';

// =============================================================================
// Workspaces — multi-workspace surface exposed to tool handlers.
//
// Every existing tool consumes `ctx.workspace` (a `WorkspaceProvider` scoped
// to ONE workspace) and continues to work unchanged. New tools that need to
// list workspaces or pick a specific one consume `ctx.workspaces` instead.
//
// `ctx.workspace` is the *active* workspace's provider — set by the host
// at construction time and refreshed when `setActive` is called.
// =============================================================================

export interface WorkspaceSummary {
  id: string;
  name: string;
  isActive: boolean;
  /** ISO timestamps surfaced from the on-disk registry entry. */
  createdAt: string;
  lastOpenedAt: string;
  /** Cheap counts populated when the summary is built so AI clients can
   *  decide which workspace to drill into without a second tool call.
   *  May be `null` if the per-workspace doc couldn't be read. */
  counts: {
    requests: number;
    folders: number;
    environments: number;
    mockServers: number;
    plans: number;
  } | null;
}

export interface Workspaces {
  /** Enumerate every workspace + which is currently active. */
  list(): Promise<WorkspaceSummary[]>;

  /** Return a `WorkspaceProvider` scoped to a specific workspace id. */
  for(workspaceId: string): WorkspaceProvider;

  /** id of the workspace that `ctx.workspace` currently points at. */
  activeId(): string | null;

  /** Switch which workspace `ctx.workspace` resolves to. */
  setActive(workspaceId: string): Promise<void>;
}

/**
 * Trivial single-workspace adapter — wraps an existing `WorkspaceProvider`
 * so legacy single-dir hosts can still answer `list()` and `for()` calls.
 * `list()` returns one entry (the active workspace itself); `for(id)` is a
 * passthrough that asserts the id matches.
 */
export class SingleWorkspaceAdapter implements Workspaces {
  constructor(
    private readonly provider: WorkspaceProvider,
    private workspaceId: string | null,
    private readonly displayName: string = 'Workspace',
  ) {}

  async list(): Promise<WorkspaceSummary[]> {
    const state = await this.provider.read();
    const id = state.synced.workspaceId;
    this.workspaceId = id;
    return [
      {
        id,
        name: this.displayName,
        isActive: true,
        createdAt: state.synced.meta.createdAt,
        lastOpenedAt: state.synced.meta.updatedAt,
        counts: {
          requests: Object.keys(state.synced.collections.requests).length,
          folders: Object.keys(state.synced.collections.folders).length,
          environments: Object.keys(state.synced.environments.items).length,
          mockServers: Object.keys(state.synced.mockServers ?? {}).length,
          plans: Object.keys(state.synced.executionPlans ?? {}).length,
        },
      },
    ];
  }

  for(workspaceId: string): WorkspaceProvider {
    if (this.workspaceId && workspaceId !== this.workspaceId) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return this.provider;
  }

  activeId(): string | null {
    return this.workspaceId;
  }

  setActive(workspaceId: string): Promise<void> {
    if (this.workspaceId && workspaceId !== this.workspaceId) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return Promise.resolve();
  }
}

export class WorkspaceNotFoundError extends Error {
  readonly code = 'workspace-not-found' as const;
  readonly workspaceId: string;
  constructor(workspaceId: string) {
    super(`No workspace with id "${workspaceId}" is available on this server.`);
    this.name = 'WorkspaceNotFoundError';
    this.workspaceId = workspaceId;
  }
}
