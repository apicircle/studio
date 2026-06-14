import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import type { WorkspacePatch, WorkspaceState } from '@apicircle/core';

// =============================================================================
// WorkspaceProvider — pluggable backend that lets the same MCP tool handlers
// drive three different hosts:
//
//   • file-backed (CLI, headless MCP) — reads/writes workspace.json and
//     workspace.local.json from disk under a proper-lockfile lock.
//   • IPC-backed (Electron desktop) — round-trips reads/writes through the
//     renderer's Zustand store via ipcMain.
//   • in-process (unit tests, programmatic embedding) — keeps state in
//     memory.
//
// Tool handlers never construct one directly; the host wires the right
// implementation in based on its environment.
// =============================================================================

export interface WorkspaceProvider {
  /** Snapshot the current `{ synced, local }` pair. */
  read(): Promise<WorkspaceState>;

  /**
   * Apply a single mutation. Returns the resulting state + the ids the
   * patch touched, so the tool handler can echo a meaningful response back
   * to the AI client (e.g. "created request `r-abc`").
   */
  apply(patch: WorkspacePatch): Promise<{ state: WorkspaceState; changedIds: string[] }>;

  /**
   * Bulk overwrite. Used by `workspace.write` (rare — most edits go
   * through `apply`). Implementations should accept a partial pair so
   * tools targeting only synced or only local can leave the other side
   * untouched.
   */
  write(next: { synced?: WorkspaceSynced; local?: WorkspaceLocal }): Promise<WorkspaceState>;
}
