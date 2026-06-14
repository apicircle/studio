import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { VsCodeMcpManager } from '../host/mcpManager';
import {
  installCopilotMcpConfigCommand,
  uninstallCopilotMcpConfigCommand,
  pickOwningFolder,
} from './copilotMcpActions';

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
      expect.stringMatching(/No active API Circle workspace/i),
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
      expect.stringMatching(/Installed API Circle MCP/i),
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

describe('uninstallCopilotMcpConfigCommand', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-uninst-'));
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

  it('warns when no active workspace', async () => {
    (workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
    const mcp = makeMcp(null);
    await uninstallCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/No active API Circle workspace/i),
    );
  });

  it('aborts when the confirmation modal is dismissed', async () => {
    setSingleFolder(tmp);
    const apicircleDir = path.join(tmp, '.apicircle');
    const mcp = makeMcp({ id: tmp, apicircleDir });
    // Pre-install so there's something to remove.
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await uninstallCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    // File should still exist with the entry.
    const parsed = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode/mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.apicircle).toBeDefined();
  });

  it('removes the entry on confirm and fires onInstalled', async () => {
    setSingleFolder(tmp);
    const apicircleDir = path.join(tmp, '.apicircle');
    const mcp = makeMcp({ id: tmp, apicircleDir });
    await installCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Remove');
    let refreshes = 0;
    await uninstallCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
      onInstalled: () => {
        refreshes++;
      },
    });
    expect(refreshes).toBe(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Removed API Circle MCP/i),
    );
  });

  it('reports nothing-to-remove when no entry exists', async () => {
    setSingleFolder(tmp);
    const apicircleDir = path.join(tmp, '.apicircle');
    fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.vscode/mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
    );
    const mcp = makeMcp({ id: tmp, apicircleDir });
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Remove');
    await uninstallCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/nothing to remove/i),
    );
  });

  it('surfaces a modal "Refusing to remove" on path-traversal config path', async () => {
    setSingleFolder(tmp);
    const mcp = makeMcp({ id: tmp, apicircleDir: path.join(tmp, '.apicircle') });
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Remove');
    await uninstallCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '../../../tmp/evil.json',
    });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Refusing to remove/i),
      expect.objectContaining({ modal: true }),
    );
  });

  it('errors when no folder owns the apicircleDir', async () => {
    setSingleFolder(tmp);
    const mcp = makeMcp({ id: 'orphan', apicircleDir: '/some/other/path/.apicircle' });
    await uninstallCopilotMcpConfigCommand({
      mcp,
      getRelativeConfigPath: () => '.vscode/mcp.json',
    });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Could not locate which workspace folder/i),
    );
  });
});

describe('pickOwningFolder', () => {
  it('returns the longest-prefix match for a nested apicircleDir', () => {
    const folders = [
      { uri: Uri.file('/a'), name: 'a', index: 0 },
      { uri: Uri.file('/a/sub'), name: 'sub', index: 1 },
    ] as never;
    const result = pickOwningFolder(folders, '/a/sub/.apicircle');
    expect(result?.name).toBe('sub');
  });

  it('is case-insensitive and forward-slash tolerant', () => {
    const folders = [{ uri: Uri.file('C:\\Repo'), name: 'r', index: 0 }] as never;
    const result = pickOwningFolder(folders, 'c:/repo/.apicircle');
    expect(result?.name).toBe('r');
  });

  it('returns undefined when no folder is a prefix', () => {
    const folders = [{ uri: Uri.file('/x'), name: 'x', index: 0 }] as never;
    expect(pickOwningFolder(folders, '/y/.apicircle')).toBeUndefined();
  });
});
