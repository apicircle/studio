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
    const { forwardSlash, escaped, identical } = m.getConfigSnippet('claude-desktop');
    // POSIX path → both variants are byte-identical.
    expect(identical).toBe(true);
    expect(forwardSlash).toBe(escaped);
    const parsed = JSON.parse(forwardSlash);
    expect(parsed.mcpServers.apicircle.command).toBe('apicircle-mcp');
    expect(parsed.mcpServers.apicircle.args).toEqual(['--workspace', '/ws']);
    expect(parsed.mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe('/ws');
  });

  it('emits forward-slash and escaped variants for a Windows path', () => {
    const m = new McpManager('C:\\Users\\me\\workspaces');
    const { forwardSlash, escaped, identical } = m.getConfigSnippet('claude-desktop');
    expect(identical).toBe(false);
    // Forward-slash form is valid JSON and contains the cleaned path.
    expect(JSON.parse(forwardSlash).mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe(
      'C:/Users/me/workspaces',
    );
    // Escaped form is also valid JSON; JSON.parse decodes the `\\` escapes
    // back to literal backslashes.
    expect(JSON.parse(escaped).mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe(
      'C:\\Users\\me\\workspaces',
    );
    // Raw text differs in escape form: escaped has `\\`, forward-slash has `/`.
    expect(escaped).toContain('\\\\');
    expect(forwardSlash).not.toContain('\\\\');
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
      const { forwardSlash } = m.getConfigSnippet(client);
      expect(JSON.parse(forwardSlash).mcpServers.apicircle.command).toBe('apicircle-mcp');
    }
  });

  it('returns a config path for known clients on the current platform', () => {
    const m = new McpManager('/ws');
    expect(m.getConfigPath('claude-desktop')).not.toBeNull();
    expect(m.getConfigPath('claude-code')).not.toBeNull(); // P5R1-G11
    expect(m.getConfigPath('cursor')).not.toBeNull();
    expect(m.getConfigPath('continue')).not.toBeNull();
    expect(m.getConfigPath('zed')).not.toBeNull();
    expect(m.getConfigPath('windsurf')).not.toBeNull(); // P5R1-G11
  });

  it('returns null for clients without a default config path', () => {
    const m = new McpManager('/ws');
    expect(m.getConfigPath('generic')).toBeNull();
    expect(m.getConfigPath('chatgpt')).toBeNull();
    // cline + github-copilot use VS Code-extension-internal settings and
    // don't have a fixed user-home path either.
    expect(m.getConfigPath('cline')).toBeNull();
    expect(m.getConfigPath('github-copilot')).toBeNull();
  });

  it('exposes the full tool catalog from @apicircle/shared', () => {
    const m = new McpManager('/ws');
    const tools = m.toolCatalog();
    expect(tools).toContain('request.create');
    expect(tools).toContain('mock.start');
    expect(tools.length).toBeGreaterThan(30);
  });
});
