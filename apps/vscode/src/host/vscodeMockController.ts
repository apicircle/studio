import { InProcessMockController } from '@apicircle/core/providers';
import type { MockController, StartMockResult } from '@apicircle/core/providers';
import type { MockServer, MockRuntimeEntry } from '@apicircle/shared';
import type { WorkspaceSurface } from './vscodeBridge';

// =============================================================================
// VsCodeMockController — the VS Code extension's mock lifecycle owner.
//
// Wraps `InProcessMockController` (from `@apicircle/core/providers`, same engine
// the CLI uses) and bridges its runtime state to `WorkspaceLocal.mockRuntime.active`
// so the MockView, status bar, CodeLens, and external readers (CLI / MCP)
// all see the same view of which mocks are running on which ports.
//
// Lifecycle:
//   • start(server) → controller.start → write local.mockRuntime.active[id]
//   • stop(serverId) → controller.stop → delete local.mockRuntime.active[id]
//   • reconcile() → stop any controller-tracked server whose definition
//     vanished externally (Git pull / CLI / MCP edit). Wired to the
//     workspaceWatcher's onAnyChange. Idempotent and exception-safe.
//   • disposeAll() → stop ALL servers (extension shutdown) + clear active map.
//
// Multi-root concurrency (P3R1-G3): the underlying InProcessMockController is
// keyed by serverId. Two workspaces with the same mock id (e.g. one is a
// fork of the other) would collide. We namespace internally via
// `${workspaceId}::${serverId}` before delegating, and clone the MockServer
// to inject the namespaced id without mutating the caller's reference.
// External callers continue to pass the original serverId.
//
// Workspace-switch correctness (P3R2-G2): stop/restart/isRunning/runtime now
// look up the namespaced id via the `tracked` map keyed on the (workspaceId,
// serverId) tuple — NOT by re-deriving from the currently-active workspace.
// Otherwise a workspace change between start and stop would orphan the
// running server.
//
// Change notification (P3R2-G1): every lifecycle method fires `onChange` so
// downstream surfaces (status bar, CodeLens) can refresh without polling.
//
// Cross-process semantics: when VS Code closes, every running mock dies.
// That mirrors the desktop app's model — the same `MockRuntimeEntry` shape
// is per-process.
// =============================================================================

interface VsCodeMockControllerDeps {
  /** Returns the currently-active workspace surface, or undefined. */
  getActiveSurface: () => WorkspaceSurface | undefined;
  /**
   * Optional logger for diagnostic messages (e.g. cross-workspace stop
   * fallback). Defaults to `console.warn`. P3R4-G5: lets tests inject
   * a vi.fn() and assert on the warn payload without polluting test
   * stdout. Phase 4 swapped the production wiring for the consolidated
   * `API Circle Runs` OutputChannel via `RunsChannel.forCategory('mock')`
   * (see extension.ts) — the console.warn fallback only fires in tests
   * that don't pass an explicit log.
   */
  log?: (message: string) => void;
}

interface TrackedEntry {
  workspaceId: string;
  serverId: string;
}

/** Lightweight callback subscription — avoids importing vscode in this module. */
export interface ChangeSubscription {
  dispose: () => void;
}

export class VsCodeMockController {
  private readonly controller: MockController;

  /**
   * Map from namespaced id (the value we hand to InProcessMockController) →
   * `{ workspaceId, serverId }`. Source of truth for "is this serverId
   * currently tracked, and if so, under what namespaced id?".
   */
  private readonly tracked = new Map<string, TrackedEntry>();

  /** Reverse index: `${workspaceId}::${serverId}` ↔ namespaced id. */
  // (today these are identical — `tracked`'s key IS the namespaced id —
  // but keeping the lookup explicit makes future ID-format changes safe.)

  private readonly changeListeners: Array<() => void> = [];

  private readonly log: (message: string) => void;

  constructor(private readonly deps: VsCodeMockControllerDeps) {
    this.controller = new InProcessMockController();
    this.log = deps.log ?? ((msg: string): void => console.warn(msg));
  }

  // ---------------------------------------------------------------------------
  // Change notification (P3R2-G1)
  // ---------------------------------------------------------------------------

