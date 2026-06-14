import type * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WORKSPACE_DIR, WORKSPACE_JSON_PATH } from '@apicircle/core';
import {
  defaultApicircleRoot,
  REGISTRY_FILE,
  workspaceDirFor,
  type WorkspaceRegistry,
} from '@apicircle/core/workspace/registry';

// =============================================================================
// Workspace discovery — two sources:
//
// 1. Git-folder scan: find canonical `.apicircle/workspace.json` paths inside
//    the user's open VS Code workspace folders.
// 2. Registry scan: read `~/.apicircle/registry.json` and expose any workspace
//    registered there (created by Desktop, CLI, or MCP).
//
// Git-folder layout:
//   <repo-root>/.apicircle/workspace.json
//   <repo-root>/.apicircle/attachments/<slotId>
//
// Registry layout:
//   ~/.apicircle/registry.json
//   ~/.apicircle/workspaces/<id>/workspace.json
//
// `globalStorageUri/<workspaceId>/workspace.local.json` for device-local data —
// resolved separately by deviceLocalPath() below.
// =============================================================================

export type WorkspaceSource = 'git-folder' | 'registry';

export interface DiscoveredWorkspace {
  /** Stable identifier — currently the absolute path to the .apicircle/ dir
   *  (git-folder) or the workspace id from the registry. */
  id: string;
  /** Absolute path to the workspace's `.apicircle/` directory (git-folder)
   *  or the per-workspace dir under `~/.apicircle/workspaces/<id>/` (registry). */
  apicircleDir: string;
  /** Absolute path to the workspace's `workspace.json`. */
  workspaceJsonPath: string;
  /** The VS Code workspace folder this `.apicircle/` lives in.
   *  `undefined` for registry-discovered workspaces. */
  workspaceFolder: vscode.WorkspaceFolder | undefined;
  /** Human-readable label for the workspace picker. */
  label: string;
  /** How this workspace was discovered. */
  source: WorkspaceSource;
}

export interface DiscoveryResult {
  workspaces: DiscoveredWorkspace[];
  /** Workspace folders that DON'T yet contain a `.apicircle/` — candidates for
   *  "Create New Workspace". */
  foldersWithoutWorkspace: vscode.WorkspaceFolder[];
}

/**
 * Synchronously scan the open VS Code workspace folders for canonical
 * `.apicircle/workspace.json` files. Returns the set of discovered workspaces
 * plus the folders that don't yet have one (so the welcome view can offer
 * "Create New Workspace" in the right places).
 */
export function discoverWorkspaces(
  folders: readonly vscode.WorkspaceFolder[] | undefined,
): DiscoveryResult {
  const workspaces: DiscoveredWorkspace[] = [];
  const foldersWithoutWorkspace: vscode.WorkspaceFolder[] = [];

  if (!folders || folders.length === 0) {
    return { workspaces, foldersWithoutWorkspace };
  }

  for (const folder of folders) {
    const apicircleDir = path.join(folder.uri.fsPath, WORKSPACE_DIR);
    const workspaceJsonPath = path.join(folder.uri.fsPath, WORKSPACE_JSON_PATH);
    if (fs.existsSync(workspaceJsonPath)) {
      workspaces.push({
        id: apicircleDir, // bootstrap id; real workspaceId loaded from file
        apicircleDir,
        workspaceJsonPath,
        workspaceFolder: folder,
        label: folder.name,
        source: 'git-folder',
      });
    } else {
      foldersWithoutWorkspace.push(folder);
    }
  }

  return { workspaces, foldersWithoutWorkspace };
}

/**
 * Resolve the device-local data folder for a discovered workspace.
 *
 * Per the locked Phase 1 decision, this is deterministic — no user setting.
 * The path is `<globalStorageUri>/<workspaceHash>/`, where the hash is derived
 * from the workspace's `.apicircle/` absolute path so the same `.apicircle/`
 * folder on two different machines naturally maps to two different local
 * folders (because each machine's `globalStorageUri` is OS-user-scoped).
 */
export function deviceLocalPath(
  globalStorageUri: vscode.Uri,
  workspace: Pick<DiscoveredWorkspace, 'apicircleDir'>,
): string {
  const hash = hashPath(workspace.apicircleDir);
  return path.join(globalStorageUri.fsPath, hash);
}

