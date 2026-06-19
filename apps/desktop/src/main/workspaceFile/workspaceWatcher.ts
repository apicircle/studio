import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { WORKSPACE_DIR_PREFIX, workspaceDirFor } from '@apicircle/core/workspace/registry';
import type { WorkspaceFileManager } from './workspaceFileManager';

// =============================================================================
// WorkspaceWatcher — watches the on-disk workspaces root for external writes
// (the MCP server, the `apicircle` CLI, or a user editing the JSON by hand)
// and emits `externalChange` events the IPC bridge can push to the renderer.
//
// Why this exists: before this watcher, the renderer's IndexedDB-backed store
// only re-read disk when the user clicked the MCP panel's "Refresh" button.
// Meanwhile, the desktop's debounced IDB→disk mirror writes on every store
// mutation. If an external writer landed a change while the desktop was
// running, the next mirror write would silently clobber it.
//
// With this watcher, the renderer auto-refreshes whenever an external file
// change is detected — MCP / CLI writes land in the editor without manual
// intervention, and the existing hydrate timestamp-compare prevents the
// next mirror write from overwriting them.
//
// Self-write suppression — stat-based, not time-based:
//
//   `WorkspaceFileManager` calls `markSelfWrite(workspaceId)` AFTER each of
//   its own writes resolves. The watcher stats the file at mark time and
//   records `{ mtimeMs, size }`. When an fs event fires, the watcher
//   stats the file again — if it still matches the recorded mark, the
//   event is from our write and gets suppressed; otherwise it's an
//   external write and gets emitted.
//
//   Why stat-based: an earlier version used a 1.5s time window
//   ("suppress any event within 1.5s of a mark"). That fails in two
//   directions:
//     - OS delays (Windows AV, disk pressure) push the event past the
//       window → false external event.
//     - External + self writes interleaving within 1.5s → external
//       event suppressed, MCP write never surfaces.
//   Stat-based suppression has neither failure mode: it answers
//   "does the file's current bytes match what I wrote?" directly.
//
// Cross-platform notes: `fs.watch` works on all three platforms but has
// known quirks. We watch the registry root non-recursively (catches
// `registry.json` changes + new workspace dir creation), and each per-id
// dir individually (catches `workspace.json` writes inside).
// `rename` events for the synced file are handled by re-`watch()`-ing the
// dir, since some platforms invalidate the watcher after an atomic rename.
// =============================================================================

const REGISTRY_FILENAME = 'registry.json';
const SYNCED_FILENAME = 'workspace.json';

/** Debounce per-id events so a burst of `change` notifications coalesces. */
const EVENT_DEBOUNCE_MS = 200;

/** Reserved id the watcher uses to signal a registry.json change. */
export const REGISTRY_CHANGE = 'registry';

export interface ExternalChangeEvent {
  /** Workspace id whose `workspace.json` changed, or the literal
   *  `'registry'` (also exported as `REGISTRY_CHANGE`) for `registry.json`. */
  workspaceId: string;
}

interface StatSnapshot {
  mtimeMs: number;
  size: number;
}

export class WorkspaceWatcher extends EventEmitter {
  private rootWatcher: fs.FSWatcher | null = null;
  private dirWatchers = new Map<string, fs.FSWatcher>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per-id snapshot of the file's stats immediately after a self-write.
   *  The watcher's emit path re-stats and compares; matches are
   *  suppressed. Cleared on file delete (stat error during mark). */
  private selfWriteSnapshots = new Map<string, StatSnapshot>();
  /** True after `start()` has wired the initial watch tree. */
  private started = false;

  constructor(private readonly manager: WorkspaceFileManager) {
    super();
  }

  /**
   * Begin watching. Safe to call before the directory exists — we create
   * it (via `mkdirSync({ recursive: true })`) so the root watcher has
   * something to watch. Existing per-id dirs are wired up immediately;
   * new ones are picked up via the workspaces-dir watcher's `rename` events.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    const root = this.manager.workspacesRoot;
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch (err) {
      console.error('[workspaceWatcher] could not create workspaces root', root, err);
      return;
    }
    // Watch root for registry.json changes AND workspace-* directory creation/removal.
    try {
      this.rootWatcher = fs.watch(root, { persistent: false }, (_eventType, filename) => {
        if (filename === REGISTRY_FILENAME) {
          this.scheduleEmit(REGISTRY_CHANGE);
        }
        // Rescan workspace dirs when filename matches the workspace-dir prefix
        // OR when filename is null — on some Linux CI environments inotify
        // delivers events without a filename, so we always rescan to avoid
        // missing new workspace-* directory creation.
        if (!filename || filename.startsWith(WORKSPACE_DIR_PREFIX)) {
          this.rescanWorkspaceDirs();
        }
      });
      this.rootWatcher.on('error', (err) => {
        console.error('[workspaceWatcher] root watcher error', err);
      });
    } catch (err) {
      console.error('[workspaceWatcher] could not watch root', root, err);
      return;
    }
    // Wire up watchers for whatever workspace-* dirs already exist.
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      console.error('[workspaceWatcher] could not enumerate workspaces root', err);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(WORKSPACE_DIR_PREFIX)) {
        const id = entry.name.slice(WORKSPACE_DIR_PREFIX.length);
        this.watchWorkspaceDir(id);
      }
    }
  }

  /** Stop every watcher. Called on app quit and from tests. */
  stop(): void {
    this.started = false;
    if (this.rootWatcher) {
      try {
        this.rootWatcher.close();
      } catch {
        /* closing a closed watcher throws — ignore */
      }
      this.rootWatcher = null;
    }
    for (const w of this.dirWatchers.values()) {
      try {
        w.close();
      } catch {
        /* same */
      }
    }
    this.dirWatchers.clear();
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    this.selfWriteSnapshots.clear();
  }