  /** Subscribe to lifecycle changes (start / stop / restart / reconcile). */
  onChange(listener: () => void): ChangeSubscription {
    this.changeListeners.push(listener);
    return {
      dispose: () => {
        const i = this.changeListeners.indexOf(listener);
        if (i >= 0) this.changeListeners.splice(i, 1);
      },
    };
  }

  private fireChange(): void {
    // P3R3-G1: snapshot the array before iterating. A listener may call
    // `sub.dispose()` (which splices the array) — iterating the live array
    // would skip an adjacent listener or call one twice.
    const snapshot = [...this.changeListeners];
    for (const l of snapshot) {
      try {
        l();
      } catch {
        // never let a listener crash a lifecycle call
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start a mock server and persist its runtime entry to WorkspaceLocal. */
  async start(server: MockServer, opts: { port?: number } = {}): Promise<StartMockResult> {
    const workspaceId = this.activeWorkspaceId();
    const namespaced = makeNamespacedId(workspaceId, server.id);
    const namespacedServer: MockServer = { ...server, id: namespaced };
    const result = await this.controller.start(namespacedServer, opts);
    this.tracked.set(namespaced, { workspaceId, serverId: server.id });
    await this.writeRuntime(server.id, {
      port: result.port,
      pid: result.pid,
      startedAt: result.startedAt,
      lastError: null,
      requestCount: 0,
    });
    this.fireChange();
    return result;
  }

  /**
   * Stop a mock server and remove its runtime entry from WorkspaceLocal.
   *
   * P3R2-G2: looks up the namespaced id from the `tracked` map keyed by
   * the currently-active workspaceId. If the active workspace changed
   * between start and stop (or the workspace is gone), we fall back to
   * any tracked entry matching the serverId — that handles workspace-
   * switch scenarios cleanly without leaking the underlying server.
   */
  async stop(serverId: string): Promise<void> {
    const entry = this.findTrackedByServerId(serverId);
    if (!entry) {
      // Not tracked — already stopped or never started. Underlying controller
      // is a no-op when the id is unknown, so this is safe.
      return;
    }
    const [namespaced, info] = entry;
    await this.controller.stop(namespaced);
    this.tracked.delete(namespaced);
    await this.clearRuntimeFor(info.workspaceId, info.serverId);
    this.fireChange();
  }

  /** Restart shorthand — stop + start with the same server. */
  async restart(server: MockServer, opts: { port?: number } = {}): Promise<StartMockResult> {
    // stop() is no-op when not running, so this is safe pre-start too.
    await this.stop(server.id);
    return this.start(server, opts);
  }

  /** Whether a given server id currently has a running mock for the active workspace. */
  async isRunning(serverId: string): Promise<boolean> {
    const entry = this.findTrackedByServerId(serverId);
    if (!entry) return false;
    const list = await this.controller.list();
    return list.some((e) => e.serverId === entry[0]);
  }

  /** Current runtime metadata for a running server, or null. */
  async runtime(serverId: string): Promise<MockRuntimeEntry | null> {
    const entry = this.findTrackedByServerId(serverId);
    if (!entry) return null;
    const list = await this.controller.list();
    const match = list.find((e) => e.serverId === entry[0]);
    return match ? match.runtime : null;
  }

  /**
   * P3R1-G2: stop any controller-tracked server whose definition no longer
   * exists in the active workspace's `synced.mockServers`. Called from the
   * workspaceWatcher onAnyChange handler. Idempotent — safe to call on
   * every change event.
   *
   * P3R2-G5: wraps every potential throw site so an exception here never
   * becomes an unhandled rejection in the watcher callback chain.
   */
  async reconcile(): Promise<void> {
    try {
      const surface = this.deps.getActiveSurface();
      if (!surface) return;
      const state = await surface.read();
      const workspaceId = this.activeWorkspaceId();
      let changed = false;
      const ours = Array.from(this.tracked.entries()).filter(
        ([, info]) => info.workspaceId === workspaceId,
      );
      for (const [namespaced, info] of ours) {
        if (!state.synced.mockServers[info.serverId]) {
          try {
            await this.controller.stop(namespaced);
          } catch {
            // controller may have stopped already
          }
          this.tracked.delete(namespaced);
          try {
            await this.clearRuntimeFor(info.workspaceId, info.serverId);
          } catch {
            // surface write failed (bridge disposed mid-reconcile)
          }
          changed = true;
        }
      }
      if (changed) this.fireChange();
    } catch {
      // Reconcile must never throw — it's called from a void-promise watcher.
    }
  }

  /**
   * Stop every running server — call from extension deactivate().
   *
   * P3R1-G7 / P3R2-G6: tolerates `surface.write` itself throwing mid-iteration
   * (bridge disposed during extension shutdown). Each per-server step is
   * wrapped so one failure doesn't prevent the others from stopping.
   */
  async disposeAll(): Promise<void> {
    const list = await this.controller.list();
    for (const e of list) {
      try {
        await this.controller.stop(e.serverId);
      } catch {
        // swallow — extension is shutting down
      }
      const tracked = this.tracked.get(e.serverId);
      this.tracked.delete(e.serverId);
      if (tracked) {
        try {
          await this.clearRuntimeFor(tracked.workspaceId, tracked.serverId);
        } catch {
          // bridge disposed — local state is moot; the workspace file
          // will be re-read on next activation.
        }
      }
    }
    this.fireChange();
  }

  // ---------------------------------------------------------------------------
  // WorkspaceLocal.mockRuntime sync — runtime state never goes through
  // applyMutation (it's per-device and lacks a patch variant). We write
  // through `surface.write({ local })` directly. Same pattern as
  // persistHistory.
  // ---------------------------------------------------------------------------

  private async writeRuntime(serverId: string, entry: MockRuntimeEntry): Promise<void> {
    const surface = this.deps.getActiveSurface();
    if (!surface) return;
    const state = await surface.read();
    await surface.write({
      local: {
        ...state.local,
        mockRuntime: {
          active: { ...state.local.mockRuntime.active, [serverId]: entry },
        },
      },
    });
  }

  /**
   * Clear runtime for the specific workspaceId+serverId pair. Used in stop /
   * reconcile / disposeAll to handle the case where the workspace surface
   * has changed between start and stop. Falls back to the active surface
   * when the workspaceId matches (the common case).
   */
  private async clearRuntimeFor(workspaceId: string, serverId: string): Promise<void> {
    const surface = this.deps.getActiveSurface();
    if (!surface) return;
    // Only write into the active workspace's local file. If the
    // workspaceId here doesn't match the active workspace, the runtime
    // entry will be reconciled on the next activation of that workspace.
    if (surface.workspace.id !== workspaceId) return;
    const state = await surface.read();
    if (!state.local.mockRuntime.active[serverId]) return;
    const next = { ...state.local.mockRuntime.active };
    delete next[serverId];
    await surface.write({
      local: {
        ...state.local,
        mockRuntime: { active: next },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** O(n) reverse lookup — n is bounded by the number of active mocks. */
  private findTrackedByServerId(serverId: string): [string, TrackedEntry] | undefined {
    const workspaceId = this.activeWorkspaceId();
    // Prefer the entry matching the active workspaceId.
    for (const entry of this.tracked.entries()) {
      if (entry[1].serverId === serverId && entry[1].workspaceId === workspaceId) {
        return entry;
      }
    }
    // P3R3-G2: fallback only — any tracked entry with this serverId.
    // Surfaces a warning since this means the controller is acting on a
    // mock from a workspace that is no longer active (e.g. workspace
    // switched between start and stop). Map iteration is insertion-order,
    // so the result is deterministic but may not match user intent.
    for (const entry of this.tracked.entries()) {
      if (entry[1].serverId === serverId) {
        this.log(
          `[VsCodeMockController] Falling back to non-active workspace for serverId="${serverId}" ` +
            `(active="${workspaceId}", matched="${entry[1].workspaceId}"). ` +
            `This usually means the workspace changed between start and stop.`,
        );
        return entry;
      }
    }
    return undefined;
  }

  private activeWorkspaceId(): string {
    const surface = this.deps.getActiveSurface();
    return surface?.workspace.id ?? '__no_workspace__';
  }
}

/** Stable namespacing key — keeps two workspaces with shared mock ids apart. */
function makeNamespacedId(workspaceId: string, serverId: string): string {
  return `${workspaceId}::${serverId}`;
}
