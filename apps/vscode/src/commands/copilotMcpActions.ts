import * as vscode from 'vscode';
import {
  installCopilotMcpConfig,
  UnsafeConfigPathError,
  type InstallResult,
} from '../host/copilotMcpInstall';
import type { VsCodeMcpManager } from '../host/mcpManager';

// =============================================================================
// `apicircle.installCopilotMcpConfig` command — one-click "Install for
// Copilot Chat" surface that writes/merges `.vscode/mcp.json` (or
// whatever `apicircle.mcp.workspaceConfigPath` resolves to). Idempotent —
// running it twice is a no-op.
//
// Toast wording is outcome-aware:
//   • 'created'   → "Installed APICircle MCP for VS Code at <path>."
//   • 'updated'   → "Updated APICircle MCP entry at <path>."
//   • 'unchanged' → "APICircle MCP is already up to date at <path>."
//
// Failure modes (the inner host already guards malformed-JSON and
// missing-dir cases by treating them as "create fresh"; we still wrap
// the call in try/catch so a permission error doesn't bubble as a
// stack trace).
// =============================================================================

export interface CopilotMcpActionsDeps {
  mcp: VsCodeMcpManager;
  /** Returns the relative path inside the active workspace folder where
   *  mcp.json lives. Reads from the `apicircle.mcp.workspaceConfigPath`
   *  setting. */
  getRelativeConfigPath: () => string;
  /** P6R1-G8: optional refresh hook called after a successful install
   *  so the McpView's Copilot row flips from "click to install" to
   *  "✓ installed" without waiting for an unrelated refresh. */
  onInstalled?: () => void;
  log?: (msg: string) => void;
}

export async function installCopilotMcpConfigCommand(deps: CopilotMcpActionsDeps): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const paths = deps.mcp.resolvePaths();

  if (!paths.hasActiveWorkspace || !folders || folders.length === 0) {
    await vscode.window.showWarningMessage(
      'No active APICircle workspace. Open a folder containing .apicircle/workspace.json before installing the Copilot MCP config.',
    );
    return;
  }

  // Resolve which folder owns the active workspace. With a single root
  // it's unambiguous. With multiple roots, the active workspace's
  // apicircleDir lives under one of them — pick the matching folder.
  const owningFolder = pickOwningFolder(folders, paths.workspace);
  if (!owningFolder) {
    await vscode.window.showErrorMessage(
      `Could not locate which workspace folder owns ${paths.workspace}. The Copilot install needs a folder root to host .vscode/mcp.json.`,
    );
    return;
  }

  let result: InstallResult;
  try {
    result = installCopilotMcpConfig({
      workspaceFolder: owningFolder.uri.fsPath,
      relativeConfigPath: deps.getRelativeConfigPath(),
      binary: paths.binary,
      apicircleDir: paths.workspace,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log?.(`installCopilotMcpConfig failed: ${msg}`);
    // P6R4-G2: distinguish the SECURITY path-traversal error from other
    // failures so the user understands they need to fix `.vscode/settings.json`
    // (potentially from a teammate's commit) rather than retry.
    if (err instanceof UnsafeConfigPathError) {
      await vscode.window.showErrorMessage(`Refusing to install — ${msg}`, { modal: true });
      return;
    }
    await vscode.window.showErrorMessage(`Failed to install Copilot MCP config: ${msg}`);
    return;
  }

  deps.log?.(`Copilot install ${result.outcome} at ${result.path}`);
  // P6R1-G8: refresh the McpView so the Copilot row reflects the new
  // state immediately. Only fires on actual writes — unchanged is a
  // no-op for the view too.
  if (result.outcome !== 'unchanged') {
    deps.onInstalled?.();
  }
  const relativeForToast = vscode.workspace.asRelativePath(result.path);
  if (result.outcome === 'created') {
    await vscode.window.showInformationMessage(
      `Installed APICircle MCP for VS Code at ${relativeForToast}. Restart Copilot Chat / your AI client to pick it up.`,
    );
  } else if (result.outcome === 'updated') {
    await vscode.window.showInformationMessage(
      `Updated APICircle MCP entry at ${relativeForToast} (binary or workspace path changed).`,
    );
  } else {
    await vscode.window.showInformationMessage(
      `APICircle MCP entry at ${relativeForToast} is already up to date.`,
    );
  }
}

/**
 * P6R1-G4: extracted so both the install command and the extension.ts
 * probe wiring use the same multi-root folder picker. Picks the folder
 * whose `fsPath` is the longest prefix of `apicircleDir` — works for
 * nested folders + handles Windows backslashes + case-insensitive
 * matching.
 */
export function pickOwningFolder(
  folders: readonly vscode.WorkspaceFolder[],
  apicircleDir: string,
): vscode.WorkspaceFolder | undefined {
  const target = apicircleDir.replace(/\\/g, '/').toLowerCase();
  let best: vscode.WorkspaceFolder | undefined;
  let bestLen = -1;
  for (const folder of folders) {
    const fsPath = folder.uri.fsPath.replace(/\\/g, '/').toLowerCase();
    if (target.startsWith(fsPath) && fsPath.length > bestLen) {
      best = folder;
      bestLen = fsPath.length;
    }
  }
  return best;
}
