import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  installClientMcpConfig,
  installMcpForClients,
  detectClientMcpConfigState,
  resolveInstallPath,
  UnsafeClientConfigPathError,
  INSTALLABLE_CLIENTS,
  CLIENT_LABELS,
  type InstallableClient,
  type ClientInstallResult,
} from '../host/mcpClientInstall';
import type { VsCodeMcpManager } from '../host/mcpManager';

// =============================================================================
// Phase 8 — multi-AI-client MCP install commands.
//
// Three command surfaces wired here:
//
//   - apicircle.installMcpForClient(client)
//        Install the apicircle entry into one specific client's user-level
//        config file. Surfaced as a per-row inline action in the MCP view.
//
//   - apicircle.installMcpForAllClients
//        Bulk install across every client listed in
//        `apicircle.mcp.autoConfigureClients`. Default: empty array (opt-in).
//        Surfaced as a view-title button + a command-palette entry.
//
//   - apicircle.uninstallMcpForClient(client)
//        Remove the apicircle entry from a single client's user-level
//        config file (leaving any foreign entries intact). Surfaced as a
//        per-row inline action when the client is currently installed.
//
// Toast wording follows the same outcome-aware pattern as the P6
// Copilot install: created / updated / unchanged.
// =============================================================================

export interface McpClientActionsDeps {
  mcp: VsCodeMcpManager;
  /** Returns the configured clients list from
   *  `apicircle.mcp.autoConfigureClients`. */
  getAutoConfigureClients: () => readonly InstallableClient[];
  /** Refresh the McpView so per-client install rows pick up the new state. */
  onChanged?: () => void;
  log?: (msg: string) => void;
}

function assertWorkspaceReady(
  deps: McpClientActionsDeps,
): { binary: string; apicircleDir: string } | null {
  const paths = deps.mcp.resolvePaths();
  if (!paths.hasActiveWorkspace) {
    void vscode.window.showWarningMessage(
      'No active APICircle workspace. Open a folder containing .apicircle/workspace.json before installing MCP for external clients.',
    );
    return null;
  }
  return { binary: paths.binary, apicircleDir: paths.workspace };
}

// ---------------------------------------------------------------------------
// Single-client install command
// ---------------------------------------------------------------------------

