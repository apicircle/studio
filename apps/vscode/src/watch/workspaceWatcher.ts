import * as vscode from 'vscode';

// =============================================================================
// WorkspaceWatcher — registers `vscode.workspace.createFileSystemWatcher`
// against BOTH `.apicircle/workspace-*/workspace.json` (synced) and any device-local
// `workspace.local.json` files the bridge knows about, and re-fires the
// caller's `onAnyChange` callback so every sidebar TreeView can refresh.
//
// Gap B: previously only the synced file was watched. Local-only mutations
// (plan create, history append, snapshot capture, env-var rename) never
// triggered a refresh — users had to manually press the refresh button.
// =============================================================================

export interface WorkspaceWatcherOptions {
  /** Glob pattern for the synced file. */
  syncedGlob: string;
  /** Glob pattern for the device-local file. */
  localGlob: string;
  /** Fires whenever either file changes. */
  onAnyChange: () => void;
}

export interface WatcherHandle extends vscode.Disposable {
  /** The underlying watchers — exposed for assertion in tests. */
  watchers: vscode.FileSystemWatcher[];
}

/**
 * Register file-system watchers for the workspace files and call
 * `onAnyChange` on any change/create/delete event from either watcher.
 *
 * The watchers self-dispose via the returned WatcherHandle.dispose().
 */
export function registerWorkspaceWatchers(options: WorkspaceWatcherOptions): WatcherHandle {
  const syncedWatcher = vscode.workspace.createFileSystemWatcher(options.syncedGlob);
  const localWatcher = vscode.workspace.createFileSystemWatcher(options.localGlob);
  const subs: vscode.Disposable[] = [
    syncedWatcher,
    localWatcher,
    syncedWatcher.onDidChange(options.onAnyChange),
    syncedWatcher.onDidCreate(options.onAnyChange),
    syncedWatcher.onDidDelete(options.onAnyChange),
    localWatcher.onDidChange(options.onAnyChange),
    localWatcher.onDidCreate(options.onAnyChange),
    localWatcher.onDidDelete(options.onAnyChange),
  ];

  return {
    watchers: [syncedWatcher, localWatcher],
    dispose(): void {
      for (const s of subs) s.dispose();
    },
  };
}
