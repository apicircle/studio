import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, env, commands } from '../mocks/vscode';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { VsCodeMcpManager } from '../../src/host/mcpManager';
import {
  copyMcpConfigCommand,
  openMcpConfigFileCommand,
  revealMcpBinaryInfoCommand,
} from '../../src/commands/mcpActions';
import { buildSnippetVariants } from '@apicircle/mcp-server';

// =============================================================================
// P5 integration round-trip: copy command writes the exact bytes the shared
// `buildSnippetVariants` produces; open command files match the conventional
// per-OS paths. End-to-end through VsCodeBridge + VsCodeMcpManager.
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

  it('copyMcpConfig writes the EXACT bytes the shared builder produces (active workspace)', async () => {
    // On Windows the snippet has divergent forward-slash vs escaped variants
    // so the command shows a QuickPick. Mock "forward" so the assertion
    // path works on both POSIX (where the picker is skipped) and Windows.
    (window.showQuickPick as Mock).mockResolvedValueOnce({ variant: 'forward' });
    (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
    await copyMcpConfigCommand({ mcp }, { kind: 'client', client: 'claude-desktop' });

    const written = (env.clipboard.writeText as Mock).mock.calls[0][0] as string;
    const expected = buildSnippetVariants('claude-desktop', 'apicircle-mcp', apicircleDir);
    expect(written).toBe(expected.forwardSlash);
    const parsed = JSON.parse(written);
    // Args use the workspace path the manager resolved — after the
    // forward-slash normalisation if the source was Windows.
    expect(parsed.mcpServers.apicircle.args[0]).toBe('--workspace');
    expect(parsed.mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe(
      parsed.mcpServers.apicircle.args[1],
    );
  });

  it('switching active workspace re-targets the snippet at the new apicircleDir', async () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-rt2-'));
    const apicircleDir2 = path.join(tmp2, '.apicircle');
    seedEmpty(apicircleDir2);
    try {
      bridge.registerWorkspace({
        id: apicircleDir2,
        apicircleDir: apicircleDir2,
        workspaceJsonPath: path.join(apicircleDir2, 'workspace.json'),
        workspaceFolder: { uri: Uri.file(tmp2), name: 't2', index: 1 } as never,
        label: 't2',
      });
      bridge.setActive(apicircleDir2);
      // Mock the (possibly-Windows) forward-slash picker.
      (window.showQuickPick as Mock).mockResolvedValueOnce({ variant: 'forward' });
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await copyMcpConfigCommand({ mcp }, { kind: 'client', client: 'cursor' });
      const written = (env.clipboard.writeText as Mock).mock.calls[0][0] as string;
      const parsed = JSON.parse(written);
      // Workspace path may be forward-slashed if source was Windows; just
      // confirm it points at apicircleDir2 modulo path-separator
      // normalisation.
      const recordedWorkspace = parsed.mcpServers.apicircle.args[1] as string;
      expect(recordedWorkspace.replace(/\\/g, '/')).toBe(apicircleDir2.replace(/\\/g, '/'));
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it('openMcpConfigFile (Create branch) creates the file under the configured homedir', async () => {
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Create');
    await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
    const cursorPath = path.join(tmp, '.cursor/mcp.json');
    expect(fs.existsSync(cursorPath)).toBe(true);
    expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
  });

  it('revealMcpBinaryInfo names the active workspace in its info message', async () => {
    await revealMcpBinaryInfoCommand({ mcp });
    const msg = (window.showInformationMessage as Mock).mock.calls[0][0] as string;
    expect(msg).toContain(apicircleDir);
    expect(msg).toContain('apicircle-mcp');
  });

  it('snippet bytes from VS Code manager === bytes from shared builder for the same tuple', async () => {
    // Three-surface invariant: the snippet VS Code produces for a given
    // (binary, workspace, client) tuple must equal the shared builder's
    // output for the same tuple. The desktop runs the same builder, so
    // this proves cross-surface parity at the unit level.
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
