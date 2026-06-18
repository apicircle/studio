import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, env, commands } from '../mocks/vscode';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { VsCodeMcpManager } from '../../src/host/mcpManager';
import {
  openMcpConfigFileCommand,
  revealMcpBinaryInfoCommand,
} from '../../src/commands/mcpActions';
import { buildSnippetVariants } from '@apicircle/mcp-server';

// =============================================================================
// P5 integration round-trip: open command pre-populates the config file with
// the exact snippet the shared `buildSnippetVariants` produces; file paths
// match the conventional per-OS locations. End-to-end through VsCodeBridge +
// VsCodeMcpManager.
// =============================================================================

function makeMockContext(globalStoragePath: string) {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T) =>
        state.has(key) ? (state.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => Array.from(state.keys()),
    },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    globalStorageUri: Uri.file(globalStoragePath),
    storageUri: undefined,
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext',
    asAbsolutePath: (rel: string) => path.join('/ext', rel),
    extensionMode: 3,
  } as never;
}

function seedEmpty(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'mcp-rt',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('MCP commands round-trip (integration)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;
  let mcp: VsCodeMcpManager;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-rt-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seedEmpty(apicircleDir);
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
      source: 'git-folder',
    });
    bridge.setActive(apicircleDir);
    mcp = new VsCodeMcpManager({
      bridge,
      getBinaryPath: () => 'apicircle-mcp',
      configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
    });
    (window.showInformationMessage as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showQuickPick as Mock).mockReset();
    (env.clipboard.writeText as Mock).mockReset();
    (env.openExternal as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('openMcpConfigFile (Create branch) pre-populates with snippet from shared builder', async () => {
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Create');
    (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
    await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
    const cursorPath = path.join(tmp, '.cursor/mcp.json');
    expect(fs.existsSync(cursorPath)).toBe(true);
    const content = fs.readFileSync(cursorPath, 'utf8').trim();
    const expected = buildSnippetVariants('cursor', 'apicircle-mcp', apicircleDir);
    expect(content).toBe(expected.forwardSlash);
    expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
  });

  it('revealMcpBinaryInfo names the active workspace in its info message', () => {
    revealMcpBinaryInfoCommand({ mcp });
    const msg = (window.showInformationMessage as Mock).mock.calls[0][0] as string;
    expect(msg).toContain(apicircleDir);
    expect(msg).toContain('apicircle-mcp');
  });

  it('snippet bytes from VS Code manager === bytes from shared builder for the same tuple', async () => {
    for (const client of mcp.supportedClients()) {
      const fromVscode = mcp.getConfigSnippet(client);
      const fromShared = buildSnippetVariants(client, 'apicircle-mcp', apicircleDir);
      expect(fromVscode).not.toBeNull();
      expect(fromVscode!.forwardSlash).toBe(fromShared.forwardSlash);
      expect(fromVscode!.escaped).toBe(fromShared.escaped);
      expect(fromVscode!.identical).toBe(fromShared.identical);
    }
  });
});
