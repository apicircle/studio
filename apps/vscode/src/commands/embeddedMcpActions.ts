import * as vscode from 'vscode';
import { UnsafeBindHostError, type EmbeddedMcpHost } from '../host/embeddedMcpHost';

// =============================================================================
// Phase 10 — Embedded MCP host commands.
//
// Surfaces the start/stop/restart lifecycle + a copy-URL helper. All four
// share the same dependency shape so the wiring layer can pass one object
// across them.
// =============================================================================

export interface EmbeddedMcpActionsDeps {
  host: EmbeddedMcpHost;
  /** Reads {port, bindHost} from `apicircle.mcp.embeddedHost.*` settings. */
  getOptions: () => { port: number; bindHost: string };
  /** Called after a successful start/stop/restart so the McpView refreshes. */
  onChanged?: () => void;
  log?: (msg: string) => void;
}

export async function startEmbeddedMcpCommand(deps: EmbeddedMcpActionsDeps): Promise<void> {
  if (deps.host.isRunning()) {
    const info = deps.host.info();
    await vscode.window.showInformationMessage(
      `Embedded MCP host is already running on ${info?.url}.`,
    );
    return;
  }
  const opts = deps.getOptions();
  try {
    const info = await deps.host.start(opts);
    deps.log?.(`embedded MCP host started on ${info.url}`);
    deps.onChanged?.();
    const choice = await vscode.window.showInformationMessage(
      `Embedded MCP host running on http://${info.bindHost}:${info.port}. Click **Copy URL** to share with your AI client.`,
      'Copy URL',
    );
    if (choice === 'Copy URL') {
      await vscode.env.clipboard.writeText(info.url);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log?.(`embedded MCP host start failed: ${msg}`);
    if (err instanceof UnsafeBindHostError) {
      await vscode.window.showErrorMessage(`Refusing to start — ${msg}`, { modal: true });
      return;
    }
    await vscode.window.showErrorMessage(`Failed to start embedded MCP host: ${msg}`);
  }
}

export async function stopEmbeddedMcpCommand(deps: EmbeddedMcpActionsDeps): Promise<void> {
  if (!deps.host.isRunning()) {
    void vscode.window.showInformationMessage('Embedded MCP host is not running.');
    return;
  }
  await deps.host.stop();
  deps.log?.('embedded MCP host stopped');
  deps.onChanged?.();
  await vscode.window.showInformationMessage('Embedded MCP host stopped.');
}

export async function restartEmbeddedMcpCommand(deps: EmbeddedMcpActionsDeps): Promise<void> {
  const opts = deps.getOptions();
  try {
    const info = await deps.host.restart(opts);
    deps.log?.(`embedded MCP host restarted on ${info.url} (token rotated)`);
    deps.onChanged?.();
    await vscode.window.showInformationMessage(
      `Embedded MCP host restarted on http://${info.bindHost}:${info.port}. The bearer token has been rotated — reconnect your AI client.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log?.(`embedded MCP host restart failed: ${msg}`);
    if (err instanceof UnsafeBindHostError) {
      await vscode.window.showErrorMessage(`Refusing to restart — ${msg}`, { modal: true });
      return;
    }
    await vscode.window.showErrorMessage(`Failed to restart embedded MCP host: ${msg}`);
  }
}

export async function copyEmbeddedMcpUrlCommand(deps: EmbeddedMcpActionsDeps): Promise<void> {
  const info = deps.host.info();
  if (!info) {
    void vscode.window.showInformationMessage(
      'Embedded MCP host is not running. Start it first via **API Circle: Start Embedded MCP Host**.',
    );
    return;
  }
  await vscode.env.clipboard.writeText(info.url);
  await vscode.window.showInformationMessage(
    `Copied embedded MCP host URL to clipboard. The URL includes the bearer token — share it only with AI clients you trust.`,
  );
}
