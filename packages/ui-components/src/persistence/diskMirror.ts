import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

// =============================================================================
// Platform-aware bridge to the desktop main process's `WorkspaceFileManager`.
//
// On web there is no `fs` access; the surface is `null` and every call is a
// no-op so the renderer can drive `mirror.write(...)` unconditionally.
//
// On desktop the surface is the `apicircleDesktop.workspaceFile` API exposed
// via the preload's `contextBridge`. Every call hops through IPC to the
// main process and lands as a write under `proper-lockfile`.
//
// Multi-workspace: the disk holds a registry at `<root>/registry.json` plus
// per-workspace subdirectories. The mirror writes each workspace by id.
// =============================================================================

export interface DiskWorkspaceRegistryEntry {
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface DiskWorkspaceRegistry {
  schemaVersion: 1;
  activeWorkspaceId: string | null;
  workspaces: DiskWorkspaceRegistryEntry[];
}

interface DesktopWorkspaceFileSurface {
  status(): Promise<{ workspacesRoot: string }>;
  init(): Promise<{ registry: DiskWorkspaceRegistry; migrated: boolean }>;
  readRegistry(): Promise<DiskWorkspaceRegistry>;
  writeRegistry(registry: DiskWorkspaceRegistry): Promise<void>;
  readWorkspace(
    workspaceId: string,
  ): Promise<{ synced: WorkspaceSynced; local: WorkspaceLocal } | null>;
  writeWorkspace(payload: {
    workspaceId: string;
    synced: WorkspaceSynced;
    local: WorkspaceLocal;
  }): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<DiskWorkspaceRegistry>;
  registerWorkspace(entry: DiskWorkspaceRegistryEntry): Promise<DiskWorkspaceRegistry>;
  setActiveWorkspace(workspaceId: string): Promise<DiskWorkspaceRegistry>;
  flush(): Promise<void>;
}

function getSurface(): DesktopWorkspaceFileSurface | null {
  if (typeof globalThis === 'undefined') return null;
  const w = globalThis as unknown as {
    apicircleDesktop?: { workspaceFile?: DesktopWorkspaceFileSurface };
  };
  return w.apicircleDesktop?.workspaceFile ?? null;
}

export interface DiskMirror {
  /** True when the desktop bridge is wired (Electron); false on web. */
  isAvailable(): boolean;
  /**
   * Init the on-disk store: migrate the legacy single-workspace layout into
   * per-id subdirectories, then return the registry. No-op on web (returns
   * `null`).
   */
  init(): Promise<{ registry: DiskWorkspaceRegistry; migrated: boolean } | null>;
  /** Read the registry. `null` on web. */
  readRegistry(): Promise<DiskWorkspaceRegistry | null>;
  /** Persist the registry. No-op on web. */
  writeRegistry(registry: DiskWorkspaceRegistry): Promise<void>;
  /** Read a workspace's `{synced, local}` pair by id. `null` if missing OR on web. */
  readWorkspace(
    workspaceId: string,
  ): Promise<{ synced: WorkspaceSynced; local: WorkspaceLocal } | null>;
  /** Pipe a workspace state to disk under `<root>/<id>/`. No-op on web. */
  writeWorkspace(payload: {
    workspaceId: string;
    synced: WorkspaceSynced;
    local: WorkspaceLocal;
  }): Promise<void>;
  /** Delete a workspace's dir + registry entry. Returns the updated registry (or null on web). */
  deleteWorkspace(workspaceId: string): Promise<DiskWorkspaceRegistry | null>;
  /** Idempotent registry-entry write. Returns the updated registry (or null on web). */
  registerWorkspace(entry: DiskWorkspaceRegistryEntry): Promise<DiskWorkspaceRegistry | null>;
  /** Switch the active-workspace pointer. Returns the updated registry (or null on web). */
  setActiveWorkspace(workspaceId: string): Promise<DiskWorkspaceRegistry | null>;
  /** Drain every queued disk write. No-op on web. */
  flush(): Promise<void>;
  /** Resolved workspaces-root path, or `null` on web. */
  workspacesRoot(): Promise<string | null>;
}

class DesktopDiskMirror implements DiskMirror {
  constructor(private surface: DesktopWorkspaceFileSurface) {}

