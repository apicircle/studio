import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { window, env, commands } from '../../test/mocks/vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { VsCodeMcpManager } from '../host/mcpManager';
import {
  copyMcpConfigCommand,
  openMcpConfigFileCommand,
  openMcpConnectGuideCommand,
  revealMcpBinaryInfoCommand,
} from './mcpActions';

function makeFakeBridge(active: { id: string; apicircleDir: string } | null): VsCodeBridge {
  return {
    activeWorkspace: () => (active ? { workspace: active } : null),
  } as unknown as VsCodeBridge;
}

function makeMcp(
  active: { id: string; apicircleDir: string } | null,
  binary = 'apicircle-mcp',
): VsCodeMcpManager {
  return new VsCodeMcpManager({
    bridge: makeFakeBridge(active),
    getBinaryPath: () => binary,
    configPathEnv: () => ({ homedir: '/home/me', platform: 'linux' }),
  });
}

describe('mcpActions', () => {
  beforeEach(() => {
    (window.showQuickPick as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
    (env.clipboard.writeText as Mock).mockReset();
    (env.openExternal as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
  });

  describe('copyMcpConfigCommand', () => {
    it('with a client node, writes the snippet to the clipboard', async () => {
      const mcp = makeMcp({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await copyMcpConfigCommand({ mcp }, { kind: 'client', client: 'cursor' });
      expect(env.clipboard.writeText).toHaveBeenCalledTimes(1);
      const written = (env.clipboard.writeText as Mock).mock.calls[0][0] as string;
      expect(JSON.parse(written).mcpServers.apicircle.command).toBe('apicircle-mcp');
    });

    it('without a node, prompts via QuickPick + copies the chosen client snippet', async () => {
      const mcp = makeMcp({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ client: 'continue' });
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await copyMcpConfigCommand({ mcp });
      expect(env.clipboard.writeText).toHaveBeenCalled();
    });

    it('cancelled QuickPick (no client chosen) is a no-op', async () => {
      const mcp = makeMcp({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await copyMcpConfigCommand({ mcp });
      expect(env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('no active workspace surfaces a "no workspace" warning + no copy', async () => {
      const mcp = makeMcp(null);
      await copyMcpConfigCommand({ mcp }, { kind: 'client', client: 'cursor' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringMatching(/No active APICircle workspace/i),
      );
      expect(env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('Windows path: prompts the user to pick forward-slash vs escaped', async () => {
      const mcp = makeMcp({ id: 'C:\\repo', apicircleDir: 'C:\\repo\\.apicircle' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ variant: 'forward' });
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await copyMcpConfigCommand({ mcp }, { kind: 'client', client: 'claude-desktop' });
      expect(window.showQuickPick).toHaveBeenCalled();
      const written = (env.clipboard.writeText as Mock).mock.calls[0][0] as string;
      expect(written).toContain('C:/repo/.apicircle');
    });

    it('Windows path: user picks escaped variant → writes the backslash form', async () => {
      const mcp = makeMcp({ id: 'C:\\repo', apicircleDir: 'C:\\repo\\.apicircle' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ variant: 'escaped' });
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await copyMcpConfigCommand({ mcp }, { kind: 'client', client: 'claude-desktop' });
      const written = (env.clipboard.writeText as Mock).mock.calls[0][0] as string;
      expect(written).toContain('\\\\');
    });

    it('Windows path: user cancels variant picker → no copy', async () => {
      const mcp = makeMcp({ id: 'C:\\repo', apicircleDir: 'C:\\repo\\.apicircle' });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await copyMcpConfigCommand({ mcp }, { kind: 'client', client: 'claude-desktop' });
      expect(env.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('openMcpConfigFileCommand', () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-'));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('client without a known path surfaces the "paste manually" info', async () => {
      const mcp = makeMcp(null);
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'generic' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringMatching(/doesn't have a fixed MCP config path/),
      );
    });

    it('config file does not exist: prompts to Create; Cancel → no-op', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Cancel');
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Create an empty one/i),
        'Create',
        'Cancel',
      );
      expect(commands.executeCommand).not.toHaveBeenCalledWith('vscode.open', expect.anything());
    });

    it('config file does not exist: Create → seeds the file + opens it', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Create');
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      const cursorPath = path.join(tmp, '.cursor/mcp.json');
      expect(fs.existsSync(cursorPath)).toBe(true);
      const content = fs.readFileSync(cursorPath, 'utf8');
      expect(JSON.parse(content)).toEqual({ mcpServers: {} });
      expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
    });

    it('config file exists: opens it directly without warning', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.cursor/mcp.json'), '{}');
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
      // No "Create" prompt fired.
      expect(window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('no node → prompts via QuickPick first', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ client: 'cursor' });
      fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.cursor/mcp.json'), '{}');
      await openMcpConfigFileCommand({ mcp });
      expect(window.showQuickPick).toHaveBeenCalled();
    });
  });

  describe('openMcpConnectGuideCommand', () => {
    it('opens the docs URL in the external browser', async () => {
      await openMcpConnectGuideCommand();
      expect(env.openExternal).toHaveBeenCalledTimes(1);
      const uri = (env.openExternal as Mock).mock.calls[0][0];
      const asString = typeof uri.toString === 'function' ? uri.toString() : '';
      expect(asString).toContain('connect-your-ai-client.md');
    });
  });

  describe('revealMcpBinaryInfoCommand', () => {
    it('with active workspace: shows binary + workspace + tool count', async () => {
      const mcp = makeMcp({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      await revealMcpBinaryInfoCommand({ mcp });
      const msg = (window.showInformationMessage as Mock).mock.calls[0][0] as string;
      expect(msg).toContain('apicircle-mcp');
      expect(msg).toContain('/ws/.apicircle');
      expect(msg).toMatch(/\d+ tools/);
    });

    it('without active workspace: surfaces "no active workspace" + tool count', async () => {
      const mcp = makeMcp(null);
      await revealMcpBinaryInfoCommand({ mcp });
      const msg = (window.showInformationMessage as Mock).mock.calls[0][0] as string;
      expect(msg).toContain('No active workspace');
      expect(msg).toMatch(/\d+ tools/);
    });
  });
});
