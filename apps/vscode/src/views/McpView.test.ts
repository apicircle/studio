import { describe, expect, it } from 'vitest';
import { TreeItemCollapsibleState, ThemeIcon, MarkdownString } from '../../test/mocks/vscode';
import { McpView, type McpNode, type ClientInstallProbe } from './McpView';
import { VsCodeMcpManager } from '../host/mcpManager';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { AI_CLIENTS } from '@apicircle/mcp-server';
import { MCP_PROMPTS, MCP_PROMPT_CATEGORIES } from '@apicircle/mcp-server/prompts';

function makeFakeBridge(active: { id: string; apicircleDir: string } | null): VsCodeBridge {
  return {
    activeWorkspace: () => (active ? { workspace: active } : null),
  } as unknown as VsCodeBridge;
}

function makeView(
  active: { id: string; apicircleDir: string } | null = null,
  probe?: ClientInstallProbe,
): McpView {
  const mcp = new VsCodeMcpManager({
    bridge: makeFakeBridge(active),
    getBinaryPath: () => 'apicircle-mcp',
    configPathEnv: () => ({ homedir: '/home/me', platform: 'linux' }),
  });
  return new McpView(mcp, probe);
}

describe('McpView', () => {
  describe('getChildren', () => {
    it('returns empty when no workspace is active', () => {
      const view = makeView();
      const children = view.getChildren();
      expect(children).toEqual([]);
    });

    it('returns the four top-level rows in order when workspace is active', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const children = view.getChildren();
      expect(children).toEqual([
        { kind: 'header' },
        { kind: 'clients-section' },
        { kind: 'prompts-section' },
        { kind: 'connect-guide' },
      ]);
    });

    it('clients-section expands to one row per AI client', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const children = view.getChildren({ kind: 'clients-section' });
      expect(children.length).toBe(AI_CLIENTS.length);
      for (const child of children) {
        expect(child.kind).toBe('client');
      }
    });

    it('leaf nodes return no children', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
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

    it('client with known config path (absent) fires openMcpConfigFile', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' }, () => 'absent');
      const item = view.getTreeItem({ kind: 'client', client: 'claude-desktop' });
      expect(item.contextValue).toBe('mcp-client-absent');
      expect(item.description).toBe('not installed');
      expect(item.command?.command).toBe('apicircle.openMcpConfigFile');
      expect(item.command?.arguments).toEqual([{ kind: 'client', client: 'claude-desktop' }]);
    });

    it('client with known config path (installed) shows installed state', () => {
      const view = makeView(
        { id: '/ws', apicircleDir: '/ws/.apicircle' },
        () => 'installed-current',
      );
      const item = view.getTreeItem({ kind: 'client', client: 'claude-desktop' });
      expect(item.contextValue).toBe('mcp-client-installed');
      expect(item.description).toBe('installed');
      expect((item.iconPath as ThemeIcon).id).toBe('check');
    });

    it('client with known config path (stale) shows update available', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' }, () => 'installed-stale');
      const item = view.getTreeItem({ kind: 'client', client: 'cursor' });
      expect(item.contextValue).toBe('mcp-client-stale');
      expect(item.description).toBe('update available');
      expect((item.iconPath as ThemeIcon).id).toBe('warning');
    });

    it('client without known config path fires openMcpConnectGuide', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'generic' });
      expect(item.contextValue).toBe('mcp-client-manual');
      expect(item.description).toBe('manual setup');
      expect(item.command?.command).toBe('apicircle.openMcpConnectGuide');
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

    // ----- Icon + collapsible state assertions -----

    it('header uses the "plug" ThemeIcon', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'header' });
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('plug');
    });

    it('header collapsibleState is None (leaf row)', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'header' });
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it('clients-section uses the "extensions" ThemeIcon and Expanded state', () => {
      const view = makeView();
      const item = view.getTreeItem({ kind: 'clients-section' });
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('extensions');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    });

    it('connect-guide uses the "link-external" ThemeIcon', () => {
      const view = makeView();
      const item = view.getTreeItem({ kind: 'connect-guide' });
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('link-external');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it('absent client uses "circle-outline" icon', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' }, () => 'absent');
      const item = view.getTreeItem({ kind: 'client', client: 'claude-desktop' });
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('circle-outline');
    });

    it('client without config path uses "symbol-key" icon', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'generic' });
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-key');
    });

    // ----- Tooltip content assertions -----

    it('header (active) tooltip contains the workspace path', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'header' });
      expect(item.tooltip).toBeInstanceOf(MarkdownString);
      expect((item.tooltip as MarkdownString).value).toContain('/ws/.apicircle');
    });

    it('header (idle) tooltip mentions .apicircle/', () => {
      const view = makeView(null);
      const item = view.getTreeItem({ kind: 'header' });
      expect(item.tooltip).toBeInstanceOf(MarkdownString);
      expect((item.tooltip as MarkdownString).value).toContain('.apicircle/');
    });

    it('client row with config path includes it in the tooltip', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'claude-desktop' });
      expect((item.tooltip as MarkdownString).value).toContain('Config:');
    });

    it('client row without config path tooltip mentions Connect Guide', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({ kind: 'client', client: 'generic' });
      expect(item.contextValue).toBe('mcp-client-manual');
      expect((item.tooltip as MarkdownString).value).toContain('Connect Guide');
    });

    // ----- all clients with known config paths use openMcpConfigFile -----

    it('all clients with known config paths fire openMcpConfigFile on click', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' }, () => 'absent');
      for (const client of AI_CLIENTS) {
        const item = view.getTreeItem({ kind: 'client', client });
        if (item.contextValue !== 'mcp-client-manual') {
          expect(item.command?.command).toBe('apicircle.openMcpConfigFile');
          expect(item.command?.arguments).toEqual([{ kind: 'client', client }]);
        }
      }
    });

    it('github-copilot (no fixed config path) gets manual contextValue', () => {
      const view = makeView(
        { id: '/ws', apicircleDir: '/ws/.apicircle' },
        () => 'installed-current',
      );
      const item = view.getTreeItem({ kind: 'client', client: 'github-copilot' });
      expect(item.contextValue).toBe('mcp-client-manual');
    });

    // ----- Prompts section -----

    it('prompts-section uses "sparkle" icon and Collapsed state', () => {
      const view = makeView();
      const item = view.getTreeItem({ kind: 'prompts-section' });
      expect(item.label).toBe('Prompts');
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('sparkle');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(item.contextValue).toBe('mcp-prompts-section');
    });

    it('prompt-category is a leaf that opens the catalog with a book icon', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const collectionsCount = MCP_PROMPTS.filter((p) => p.category === 'collections').length;
      const item = view.getTreeItem({
        kind: 'prompt-category',
        category: 'collections',
        label: 'Collections',
      });
      expect(item.label).toBe('Collections');
      expect(item.description).toBe(`${collectionsCount}`);
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('book');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(item.contextValue).toBe('mcp-prompt-category');
      expect(item.command?.command).toBe('apicircle.openMcpPromptCategory');
      expect(item.command?.arguments).toEqual([{ category: 'collections', label: 'Collections' }]);
    });

    it('prompt-category tooltip names the category and prompt count', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const item = view.getTreeItem({
        kind: 'prompt-category',
        category: 'collections',
        label: 'Collections',
      });
      expect(item.tooltip).toBeInstanceOf(MarkdownString);
      expect((item.tooltip as MarkdownString).value).toContain('Collections');
    });
  });

  describe('getChildren — prompts hierarchy', () => {
    it('prompts-section expands to one row per category', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const children = view.getChildren({ kind: 'prompts-section' });
      expect(children.length).toBe(MCP_PROMPT_CATEGORIES.length);
      for (const child of children) {
        expect(child.kind).toBe('prompt-category');
      }
    });

    it('prompt-category is a leaf — no inline children (opens the catalog instead)', () => {
      const view = makeView({ id: '/ws', apicircleDir: '/ws/.apicircle' });
      const children = view.getChildren({
        kind: 'prompt-category',
        category: 'collections',
        label: 'Collections',
      });
      expect(children).toEqual([]);
    });
  });

  // ----- viewId -----

  describe('viewId', () => {
    it('matches the package.json contribution id', () => {
      const view = makeView();
      expect(view.viewId).toBe('apicircle.mcp');
    });
  });

  // ----- refresh / refreshElement -----

  describe('refresh()', () => {
    it('fires onDidChangeTreeData so the tree re-renders', () => {
      const view = makeView();
      let fired = false;
      view.onDidChangeTreeData(() => {
        fired = true;
      });
      view.refresh();
      expect(fired).toBe(true);
    });
  });

  describe('refreshElement()', () => {
    it('fires onDidChangeTreeData with the specific element', () => {
      const view = makeView();
      let received: McpNode | undefined | void;
      view.onDidChangeTreeData((e) => {
        received = e;
      });
      const node: McpNode = { kind: 'header' };
      view.refreshElement(node);
      expect(received).toEqual(node);
    });
  });
});