export async function installMcpForClientCommand(
  deps: McpClientActionsDeps,
  client: InstallableClient,
): Promise<void> {
  const ready = assertWorkspaceReady(deps);
  if (!ready) return;

  let result: ClientInstallResult;
  try {
    result = installClientMcpConfig({
      client,
      binary: ready.binary,
      apicircleDir: ready.apicircleDir,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log?.(`installMcpForClient(${client}) failed: ${msg}`);
    if (err instanceof UnsafeClientConfigPathError) {
      await vscode.window.showErrorMessage(
        `Refusing to install MCP for ${CLIENT_LABELS[client]} — ${msg}`,
        { modal: true },
      );
      return;
    }
    await vscode.window.showErrorMessage(
      `Failed to install MCP for ${CLIENT_LABELS[client]}: ${msg}`,
    );
    return;
  }

  deps.log?.(`${client} install ${result.outcome} at ${result.path}`);
  if (result.outcome !== 'unchanged') {
    deps.onChanged?.();
  }

  const label = CLIENT_LABELS[client];
  if (result.outcome === 'created') {
    await vscode.window.showInformationMessage(
      `Installed APICircle MCP for ${label} at ${result.path}. Restart ${label} to pick it up.`,
    );
  } else if (result.outcome === 'updated') {
    await vscode.window.showInformationMessage(
      `Updated APICircle MCP entry for ${label} at ${result.path} (binary or workspace path changed).`,
    );
  } else {
    await vscode.window.showInformationMessage(
      `APICircle MCP entry for ${label} at ${result.path} is already up to date.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Bulk install command
// ---------------------------------------------------------------------------

export async function installMcpForAllClientsCommand(deps: McpClientActionsDeps): Promise<void> {
  const ready = assertWorkspaceReady(deps);
  if (!ready) return;

  let configured = deps.getAutoConfigureClients();
  if (configured.length === 0) {
    // P8-1b-G2: empty configured list → open a multi-pick so the user
    // doesn't get a silent "nothing to do" toast. Saving the picks back
    // into the setting is offered via a follow-up modal.
    const picks = await vscode.window.showQuickPick(
      INSTALLABLE_CLIENTS.map((c) => ({ label: CLIENT_LABELS[c], description: c, value: c })),
      {
        canPickMany: true,
        title: 'Install APICircle MCP for which AI clients?',
        placeHolder:
          'Pick one or more. Configure `apicircle.mcp.autoConfigureClients` to skip this prompt next time.',
      },
    );
    if (!picks || picks.length === 0) return;
    configured = picks.map((p) => p.value);
  }

  const report = installMcpForClients(configured, {
    binary: ready.binary,
    apicircleDir: ready.apicircleDir,
  });

  for (const r of report.results) {
    if (r.outcome === 'error') {
      deps.log?.(`bulk install: ${r.client} failed (${r.path ?? 'no path'}): ${r.error}`);
    } else {
      deps.log?.(`bulk install: ${r.client} ${r.outcome} at ${r.path}`);
    }
  }

  if (report.summary.created + report.summary.updated > 0) {
    deps.onChanged?.();
  }

  const parts: string[] = [];
  if (report.summary.created > 0) parts.push(`${report.summary.created} installed`);
  if (report.summary.updated > 0) parts.push(`${report.summary.updated} updated`);
  if (report.summary.unchanged > 0) parts.push(`${report.summary.unchanged} already up to date`);
  if (report.summary.error > 0) parts.push(`${report.summary.error} failed`);

  const summaryText = parts.join(' · ');
  if (report.summary.error > 0) {
    const failedClients = report.results
      .filter((r) => r.outcome === 'error')
      .map((r) => CLIENT_LABELS[r.client])
      .join(', ');
    await vscode.window.showWarningMessage(
      `APICircle MCP bulk install: ${summaryText}. Failed: ${failedClients}. See "APICircle Runs" output channel for details.`,
    );
  } else if (report.summary.created + report.summary.updated > 0) {
    await vscode.window.showInformationMessage(
      `APICircle MCP bulk install: ${summaryText}. Restart the affected clients to pick up the new servers.`,
    );
  } else {
    await vscode.window.showInformationMessage(`APICircle MCP bulk install: ${summaryText}.`);
  }
}

// ---------------------------------------------------------------------------
// Single-client uninstall command
// ---------------------------------------------------------------------------

export async function uninstallMcpForClientCommand(
  deps: McpClientActionsDeps,
  client: InstallableClient,
): Promise<void> {
  // The host module is install-only — uninstall reads + writes the file
  // directly here. We still go through the schema-aware path so we only
  // remove the apicircle key, leaving foreign entries intact.
  const ready = assertWorkspaceReady(deps);
  if (!ready) return;

  // Probe install state first so we can short-circuit "nothing to do".
  const before = detectClientMcpConfigState({
    client,
    binary: ready.binary,
    apicircleDir: ready.apicircleDir,
  });
  if (before === 'absent') {
    await vscode.window.showInformationMessage(
      `APICircle MCP entry is already absent from ${CLIENT_LABELS[client]} — nothing to remove.`,
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Remove APICircle MCP entry from ${CLIENT_LABELS[client]}? Other server entries in the same config will be preserved.`,
    { modal: true },
    'Remove',
  );
  if (confirm !== 'Remove') return;

  try {
    removeApicircleEntry(client);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log?.(`uninstallMcpForClient(${client}) failed: ${msg}`);
    await vscode.window.showErrorMessage(
      `Failed to remove APICircle MCP entry from ${CLIENT_LABELS[client]}: ${msg}`,
    );
    return;
  }

  deps.log?.(`${client} uninstall succeeded`);
  deps.onChanged?.();
  await vscode.window.showInformationMessage(
    `Removed APICircle MCP entry from ${CLIENT_LABELS[client]}.`,
  );
}

/** Schema-aware key removal. Lives here (not in the host module) because
 *  the host module is intentionally install-only — the uninstall path is
 *  rarely used and doesn't share enough code to warrant a generic helper. */
function removeApicircleEntry(client: InstallableClient): void {
  const env = {
    homedir: os.homedir(),
    platform: process.platform,
    appdata: process.env.APPDATA,
  };
  const fullPath = resolveInstallPath(client, env);
  let raw: string;
  try {
    raw = fs.readFileSync(fullPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // unparseable — leave it alone
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const schemaKey = client === 'zed' ? 'context_servers' : 'mcpServers';
  const block = parsed[schemaKey] as Record<string, unknown> | undefined;
  if (!block || typeof block !== 'object') return;
  if (!('apicircle' in block)) return;
  const next = { ...block };
  delete next.apicircle;
  // If the block is now empty, remove the schemaKey entirely — leaves a
  // tidier file for the user to hand-edit later.
  let nextParsed: Record<string, unknown>;
  if (Object.keys(next).length === 0) {
    const { [schemaKey]: _, ...rest } = parsed;
    void _; // satisfy no-unused-vars
    nextParsed = rest;
  } else {
    nextParsed = { ...parsed, [schemaKey]: next };
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(nextParsed, null, 2) + '\n');
}
