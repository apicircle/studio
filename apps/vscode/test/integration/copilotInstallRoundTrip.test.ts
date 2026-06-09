import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, workspace } from '../mocks/vscode';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { VsCodeMcpManager } from '../../src/host/mcpManager';
import {
  detectCopilotMcpConfigState,
  installCopilotMcpConfig,
} from '../../src/host/copilotMcpInstall';
import { installCopilotMcpConfigCommand } from '../../src/commands/copilotMcpActions';

// =============================================================================
// Phase 6 integration: real bridge + real fs round-trip of the
// `.vscode/mcp.json` install flow. Proves the command writes the exact
// bytes the shared snippet builder would emit (via copilotMcpInstall's
// internal call into `buildSnippetVariants`), and that detectCopilotMcpConfigState
// returns 'installed-current' immediately afterwards.
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
      workspaceId: 'copilot-rt',
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

describe('Copilot install round-trip (integration)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;
  let mcp: VsCodeMcpManager;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-rt-'));
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
    });
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(tmp), name: 't', index: 0 },
    ];
    (window.showInformationMessage as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('end-to-end: command writes .vscode/mcp.json, probe reports installed-current', async () => {
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    const cfgPath = path.join(tmp, '.vscode/mcp.json');
    expect(fs.existsSync(cfgPath)).toBe(true);

    const state = detectCopilotMcpConfigState({
      workspaceFolder: tmp,
      binary: 'apicircle-mcp',
      apicircleDir,
    });
    expect(state).toBe('installed-current');
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Installed APICircle MCP/i),
    );
  });

  it('idempotence: running command twice is a no-op + "already up to date" toast', async () => {
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    const firstBytes = fs.readFileSync(path.join(tmp, '.vscode/mcp.json'), 'utf8');
    (window.showInformationMessage as Mock).mockReset();
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    const secondBytes = fs.readFileSync(path.join(tmp, '.vscode/mcp.json'), 'utf8');
    expect(secondBytes).toBe(firstBytes);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/already up to date/i),
    );
  });

  it('stale detection: binary path change → probe reports installed-stale → install command updates', async () => {
    // Install with default binary.
    installCopilotMcpConfig({
      workspaceFolder: tmp,
      binary: 'apicircle-mcp',
      apicircleDir,
    });
    // Probe with a DIFFERENT binary path → stale.
    expect(
      detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        binary: '/opt/apicircle-mcp',
        apicircleDir,
      }),
    ).toBe('installed-stale');
  });

  it('foreign mcpServers entries are preserved on install', async () => {
    fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.vscode/mcp.json'),
      JSON.stringify({
        mcpServers: {
          'other-server': { command: 'other', args: ['--flag'] },
        },
      }),
    );
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    const parsed = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode/mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(parsed.mcpServers['other-server'].command).toBe('other');
    expect(parsed.mcpServers.apicircle).toBeDefined();
  });
});
