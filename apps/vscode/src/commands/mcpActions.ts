import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AiClient } from '@apicircle/mcp-server';
import { aiClientDisplayName, type VsCodeMcpManager } from '../host/mcpManager';

// =============================================================================
// MCP commands — copy config snippets / open AI-client config files / open
// the connect guide.
//
// The view's per-client row fires `apicircle.copyMcpConfig` with the node
// `{ kind: 'client', client: '<id>' }` on click. The command palette can
// invoke each command without a node — those paths prompt the user via
// QuickPick.
//
// All commands no-op cleanly when no workspace is active; the snippet
// copy command surfaces "no active workspace" UX rather than emitting an
// invalid snippet.
// =============================================================================

export interface McpActionsDeps {
  mcp: VsCodeMcpManager;
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
    { placeHolder: 'Choose an AI client to connect to APICircle MCP' },
  );
  return picked?.client;
}

export async function copyMcpConfigCommand(deps: McpActionsDeps, node?: ClientNode): Promise<void> {
  const client = node?.client ?? (await pickClient(deps));
  if (!client) return;
  const snippet = deps.mcp.getConfigSnippet(client);
  if (!snippet) {
    await vscode.window.showWarningMessage(
      'No active APICircle workspace — open a folder containing .apicircle/workspace.json to generate the MCP snippet.',
    );
    return;
  }
  // On Windows, JSON-escaped paths (`\\`) are technically what JSON.stringify
  // emits, but most config readers accept forward-slash too and it's far
  // easier to read. Offer the choice ONLY when the two differ.
  let toCopy: string;
  if (snippet.identical) {
    toCopy = snippet.forwardSlash;
  } else {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'Forward-slash paths (recommended)',
          description: 'C:/Users/... — readable, valid JSON, accepted by every client',
          variant: 'forward' as const,
        },
        {
          label: 'Escaped paths',
          description: 'C:\\\\Users\\\\... — what JSON.stringify emits',
          variant: 'escaped' as const,
        },
      ],
      { placeHolder: 'Which path style for the snippet?' },
    );
    if (!choice) return;
    toCopy = choice.variant === 'forward' ? snippet.forwardSlash : snippet.escaped;
  }
  await vscode.env.clipboard.writeText(toCopy);
  const configPath = deps.mcp.getConfigPath(client);
  const action = configPath
    ? await vscode.window.showInformationMessage(
        `Copied ${aiClientDisplayName(client)} snippet. Paste it into ${configPath}.`,
        'Open Config File',
      )
    : await vscode.window.showInformationMessage(
        `Copied ${aiClientDisplayName(client)} snippet. Paste it into your client's MCP config.`,
      );
  if (action === 'Open Config File' && configPath) {
    await openConfigFileFor(client, configPath);
  }
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
      `${aiClientDisplayName(client)} doesn't have a fixed MCP config path — paste the snippet into the client's MCP settings UI.`,
    );
    return;
  }
  await openConfigFileFor(client, configPath);
}

async function openConfigFileFor(client: AiClient, configPath: string): Promise<void> {
  if (!fs.existsSync(configPath)) {
    const create = await vscode.window.showWarningMessage(
      `${aiClientDisplayName(client)}'s config file doesn't exist at ${configPath}. Create an empty one?`,
      'Create',
      'Cancel',
    );
    if (create !== 'Create') return;
    // Seed with an empty mcpServers object so the user's paste-after-open
    // gesture lands somewhere coherent. P5R1-G2: use `path.dirname` for
    // cross-platform-correct separator handling instead of a brittle
    // includes('/') probe + lastIndexOf split (would break on a
    // workspace path that mixes separators on Windows).
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, '{\n  "mcpServers": {}\n}\n');
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Failed to create ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(configPath));
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
      `APICircle MCP binary: ${binary} (${tools.length} tools). No active workspace — open a folder with .apicircle/workspace.json to use it.`,
    );
    return;
  }
  await vscode.window.showInformationMessage(
    `APICircle MCP binary: ${binary} · workspace: ${workspace} · ${tools.length} tools exposed.`,
  );
}
