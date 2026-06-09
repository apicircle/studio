import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { VsCodeMcpManager } from '../host/mcpManager';
import { installCopilotMcpConfigCommand } from './copilotMcpActions';

function makeFakeBridge(active: { id: string; apicircleDir: string } | null): VsCodeBridge {
  return {
    activeWorkspace: () => (active ? { workspace: active } : null),
  } as unknown as VsCodeBridge;
}

function makeMcp(active: { id: string; apicircleDir: string } | null): VsCodeMcpManager {
  return new VsCodeMcpManager({
    bridge: makeFakeBridge(active),
    getBinaryPath: () => 'apicircle-mcp',
    configPathEnv: () => ({ homedir: '/home/me', platform: 'linux' }),
  });
}

describe('installCopilotMcpConfigCommand', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-cmd-'));
    (window.showInformationMessage as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function setSingleFolder(folderPath: string): void {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folderPath), name: path.basename(folderPath), index: 0 },
    ];
  }

  function clearFolders(): void {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
  }

  it('with no active workspace, surfaces a warning + no file written', async () => {
    clearFolders();
    const mcp = makeMcp(null);
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/No active APICircle workspace/i),
    );
    expect(fs.existsSync(path.join(tmp, '.vscode/mcp.json'))).toBe(false);
  });

  it('with a folder + active workspace, writes the entry + surfaces "Installed" toast', async () => {
    setSingleFolder(tmp);
    const apicircleDir = path.join(tmp, '.apicircle');
    const mcp = makeMcp({ id: tmp, apicircleDir });
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    const cfgPath = path.join(tmp, '.vscode/mcp.json');
    expect(fs.existsSync(cfgPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
      mcpServers: { apicircle: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.apicircle.command).toBe('apicircle-mcp');
    expect(parsed.mcpServers.apicircle.args[1]).toBe(apicircleDir.replace(/\\/g, '/'));
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Installed APICircle MCP/i),
    );
  });

  it('a second invocation with unchanged paths surfaces the "already up to date" toast', async () => {
    setSingleFolder(tmp);
    const apicircleDir = path.join(tmp, '.apicircle');
    const mcp = makeMcp({ id: tmp, apicircleDir });
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    (window.showInformationMessage as Mock).mockReset();
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/already up to date/i),
    );
  });

  it('honours apicircle.mcp.workspaceConfigPath override', async () => {
    setSingleFolder(tmp);
    const apicircleDir = path.join(tmp, '.apicircle');
    const mcp = makeMcp({ id: tmp, apicircleDir });
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => 'custom/mcp.json',
    });
    expect(fs.existsSync(path.join(tmp, 'custom/mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.vscode/mcp.json'))).toBe(false);
  });

  it('picks the right folder when multiple workspace folders are open', async () => {
    const folder1 = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-f1-'));
    const folder2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-f2-'));
    try {
      (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [
        { uri: Uri.file(folder1), name: 'f1', index: 0 },
        { uri: Uri.file(folder2), name: 'f2', index: 1 },
      ];
      // Active workspace's apicircleDir is in folder2 — install should
      // write into folder2's .vscode/mcp.json.
      const apicircleDir = path.join(folder2, '.apicircle');
      const mcp = makeMcp({ id: folder2, apicircleDir });
      await installCopilotMcpConfigCommand({
        mcp,
        getRelativeConfigPath: () => '.vscode/mcp.json',
      });
      expect(fs.existsSync(path.join(folder2, '.vscode/mcp.json'))).toBe(true);
      expect(fs.existsSync(path.join(folder1, '.vscode/mcp.json'))).toBe(false);
    } finally {
      fs.rmSync(folder1, { recursive: true, force: true });
      fs.rmSync(folder2, { recursive: true, force: true });
    }
  });

  // ----- P6R1-G8: onInstalled refresh hook fires on real writes only -----

  it('onInstalled fires after a "created" install', async () => {
    setSingleFolder(tmp);
    const mcp = makeMcp({ id: tmp, apicircleDir: path.join(tmp, '.apicircle') });
    let refreshCalls = 0;
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
      onInstalled: () => {
        refreshCalls++;
      },
    });
    expect(refreshCalls).toBe(1);
  });

  it('onInstalled does NOT fire when the second run is a no-op', async () => {
    setSingleFolder(tmp);
    const mcp = makeMcp({ id: tmp, apicircleDir: path.join(tmp, '.apicircle') });
    let refreshCalls = 0;
    const hook = () => {
      refreshCalls++;
    };
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
      onInstalled: hook,
    });
    expect(refreshCalls).toBe(1);
    // Second invocation with same args → outcome 'unchanged' → no refresh.
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
      onInstalled: hook,
    });
    expect(refreshCalls).toBe(1);
  });

  // ----- P6R4-G2 (SECURITY): path-traversal setting surfaces modal error -----

  it('surfaces a modal "refusing to install" error when workspaceConfigPath escapes the workspace', async () => {
    setSingleFolder(tmp);
    const mcp = makeMcp({ id: tmp, apicircleDir: path.join(tmp, '.apicircle') });
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '../../../tmp/evil.json',
    });
    // The error toast should be MODAL — this is a security concern that
    // shouldn't be dismissable by clicking past it.
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Refusing to install/i),
      expect.objectContaining({ modal: true }),
    );
    // And no .vscode/ directory should have been created.
    expect(fs.existsSync(path.join(tmp, '.vscode'))).toBe(false);
  });

  it('surfaces a modal error when workspaceConfigPath is absolute', async () => {
    setSingleFolder(tmp);
    const mcp = makeMcp({ id: tmp, apicircleDir: path.join(tmp, '.apicircle') });
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '/etc/passwd',
    });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Refusing to install/i),
      expect.objectContaining({ modal: true }),
    );
  });

  it('surfaces an error message when no folder owns the apicircleDir', async () => {
    setSingleFolder(tmp);
    const mcp = makeMcp({ id: 'orphan', apicircleDir: '/some/other/path/.apicircle' });
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Could not locate which workspace folder/i),
    );
    expect(fs.existsSync(path.join(tmp, '.vscode/mcp.json'))).toBe(false);
  });
});