  isAvailable(): boolean {
    return true;
  }

  async init(): Promise<{ registry: DiskWorkspaceRegistry; migrated: boolean } | null> {
    try {
      return await this.surface.init();
    } catch (err) {
      console.error('[diskMirror] init failed', err);
      return null;
    }
  }

  async readRegistry(): Promise<DiskWorkspaceRegistry | null> {
    try {
      return await this.surface.readRegistry();
    } catch (err) {
      console.error('[diskMirror] readRegistry failed', err);
      return null;
    }
  }

  async writeRegistry(registry: DiskWorkspaceRegistry): Promise<void> {
    try {
      await this.surface.writeRegistry(registry);
    } catch (err) {
      console.error('[diskMirror] writeRegistry failed', err);
    }
  }

  async readWorkspace(
    workspaceId: string,
  ): Promise<{ synced: WorkspaceSynced; local: WorkspaceLocal } | null> {
    try {
      return await this.surface.readWorkspace(workspaceId);
    } catch (err) {
      console.error('[diskMirror] readWorkspace failed', err);
      return null;
    }
  }

  async writeWorkspace(payload: {
    workspaceId: string;
    synced: WorkspaceSynced;
    local: WorkspaceLocal;
  }): Promise<void> {
    try {
      await this.surface.writeWorkspace(payload);
    } catch (err) {
      // Hot path: don't propagate disk write failures into the store.
      console.error('[diskMirror] writeWorkspace failed', err);
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<DiskWorkspaceRegistry | null> {
    try {
      return await this.surface.deleteWorkspace(workspaceId);
    } catch (err) {
      console.error('[diskMirror] deleteWorkspace failed', err);
      return null;
    }
  }

  async registerWorkspace(
    entry: DiskWorkspaceRegistryEntry,
  ): Promise<DiskWorkspaceRegistry | null> {
    try {
      return await this.surface.registerWorkspace(entry);
    } catch (err) {
      console.error('[diskMirror] registerWorkspace failed', err);
      return null;
    }
  }

  async setActiveWorkspace(workspaceId: string): Promise<DiskWorkspaceRegistry | null> {
    try {
      return await this.surface.setActiveWorkspace(workspaceId);
    } catch (err) {
      console.error('[diskMirror] setActiveWorkspace failed', err);
      return null;
    }
  }

  async flush(): Promise<void> {
    try {
      await this.surface.flush();
    } catch (err) {
      console.error('[diskMirror] flush failed', err);
    }
  }

  async workspacesRoot(): Promise<string | null> {
    try {
      const { workspacesRoot } = await this.surface.status();
      return workspacesRoot;
    } catch {
      return null;
    }
  }
}

class NoopDiskMirror implements DiskMirror {
  isAvailable(): boolean {
    return false;
  }
  init(): Promise<null> {
    return Promise.resolve(null);
  }
  readRegistry(): Promise<null> {
    return Promise.resolve(null);
  }
  writeRegistry(): Promise<void> {
    return Promise.resolve();
  }
  readWorkspace(): Promise<null> {
    return Promise.resolve(null);
  }
  writeWorkspace(): Promise<void> {
    return Promise.resolve();
  }
  deleteWorkspace(): Promise<null> {
    return Promise.resolve(null);
  }
  registerWorkspace(): Promise<null> {
    return Promise.resolve(null);
  }
  setActiveWorkspace(): Promise<null> {
    return Promise.resolve(null);
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  workspacesRoot(): Promise<null> {
    return Promise.resolve(null);
  }
}

/** Module-scope singleton so writers don't have to thread it through every call. */
let mirrorImpl: DiskMirror = (() => {
  const surface = getSurface();
  return surface ? new DesktopDiskMirror(surface) : new NoopDiskMirror();
})();

export function getDiskMirror(): DiskMirror {
  return mirrorImpl;
}

/**
 * Test seam — swap in a fake mirror. Pass `null` to reset to the
 * platform-derived default (desktop bridge if present, otherwise no-op).
 */
export function __setDiskMirrorForTests(impl: DiskMirror | null): void {
  if (impl === null) {
    const surface = getSurface();
    mirrorImpl = surface ? new DesktopDiskMirror(surface) : new NoopDiskMirror();
    return;
  }
  mirrorImpl = impl;
}
