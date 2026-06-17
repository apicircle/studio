import { describe, expect, it } from 'vitest';
import type { VsCodeBridge } from './vscodeBridge';
import { VsCodeMcpManager, aiClientDisplayName } from './mcpManager';
import { AI_CLIENTS } from '@apicircle/mcp-server';

function makeFakeBridge(
  active: { id: string; apicircleDir: string; source?: 'git-folder' | 'registry' } | null,
): VsCodeBridge {
  return {
    activeWorkspace: () =>
      active ? { workspace: { ...active, source: active.source ?? 'git-folder' } } : null,
  } as unknown as VsCodeBridge;
}

describe('VsCodeMcpManager', () => {
  it('resolvePaths reports the active workspace + binary path', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
      getBinaryPath: () => 'apicircle-mcp',
    });
    expect(m.resolvePaths()).toEqual({
      binary: 'apicircle-mcp',
      workspace: '/ws/.apicircle',
      hasActiveWorkspace: true,
      isRegistryWorkspace: false,
    });
  });

  it('resolvePaths reports no active workspace when none registered', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge(null),
      getBinaryPath: () => 'apicircle-mcp',
    });
    expect(m.resolvePaths()).toEqual({
      binary: 'apicircle-mcp',
      workspace: '',
      hasActiveWorkspace: false,
      isRegistryWorkspace: false,
    });
  });

  it('honors the apicircle.mcp.binaryPath override', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
      getBinaryPath: () => '/usr/local/bin/apicircle-mcp',
    });
    expect(m.resolvePaths().binary).toBe('/usr/local/bin/apicircle-mcp');
  });

  // P5R1-G6: empty / whitespace-only binary path coerces back to the
  // default so snippets are never emitted with `"command": ""`.

  it('coerces an empty binaryPath setting back to "apicircle-mcp"', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
      getBinaryPath: () => '',
    });
    expect(m.resolvePaths().binary).toBe('apicircle-mcp');
  });

  it('coerces a whitespace-only binaryPath setting back to "apicircle-mcp"', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
      getBinaryPath: () => '   \t  ',
    });
    expect(m.resolvePaths().binary).toBe('apicircle-mcp');
  });

  it('trims leading/trailing whitespace from a non-empty binaryPath', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
      getBinaryPath: () => '  /usr/local/bin/apicircle-mcp  ',
    });
    expect(m.resolvePaths().binary).toBe('/usr/local/bin/apicircle-mcp');
  });

  it('resolvePaths returns ~/.apicircle/ root for registry workspaces', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({
        id: 'ws-123',
        apicircleDir: '/home/user/.apicircle/workspaces/ws-123',
        source: 'registry',
      }),
      getBinaryPath: () => 'apicircle-mcp',
    });
    const paths = m.resolvePaths();
    expect(paths.hasActiveWorkspace).toBe(true);
    expect(paths.isRegistryWorkspace).toBe(true);
    // Registry workspaces point at the apicircle root, not the per-workspace dir
    expect(paths.workspace).not.toContain('workspaces/ws-123');
  });

  it('toolCatalog returns the canonical 79-tool list from @apicircle/shared', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge(null),
      getBinaryPath: () => 'apicircle-mcp',
    });
    const tools = m.toolCatalog();
    expect(tools.length).toBeGreaterThan(30);
    expect(tools).toContain('request.create');
    expect(tools).toContain('mock.start');
  });

  it('supportedClients returns the AI_CLIENTS list from mcp-server', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge(null),
      getBinaryPath: () => 'apicircle-mcp',
    });
    expect(m.supportedClients()).toEqual(AI_CLIENTS);
    expect(m.supportedClients().length).toBe(11);
  });

  it('getConfigSnippet produces a parseable JSON snippet pointing at the active workspace', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
      getBinaryPath: () => 'apicircle-mcp',
    });
    const v = m.getConfigSnippet('claude-desktop');
    expect(v).not.toBeNull();
    const parsed = JSON.parse(v!.forwardSlash);
    expect(parsed.mcpServers.apicircle.command).toBe('apicircle-mcp');
    expect(parsed.mcpServers.apicircle.args).toEqual(['--workspace', '/ws/.apicircle']);
    expect(parsed.mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe('/ws/.apicircle');
  });

  it('getConfigSnippet returns null when no workspace is active', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge(null),
      getBinaryPath: () => 'apicircle-mcp',
    });
    expect(m.getConfigSnippet('claude-desktop')).toBeNull();
  });

  it('getConfigSnippet produces a working snippet for every supported client', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: '/ws', apicircleDir: '/ws/.apicircle' }),
      getBinaryPath: () => 'apicircle-mcp',
    });
    for (const client of AI_CLIENTS) {
      const v = m.getConfigSnippet(client);
      expect(v).not.toBeNull();
      if (client === 'codex') {
        // Codex uses TOML — validate structure instead of JSON.parse
        expect(v!.forwardSlash).toContain('[mcp_servers.apicircle]');
        expect(v!.forwardSlash).toContain('command = "apicircle-mcp"');
      } else {
        expect(() => JSON.parse(v!.forwardSlash)).not.toThrow();
      }
    }
  });

  it('Windows path produces divergent forwardSlash + escaped variants', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge({ id: 'C:\\repo', apicircleDir: 'C:\\repo\\.apicircle' }),
      getBinaryPath: () => 'apicircle-mcp',
    });
    const v = m.getConfigSnippet('claude-desktop');
    expect(v).not.toBeNull();
    expect(v!.identical).toBe(false);
    expect(v!.escaped).toContain('\\\\');
    expect(v!.forwardSlash).not.toContain('\\\\');
  });

  it('getConfigPath returns a path for clients with a fixed location', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge(null),
      getBinaryPath: () => 'apicircle-mcp',
      configPathEnv: () => ({ homedir: '/home/me', platform: 'linux' }),
    });
    expect(m.getConfigPath('claude-desktop')).toMatch(/claude_desktop_config\.json/);
    expect(m.getConfigPath('cursor')).toMatch(/mcp\.json/);
  });

  it('getConfigPath returns null for clients without a fixed location', () => {
    const m = new VsCodeMcpManager({
      bridge: makeFakeBridge(null),
      getBinaryPath: () => 'apicircle-mcp',
      configPathEnv: () => ({ homedir: '/home/me', platform: 'linux' }),
    });
    expect(m.getConfigPath('generic')).toBeNull();
    expect(m.getConfigPath('chatgpt')).toBeNull();
  });
});

describe('aiClientDisplayName', () => {
  it('returns a non-empty display label for every AI client', () => {
    for (const c of AI_CLIENTS) {
      const label = aiClientDisplayName(c);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('uses human-friendly capitalisation', () => {
    expect(aiClientDisplayName('claude-desktop')).toBe('Claude Desktop');
    expect(aiClientDisplayName('github-copilot')).toBe('GitHub Copilot');
    expect(aiClientDisplayName('generic')).toContain('Generic');
  });
});
