import { describe, expect, it, vi } from 'vitest';

// Stub the bits of `electron` we touch in mcpManager. The manager only
// uses `app.getPath`, so a single fake is enough.
vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return '/fake/user-data';
      throw new Error(`unknown getPath ${key}`);
    },
  },
}));

import { McpManager } from './mcpManager';

describe('McpManager', () => {
  it('defaults workspaceDir to <userData>/workspaces (multi-workspace root)', () => {
    const m = new McpManager();
    expect(m.workspaceDir.endsWith('workspaces')).toBe(true);
  });

  it('honors an explicit workspaceDir', () => {
    const m = new McpManager('/explicit/dir');
    expect(m.workspaceDir).toBe('/explicit/dir');
  });

  it('produces a Claude Desktop snippet wrapped in mcpServers', () => {
    const m = new McpManager('/ws');
    const snippet = m.getConfigSnippet('claude-desktop');
    const parsed = JSON.parse(snippet);
    expect(parsed.mcpServers.apicircle.command).toBe('apicircle-mcp');
    expect(parsed.mcpServers.apicircle.args).toEqual(['--workspace', '/ws']);
    expect(parsed.mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe('/ws');
  });

  it('produces a snippet for every supported client', () => {
    const m = new McpManager('/ws');
    const clients = [
      'claude-desktop',
      'claude-code',
      'cursor',
      'continue',
      'cline',
      'zed',
      'windsurf',
      'github-copilot',
      'chatgpt',
      'generic',
    ] as const;
    for (const client of clients) {
      const snippet = m.getConfigSnippet(client);
      expect(JSON.parse(snippet).mcpServers.apicircle.command).toBe('apicircle-mcp');
    }
  });

  it('returns a config path for known clients on the current platform', () => {
    const m = new McpManager('/ws');
    expect(m.getConfigPath('claude-desktop')).not.toBeNull();
    expect(m.getConfigPath('cursor')).not.toBeNull();
    expect(m.getConfigPath('continue')).not.toBeNull();
    expect(m.getConfigPath('zed')).not.toBeNull();
  });

  it('returns null for clients without a default config path', () => {
    const m = new McpManager('/ws');
    expect(m.getConfigPath('generic')).toBeNull();
    expect(m.getConfigPath('chatgpt')).toBeNull();
  });

  it('exposes the full tool catalog from @apicircle/shared', () => {
    const m = new McpManager('/ws');
    const tools = m.toolCatalog();
    expect(tools).toContain('request.create');
    expect(tools).toContain('mock.start');
    expect(tools.length).toBeGreaterThan(30);
  });
});
