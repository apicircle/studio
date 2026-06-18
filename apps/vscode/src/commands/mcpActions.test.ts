import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { window, env, commands } from '../../test/mocks/vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { VsCodeMcpManager } from '../host/mcpManager';
import {
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

  describe('openMcpConfigFileCommand', () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-'));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('client without a known path surfaces the "refer to Connect Guide" info', async () => {
      const mcp = makeMcp(null);
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'generic' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringMatching(/doesn't have a fixed MCP config path/),
      );
    });

    it('config file does not exist: prompts to Create; Cancel is a no-op', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Cancel');
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Create it with the API Circle MCP snippet/i),
        'Create',
        'Cancel',
      );
      expect(commands.executeCommand).not.toHaveBeenCalledWith('vscode.open', expect.anything());
    });

    it('config file does not exist + active workspace: Create pre-populates with snippet', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Create');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      const cursorPath = path.join(tmp, '.cursor/mcp.json');
      expect(fs.existsSync(cursorPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
      expect(content.mcpServers.apicircle.command).toBe('apicircle-mcp');
      expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
    });

    it('config file does not exist + no active workspace: Create seeds empty mcpServers', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Create');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      const cursorPath = path.join(tmp, '.cursor/mcp.json');
      expect(fs.existsSync(cursorPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
      expect(content).toEqual({ mcpServers: {} });
    });

    it('config file exists: opens it directly without warning', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.cursor/mcp.json'), '{}');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
      expect(window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('shows guidance toast after opening the file', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.cursor/mcp.json'), '{}');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await openMcpConfigFileCommand({ mcp }, { kind: 'client', client: 'cursor' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringMatching(/restart Cursor to activate/i),
      );
    });

    it('no node prompts via QuickPick first', async () => {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge(null),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: tmp, platform: 'linux' }),
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ client: 'cursor' });
      fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.cursor/mcp.json'), '{}');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
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
    it('with active workspace: shows binary + workspace + tool count', () => {
      const mcp = makeMcp({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      revealMcpBinaryInfoCommand({ mcp });
      const msg = (window.showInformationMessage as Mock).mock.calls[0][0] as string;
      expect(msg).toContain('apicircle-mcp');
      expect(msg).toContain('/ws/.apicircle');
      expect(msg).toMatch(/\d+ tools/);
    });

    it('without active workspace: surfaces "no active workspace" + tool count', () => {
      const mcp = makeMcp(null);
      revealMcpBinaryInfoCommand({ mcp });
      const msg = (window.showInformationMessage as Mock).mock.calls[0][0] as string;
      expect(msg).toContain('No active workspace');
      expect(msg).toMatch(/\d+ tools/);
    });
  });
});