  /**
   * Record a self-write snapshot. Call AFTER the write resolves so the
   * stat read reflects what was just written. Pass `REGISTRY_CHANGE`
   * (`'registry'`) for registry writes; any other value is treated as a
   * workspace id. Async because we need to stat the file.
   *
   * Also ensures the per-workspace-dir watcher is active for the given id.
   * On Linux CI (overlayfs / GitHub Actions), inotify subdirectory-creation
   * events are sometimes not delivered to the root watcher, meaning
   * `rescanWorkspaceDirs()` may never run for a newly created workspace dir.
   * By wiring the per-dir watcher here — directly after the workspace dir
   * exists on disk — we guarantee coverage without relying on the root
   * watcher's directory event delivery.
   */
  async markSelfWrite(workspaceId: string): Promise<void> {
    // Arm the per-dir watcher eagerly on the first self-write for this id.
    if (this.started && workspaceId !== REGISTRY_CHANGE && !this.dirWatchers.has(workspaceId)) {
      this.watchWorkspaceDir(workspaceId);
    }
    const filePath = this.targetPath(workspaceId);
    try {
      const stat = await fs.promises.stat(filePath);
      this.selfWriteSnapshots.set(workspaceId, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    } catch {
      // File missing (delete, or stat raced a rename) — drop any prior
      // mark so the next event is treated as external.
      this.selfWriteSnapshots.delete(workspaceId);
    }
  }

  /**
   * Subscribe to external-change events. Returns an unsubscribe fn.
   * Convenience over `EventEmitter.on` so callers don't have to import
   * the event-name string constant.
   */
  onExternalChange(listener: (event: ExternalChangeEvent) => void): () => void {
    this.on('externalChange', listener);
    return () => {
      this.off('externalChange', listener);
    };
  }

  private targetPath(workspaceId: string): string {
    if (workspaceId === REGISTRY_CHANGE) {
      return path.join(this.manager.workspacesRoot, REGISTRY_FILENAME);
    }
    return path.join(workspaceDirFor(this.manager.workspacesRoot, workspaceId), SYNCED_FILENAME);
  }

  /** Full rescan of the workspace-* dirs under root. Called whenever the
   *  root watcher sees a relevant event (including null-filename events on
   *  Linux CI where inotify omits the changed name). */
  private rescanWorkspaceDirs(): void {
    const root = this.manager.workspacesRoot;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      const present = new Set<string>();
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith(WORKSPACE_DIR_PREFIX)) {
          const id = entry.name.slice(WORKSPACE_DIR_PREFIX.length);
          present.add(id);
          if (!this.dirWatchers.has(id)) {
            this.watchWorkspaceDir(id);
          }
        }
      }
      // Tear down watchers for dirs that no longer exist.
      for (const id of [...this.dirWatchers.keys()]) {
        if (!present.has(id)) {
          const w = this.dirWatchers.get(id);
          if (w) {
            try {
              w.close();
            } catch {
              /* ignore */
            }
          }
          this.dirWatchers.delete(id);
        }
      }
    } catch (err) {
      console.error('[workspaceWatcher] workspace-dir re-scan failed', err);
    }
  }

  private watchWorkspaceDir(workspaceId: string): void {
    const dir = workspaceDirFor(this.manager.workspacesRoot, workspaceId);
    try {
      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (filename === SYNCED_FILENAME) {
          this.scheduleEmit(workspaceId);
        }
        // `rename` on the synced file (atomic write via tmpfile + rename)
        // can invalidate the watcher on some platforms — re-arm.
        if (eventType === 'rename' && filename === SYNCED_FILENAME) {
          // Re-watch the dir after a tick to pick up the new inode.
          setTimeout(() => {
            if (!this.dirWatchers.has(workspaceId)) return;
            const old = this.dirWatchers.get(workspaceId);
            if (old) {
              try {
                old.close();
              } catch {
                /* ignore */
              }
            }
            this.dirWatchers.delete(workspaceId);
            this.watchWorkspaceDir(workspaceId);
          }, 50);
        }
      });
      watcher.on('error', (err) => {
        console.error(`[workspaceWatcher] dir watcher error for ${workspaceId}`, err);
      });
      this.dirWatchers.set(workspaceId, watcher);
    } catch (err) {
      console.error(`[workspaceWatcher] could not watch dir for ${workspaceId}`, err);
    }
  }

  private scheduleEmit(target: string): void {
    // Coalesce a burst of events into one emission.
    const existing = this.debounceTimers.get(target);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(target);
      void this.emitIfExternal(target);
    }, EVENT_DEBOUNCE_MS);
    this.debounceTimers.set(target, timer);
  }

  private async emitIfExternal(target: string): Promise<void> {
    const mark = this.selfWriteSnapshots.get(target);
    if (mark) {
      // Stat the current file and compare to what we wrote. If the bytes
      // still match (mtimeMs + size), the event was triggered by our
      // own write — suppress. Any subsequent external write will change
      // mtime or size and surface naturally.
      try {
        const stat = await fs.promises.stat(this.targetPath(target));
        if (stat.mtimeMs === mark.mtimeMs && stat.size === mark.size) {
          return;
        }
      } catch {
        // File missing now (delete) — fall through to emit so the
        // renderer can react to the disappearance.
      }
    }
    this.emit('externalChange', { workspaceId: target });
  }
}
