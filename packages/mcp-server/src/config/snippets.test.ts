import { describe, expect, it } from 'vitest';
import {
  AI_CLIENTS,
  buildSnippetVariants,
  resolveAiClientConfigPath,
  type AiClient,
} from './snippets';

describe('buildSnippetVariants', () => {
  it('produces byte-identical variants on a POSIX path', () => {
    const v = buildSnippetVariants('claude-desktop', 'apicircle-mcp', '/ws');
    expect(v.identical).toBe(true);
    expect(v.forwardSlash).toBe(v.escaped);
    const parsed = JSON.parse(v.forwardSlash);
    expect(parsed.mcpServers.apicircle.command).toBe('apicircle-mcp');
    expect(parsed.mcpServers.apicircle.args).toEqual(['--workspace', '/ws']);
    expect(parsed.mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe('/ws');
  });

  it('emits divergent variants on a Windows path with backslashes', () => {
    const v = buildSnippetVariants('claude-desktop', 'apicircle-mcp', 'C:\\Users\\me\\workspaces');
    expect(v.identical).toBe(false);
    expect(JSON.parse(v.forwardSlash).mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe(
      'C:/Users/me/workspaces',
    );
    expect(JSON.parse(v.escaped).mcpServers.apicircle.env.APICIRCLE_WORKSPACE).toBe(
      'C:\\Users\\me\\workspaces',
    );
    expect(v.escaped).toContain('\\\\');
    expect(v.forwardSlash).not.toContain('\\\\');
  });

  it('honours a custom binary path', () => {
    const v = buildSnippetVariants('cursor', '/custom/path/apicircle-mcp', '/ws');
    const parsed = JSON.parse(v.forwardSlash);
    expect(parsed.mcpServers.apicircle.command).toBe('/custom/path/apicircle-mcp');
  });

  it('renders an mcpServers wrapper with a stable "apicircle" key', () => {
    const v = buildSnippetVariants('continue', 'apicircle-mcp', '/ws');
    expect(JSON.parse(v.forwardSlash).mcpServers.apicircle).toBeDefined();
  });

  it('produces a parseable snippet for every supported client', () => {
    for (const client of AI_CLIENTS) {
      const v = buildSnippetVariants(client, 'apicircle-mcp', '/ws');
      const parsed = JSON.parse(v.forwardSlash);
      expect(parsed.mcpServers.apicircle.command).toBe('apicircle-mcp');
    }
  });
});

describe('resolveAiClientConfigPath', () => {
  const macOs = { homedir: '/Users/me', platform: 'darwin' as const };
  const linux = { homedir: '/home/me', platform: 'linux' as const };
  const windows = {
    homedir: 'C:\\Users\\me',
    platform: 'win32' as const,
    appdata: 'C:\\Users\\me\\AppData\\Roaming',
  };

  // path.join uses the host's native separator (Windows = `\`, POSIX = `/`).
  // Tests are path-separator-agnostic to avoid OS-specific assertions.
  const sep = (s: string): RegExp => new RegExp(s.replace(/\//g, '[\\\\/]'));

  it('claude-desktop: macOS path', () => {
    const p = resolveAiClientConfigPath('claude-desktop', macOs);
    expect(p).toMatch(sep('Library/Application Support/Claude/claude_desktop_config.json'));
  });

  it('claude-desktop: Windows uses APPDATA', () => {
    const p = resolveAiClientConfigPath('claude-desktop', windows);
    expect(p).toContain('AppData');
    expect(p).toContain('Claude');
  });

  it('claude-desktop: Windows falls back to homedir/AppData/Roaming when APPDATA is unset', () => {
    const p = resolveAiClientConfigPath('claude-desktop', {
      homedir: 'C:\\Users\\me',
      platform: 'win32',
    });
    expect(p).toContain('AppData');
    expect(p).toContain('Roaming');
  });

  it('claude-desktop: Linux path under .config/Claude', () => {
    const p = resolveAiClientConfigPath('claude-desktop', linux);
    expect(p).toMatch(sep('.config/Claude/claude_desktop_config.json'));
  });

  it('cursor / continue / zed / claude-code / windsurf have fixed paths under homedir', () => {
    expect(resolveAiClientConfigPath('cursor', macOs)).toMatch(sep('.cursor/mcp.json'));
    expect(resolveAiClientConfigPath('continue', macOs)).toMatch(sep('.continue/config.json'));
    expect(resolveAiClientConfigPath('zed', macOs)).toMatch(sep('.config/zed/settings.json'));
    // P5R1-G11
    expect(resolveAiClientConfigPath('claude-code', macOs)).toMatch(sep('.claude/mcp.json'));
    expect(resolveAiClientConfigPath('windsurf', macOs)).toMatch(
      sep('.codeium/windsurf/mcp_config.json'),
    );
  });

  // P5R2-G2: cross-platform coverage for the new P5R1-G11 paths.

  it('claude-code: same .claude/mcp.json path on every platform', () => {
    expect(resolveAiClientConfigPath('claude-code', macOs)).toMatch(sep('.claude/mcp.json'));
    expect(resolveAiClientConfigPath('claude-code', linux)).toMatch(sep('.claude/mcp.json'));
    expect(resolveAiClientConfigPath('claude-code', windows)).toMatch(sep('.claude/mcp.json'));
  });

  it('windsurf: .codeium/windsurf/mcp_config.json on every platform', () => {
    expect(resolveAiClientConfigPath('windsurf', macOs)).toMatch(
      sep('.codeium/windsurf/mcp_config.json'),
    );
    expect(resolveAiClientConfigPath('windsurf', linux)).toMatch(
      sep('.codeium/windsurf/mcp_config.json'),
    );
    expect(resolveAiClientConfigPath('windsurf', windows)).toMatch(
      sep('.codeium/windsurf/mcp_config.json'),
    );
  });

  it('returns null for clients without a fixed config location', () => {
    const fixedClients = new Set<AiClient>([
      'claude-desktop',
      'claude-code',
      'cursor',
      'continue',
      'zed',
      'windsurf',
    ]);
    for (const c of AI_CLIENTS) {
      if (!fixedClients.has(c)) {
        expect(resolveAiClientConfigPath(c, macOs)).toBeNull();
      }
    }
  });

  it('AI_CLIENTS contains every client name documented today', () => {
    expect(AI_CLIENTS).toContain('claude-desktop');
    expect(AI_CLIENTS).toContain('claude-code');
    expect(AI_CLIENTS).toContain('generic');
    expect(AI_CLIENTS.length).toBe(10);
  });
});
