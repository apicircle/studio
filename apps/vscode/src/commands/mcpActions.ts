import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as YAML from 'yaml';
import type { AiClient } from '@apicircle/mcp-server';
import { aiClientDisplayName, type VsCodeMcpManager } from '../host/mcpManager';

// =============================================================================
// MCP commands — open AI-client config files / open the connect guide.
//
// The view's per-client row fires `apicircle.openMcpConfigFile` with the
// node `{ kind: 'client', client: '<id>' }` on click. The command palette
// can invoke each command without a node — those paths prompt the user via
// QuickPick.
//
// When the config file doesn't exist yet it is created with the apicircle
// MCP snippet pre-populated so the user can review, adjust, and restart
// their client to activate.
// =============================================================================

export interface McpActionsDeps {
  mcp: VsCodeMcpManager;
  /** Refresh the McpView so install-state rows pick up the new state. */
  onChanged?: () => void;
  log?: (msg: string) => void;
}

interface ClientNode {
  kind: 'client';
  client: AiClient;
}

async function pickClient(deps: McpActionsDeps): Promise<AiClient | undefined> {
  const picked = await vscode.window.showQuickPick(
    deps.mcp.supportedClients().map((c) => ({
      label: aiClientDisplayName(c),
      description: c,
      client: c,
    })),
    { placeHolder: 'Choose an AI client to connect to API Circle MCP' },
  );
  return picked?.client;
}

export async function openMcpConfigFileCommand(
  deps: McpActionsDeps,
  node?: ClientNode,
): Promise<void> {
  const client = node?.client ?? (await pickClient(deps));
  if (!client) return;
  const configPath = deps.mcp.getConfigPath(client);
  if (!configPath) {
    await vscode.window.showInformationMessage(
      `${aiClientDisplayName(client)} doesn't have a fixed MCP config path — refer to the Connect Guide for setup instructions.`,
    );
    return;
  }
  await openConfigFileFor(deps, client, configPath);
}

async function openConfigFileFor(
  deps: McpActionsDeps,
  client: AiClient,
  configPath: string,
): Promise<void> {
  let exists = true;
  try {
    fs.statSync(configPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
    else throw err;
  }
  if (!exists) {
    const create = await vscode.window.showWarningMessage(
      `${aiClientDisplayName(client)}'s config file doesn't exist at ${configPath}. Create it with the API Circle MCP snippet?`,
      'Create',
      'Cancel',
    );
    if (create !== 'Create') return;
    const snippet = deps.mcp.getConfigSnippet(client);
    const isYaml = configPath.endsWith('.yaml') || configPath.endsWith('.yml');
    let content: string;
    if (snippet) {
      if (isYaml) {
        const parsed: unknown = JSON.parse(snippet.forwardSlash);
        content = YAML.stringify(parsed);
      } else {
        content = snippet.forwardSlash;
      }
    } else {
      content = isYaml
        ? 'mcpServers: {}\n'
        : configPath.endsWith('.toml')
          ? ''
          : '{\n  "mcpServers": {}\n}\n';
    }
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, content + '\n', { flag: 'wx' });
      deps.onChanged?.();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        await vscode.window.showErrorMessage(
          `Failed to create ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(configPath));
  const label = aiClientDisplayName(client);
  await vscode.window.showInformationMessage(
    `Opened ${label}'s MCP config. Add or verify the "apicircle" entry, then restart ${label} to activate.`,
  );
}

export async function openMcpConnectGuideCommand(): Promise<void> {
  // The guide lives in the repo's docs. Phase 5 ships it as a web link to
  // the GitHub-hosted Markdown (same approach the desktop community
  // section uses). External link → opens in the user's browser, doesn't
  // hijack their VS Code window.
  await vscode.env.openExternal(
    vscode.Uri.parse(
      'https://github.com/apicircle/studio/blob/main/docs/connect-your-ai-client.md',
    ),
  );
}

export async function revealMcpBinaryInfoCommand(deps: McpActionsDeps): Promise<void> {
  const { binary, workspace, hasActiveWorkspace } = deps.mcp.resolvePaths();
  const tools = deps.mcp.toolCatalog();
  if (!hasActiveWorkspace) {
    await vscode.window.showInformationMessage(
      `API Circle MCP binary: ${binary} (${tools.length} tools). No active workspace — open a folder with an API Circle workspace to use it.`,
    );
    return;
  }
  await vscode.window.showInformationMessage(
    `API Circle MCP binary: ${binary} · workspace: ${workspace} · ${tools.length} tools exposed.`,
  );
}