/**
 * Stable per-workspace hash used to name the device-local storage folder.
 * Not a cryptographic hash — just a short, filesystem-safe digest of the
 * absolute path. Collision odds are negligible for human workspace counts.
 */
function hashPath(absolutePath: string): string {
  let h = 5381;
  const normalized = absolutePath.replace(/\\/g, '/').toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) | 0;
  }
  // Unsigned hex, 8 chars — short enough to embed in a path, long enough to
  // be collision-resistant for the realistic number of workspaces a user
  // opens (hundreds, not millions).
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Resolve the registered-workspace id that an already-open editor belongs to —
 * the pure core of the startup "adopt active workspace from open editors" pass
 * (see `extension.ts`). Returns the matching workspace id, or null when the
 * editor isn't an APICircle surface (or its workspace isn't registered).
 *
 * Two editor shapes map to a workspace:
 *   - an `apicircle://<authority>/…` virtual YAML, where the authority is the
 *     hex-encoded workspace id (same encoding `ApicircleFsProvider` uses);
 *   - the raw `<root>/.apicircle/workspace.json` file.
 *
 * Any malformed authority is treated as "no match" rather than thrown, so a
 * stray editor can never crash activation.
 */
export function workspaceIdForOpenEditor(
  editor: { scheme: string; authority: string; fsPath: string },
  registered: ReadonlyArray<{ id: string; workspaceJsonPath: string }>,
): string | null {
  if (editor.scheme === 'apicircle') {
    if (!editor.authority) return null;
    let decoded: string;
    try {
      decoded = Buffer.from(editor.authority, 'hex').toString('utf8');
    } catch {
      return null;
    }
    return registered.find((w) => w.id === decoded)?.id ?? null;
  }
  if (editor.scheme === 'file') {
    const norm = editor.fsPath.replace(/\\/g, '/').toLowerCase();
    if (!norm.endsWith('/.apicircle/workspace.json')) return null;
    return (
      registered.find((w) => w.workspaceJsonPath.replace(/\\/g, '/').toLowerCase() === norm)?.id ??
      null
    );
  }
  return null;
}

/**
 * Find a discovered workspace whose `.apicircle/` directory contains the given
 * absolute path. Used by the FileSystemWatcher to translate disk-path changes
 * into workspace-scoped refresh events.
 */
export function findOwningWorkspace(
  result: DiscoveryResult,
  absolutePath: string,
): DiscoveredWorkspace | undefined {
  const normalized = absolutePath.replace(/\\/g, '/').toLowerCase();
  return result.workspaces.find((ws) => {
    const dir = ws.apicircleDir.replace(/\\/g, '/').toLowerCase();
    return normalized === dir || normalized.startsWith(dir + '/');
  });
}

/**
 * Discover workspaces registered in `~/.apicircle/registry.json`. Returns
 * entries for each workspace whose `workspace.json` actually exists on disk.
 * Non-throwing — returns an empty array if the registry is missing or
 * malformed.
 *
 * @param root — override for the apicircle root (testing seam). Defaults to
 * `defaultApicircleRoot()`.
 */
export function discoverRegistryWorkspaces(root?: string): DiscoveredWorkspace[] {
  const apicircleRoot = root ?? defaultApicircleRoot();
  const registryPath = path.join(apicircleRoot, REGISTRY_FILE);

  let raw: string;
  try {
    raw = fs.readFileSync(registryPath, 'utf8');
  } catch {
    return [];
  }

  let registry: WorkspaceRegistry;
  try {
    registry = JSON.parse(raw) as WorkspaceRegistry;
  } catch {
    return [];
  }

  if (!registry.workspaces || !Array.isArray(registry.workspaces)) return [];

  const results: DiscoveredWorkspace[] = [];
  for (const entry of registry.workspaces) {
    const wsDir = workspaceDirFor(apicircleRoot, entry.id);
    const wsJsonPath = path.join(wsDir, 'workspace.json');
    if (fs.existsSync(wsJsonPath)) {
      results.push({
        id: entry.id,
        apicircleDir: wsDir,
        workspaceJsonPath: wsJsonPath,
        workspaceFolder: undefined,
        label: entry.name,
        source: 'registry',
      });
    }
  }
  return results;
}
