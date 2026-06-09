import { describe, expect, it } from 'vitest';
import { McpView } from './McpView';
import { VsCodeMcpManager } from '../host/mcpManager';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { AI_CLIENTS } from '@apicircle/mcp-server';

function makeFakeBridge(active: { id: string; apicircleDir: string } | null): VsCodeBridge {
  return {
    activeWorkspace: () => (active ? { workspace: active } : null),
  } as unknown as VsCodeBridge;
}

function makeView(active: { id: string; apicircleDir: string } | null = null): McpView {
  const mcp = new VsCodeMcpManager({
    bridge: makeFakeBridge(active),
    getBinaryPath: () => 'apicircle-mcp',
    configPathEnv: () => ({ homedir: '/home/me', platform: 'linux' }),
  });
  return new McpView(mcp);
}

describe('McpView', () => {
  describe('getChildren', () => {
    it('returns the three top-level rows in order', () => {
      const view = makeView();
      const children = view.getChildren();
      expect(children).toEqual([
        { kind: 'header' },
        { kind: 'clients-section' },
        { kind: 'connect-guide' },
      ]);
    });

    it('clients-section expands to one row per AI client', () => {
      const view = makeView();
      const children = view.getChildren({ kind: 'clients-section' });
      expect(children.length).toBe(AI_CLIENTS.length);
      for (const child of children) {
        expect(child.kind).toBe('client');
      }
    });

    it('leaf nodes return no children', () => {
      const view = makeView();
      expect(view.getChildren({ kind: 'header' })).toEqual([]);
      expect(view.getChildren({ kind: 'connect-guide' })).toEqual([]);
      expect(view.getChildren({ kind: 'client', client: 'claude-desktop' })).toEqual([]);
    });
  });

  describe('getTreeItem', () => {
    it('header (active workspace) shows tool count + binary + workspace tooltip', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'header' });
      expect(item.label).toBe('MCP Server');
      expect(item.description).toContain('tools');
      expect(item.description).toContain('apicircle-mcp');
      expect(item.contextValue).toBe('mcp-header-active');
      // P5R2-G13: header click fires the binary-info toast.
      expect(item.command?.command).toBe('apicircle.revealMcpBinaryInfo');
    });

    it('header (no active workspace) shows the idle state', () => {
      const view = makeView(null);
      const item = view.getTreeItem({ kind: 'header' });
      expect(item.description).toContain('no active workspace');
      expect(item.contextValue).toBe('mcp-header-idle');
    });

    it('clients-section is expanded by default', () => {
      const view = makeView();
      const item = view.getTreeItem({ kind: 'clients-section' });
      expect(item.label).toBe('Connect an AI client');
      expect(item.contextValue).toBe('mcp-clients-section');
    });

    it('client with known config path is tagged "mcp-client-with-path"', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'claude-desktop' });
      expect(item.contextValue).toBe('mcp-client-with-path');
      expect(item.description).toContain('detected');
    });

    it('client without known config path is tagged "mcp-client-manual"', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'generic' });
      expect(item.contextValue).toBe('mcp-client-manual');
      expect(item.description).toContain('manually');
    });

    it('client row click-command fires apicircle.copyMcpConfig with the right arg', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'cursor' });
      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('apicircle.copyMcpConfig');
      expect(item.command!.arguments).toEqual([{ kind: 'client', client: 'cursor' }]);
    });

    it('connect-guide row fires apicircle.openMcpConnectGuide on click', () => {
      const view = makeView();
      const item = view.getTreeItem({ kind: 'connect-guide' });
      expect(item.command!.command).toBe('apicircle.openMcpConnectGuide');
      expect(item.contextValue).toBe('mcp-connect-guide');
    });

    it('every supported client renders without throwing', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      for (const client of AI_CLIENTS) {
        const item = view.getTreeItem({ kind: 'client', client });
        expect(item.label).toBeDefined();
      }
    });

    // ----- P6: github-copilot row install-state specialisation -----

    function makeViewWithCopilotProbe(
      state: 'absent' | 'installed-current' | 'installed-stale',
    ): McpView {
      const mcp = new VsCodeMcpManager({
        bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
        getBinaryPath: () => 'apicircle-mcp',
        configPathEnv: () => ({ homedir: '/home/me', platform: 'linux' }),
      });
      return new McpView(mcp, () => state);
    }

    it('github-copilot row (absent): "click to install" + apicircle.installCopilotMcpConfig command', () => {
      const view = makeViewWithCopilotProbe('absent');
      const item = view.getTreeItem({ kind: 'client', client: 'github-copilot' });
      expect(item.description).toMatch(/click to install/i);
      expect(item.contextValue).toBe('mcp-client-copilot-absent');
      expect(item.command?.command).toBe('apicircle.installCopilotMcpConfig');
    });

    it('github-copilot row (installed-current): "✓ installed" + copy command fallback', () => {
      const view = makeViewWithCopilotProbe('installed-current');
      const item = view.getTreeItem({ kind: 'client', client: 'github-copilot' });
      expect(item.description).toMatch(/installed/i);
      expect(item.contextValue).toBe('mcp-client-copilot-installed');
      // Click on an already-installed row copies snippet for other surfaces.
      expect(item.command?.command).toBe('apicircle.copyMcpConfig');
    });

    it('github-copilot row (installed-stale): "out of date" + install command (re-runs to update)', () => {
      const view = makeViewWithCopilotProbe('installed-stale');
      const item = view.getTreeItem({ kind: 'client', client: 'github-copilot' });
      expect(item.description).toMatch(/out of date/i);
      expect(item.contextValue).toBe('mcp-client-copilot-stale');
      expect(item.command?.command).toBe('apicircle.installCopilotMcpConfig');
    });

    it('without a probe, github-copilot falls back to the generic "paste manually" rendering', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'github-copilot' });
      // No probe → no specialised contextValue.
      expect(item.contextValue).toBe('mcp-client-manual');
    });
  });
});
