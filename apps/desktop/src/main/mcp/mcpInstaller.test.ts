import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { installClientConfig, detectClientInstallState, INSTALLABLE_CLIENTS } from './mcpInstaller';
import { resolveAiClientConfigPath } from '@apicircle/mcp-server';

function makeVirtualHome(platform: NodeJS.Platform = 'linux'): {
  tmp: string;
  env: { homedir: string; platform: NodeJS.Platform; appdata?: string };
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-mcp-install-'));
  const env = {
    homedir: tmp,
    platform,
    appdata: platform === 'win32' ? path.join(tmp, 'AppData/Roaming') : undefined,
  };
  return { tmp, env };
}

describe('mcpInstaller', () => {
  let tmp: string;
  let env: { homedir: string; platform: NodeJS.Platform; appdata?: string };

  beforeEach(() => {
    const v = makeVirtualHome('linux');
    tmp = v.tmp;
    env = v.env;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('INSTALLABLE_CLIENTS', () => {
    it('lists all 7 installable clients', () => {
      expect(INSTALLABLE_CLIENTS).toHaveLength(7);
      expect(INSTALLABLE_CLIENTS).toContain('claude-desktop');
      expect(INSTALLABLE_CLIENTS).toContain('claude-code');
      expect(INSTALLABLE_CLIENTS).toContain('codex');
      expect(INSTALLABLE_CLIENTS).toContain('cursor');
      expect(INSTALLABLE_CLIENTS).toContain('windsurf');
      expect(INSTALLABLE_CLIENTS).toContain('zed');
      expect(INSTALLABLE_CLIENTS).toContain('continue');
    });
  });

  // ==========================================================================
  // JSON mcpServers clients — claude-desktop, claude-code, cursor, windsurf
  // ==========================================================================

  describe('install — JSON mcpServers clients', () => {
    it.each(['claude-desktop', 'claude-code', 'cursor', 'windsurf'] as const)(
      '%s — creates config with apicircle under mcpServers when absent',
      (client) => {
        const result = installClientConfig(client, 'apicircle-mcp', '/ws/.apicircle', env);
        expect(result.outcome).toBe('created');
        expect(fs.existsSync(result.path)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as {
          mcpServers: Record<string, unknown>;
        };
        expect(parsed.mcpServers).toBeDefined();
        expect(parsed.mcpServers.apicircle).toBeDefined();
      },
    );

    it('returns unchanged when entry already matches', () => {
      const first = installClientConfig('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(first.outcome).toBe('created');
      const second = installClientConfig('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(second.outcome).toBe('unchanged');
    });

    it('returns updated when apicircleDir drifts', () => {
      installClientConfig('cursor', 'apicircle-mcp', '/old/.apicircle', env);
      const result = installClientConfig('cursor', 'apicircle-mcp', '/new/.apicircle', env);
      expect(result.outcome).toBe('updated');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as {
        mcpServers: { apicircle: { args: string[] } };
      };
      expect(parsed.mcpServers.apicircle.args).toContain('/new/.apicircle');
    });

    it('preserves foreign mcpServers entries on update', () => {
      const configPath = resolveAiClientConfigPath('cursor', env)!;
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            mcpServers: {
              shopify: { command: '/usr/local/bin/shopify-mcp', args: ['--token', 'abc'] },
            },
            extraTopLevel: 'keep me',
          },
          null,
          2,
        ),
      );

      installClientConfig('cursor', 'apicircle-mcp', '/ws/.apicircle', env);

      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        mcpServers: Record<string, { command: string }>;
        extraTopLevel: string;
      };
      expect(parsed.mcpServers.shopify.command).toBe('/usr/local/bin/shopify-mcp');
      expect(parsed.mcpServers.apicircle).toBeDefined();
      expect(parsed.extraTopLevel).toBe('keep me');
    });

    it('treats malformed JSON as "create fresh"', () => {
      const configPath = resolveAiClientConfigPath('claude-desktop', env)!;
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'not json at all');
      const result = installClientConfig('claude-desktop', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(result.outcome).toBe('created');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as {
        mcpServers: Record<string, unknown>;
      };
      expect(parsed.mcpServers.apicircle).toBeDefined();
    });

    it('JSON file ends with a newline', () => {
      const result = installClientConfig('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      const written = fs.readFileSync(result.path, 'utf8');
      expect(written.endsWith('\n')).toBe(true);
    });
  });

  // ==========================================================================
  // Zed — context_servers schema (JSON, different root key)
  // ==========================================================================

  describe('install — Zed context_servers', () => {
    it('writes under context_servers (NOT mcpServers)', () => {
      const result = installClientConfig('zed', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(result.outcome).toBe('created');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as Record<string, unknown>;
      expect(parsed.mcpServers).toBeUndefined();
      expect(parsed.context_servers).toBeDefined();
      const block = parsed.context_servers as { apicircle: { command: string } };
      expect(block.apicircle.command).toBe('apicircle-mcp');
    });

    it('preserves Zed user settings outside context_servers', () => {
      const zedConfig = resolveAiClientConfigPath('zed', env)!;
      fs.mkdirSync(path.dirname(zedConfig), { recursive: true });
      fs.writeFileSync(
        zedConfig,
        JSON.stringify({ theme: 'One Dark', buffer_font_size: 14 }, null, 2),
      );
      installClientConfig('zed', 'apicircle-mcp', '/ws/.apicircle', env);
      const parsed = JSON.parse(fs.readFileSync(zedConfig, 'utf8')) as Record<string, unknown>;
      expect(parsed.theme).toBe('One Dark');
      expect(parsed.buffer_font_size).toBe(14);
      expect(parsed.context_servers).toBeDefined();
    });

    it('returns unchanged on second install with same paths', () => {
      installClientConfig('zed', 'apicircle-mcp', '/ws/.apicircle', env);
      const second = installClientConfig('zed', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(second.outcome).toBe('unchanged');
    });
  });

  // ==========================================================================
  // Continue — YAML schema
  // ==========================================================================

  describe('install — Continue YAML', () => {
    it('creates a YAML file with apicircle under mcpServers', () => {
      const result = installClientConfig('continue', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(result.outcome).toBe('created');
      const written = fs.readFileSync(result.path, 'utf8');
      expect(written).toContain('mcpServers:');
      expect(written).toContain('apicircle:');
      expect(written).toContain('command: apicircle-mcp');
      expect(written.trimStart()).not.toMatch(/^\{/);
    });

    it('preserves Continue foreign keys on update', () => {
      const continuePath = resolveAiClientConfigPath('continue', env)!;
      fs.mkdirSync(path.dirname(continuePath), { recursive: true });
      fs.writeFileSync(
        continuePath,
        ['name: My Assistant', 'version: 0.0.1', 'models:', '  - name: gpt-4', ''].join('\n'),
      );
      installClientConfig('continue', 'apicircle-mcp', '/ws/.apicircle', env);
      const written = fs.readFileSync(continuePath, 'utf8');
      expect(written).toContain('name: My Assistant');
      expect(written).toContain('version: 0.0.1');
      expect(written).toContain('apicircle:');
    });

    it('returns unchanged on second install with same paths', () => {
      installClientConfig('continue', 'apicircle-mcp', '/ws/.apicircle', env);
      const second = installClientConfig('continue', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(second.outcome).toBe('unchanged');
    });

    it('returns updated when apicircleDir drifts', () => {
      installClientConfig('continue', 'apicircle-mcp', '/old/.apicircle', env);
      const result = installClientConfig('continue', 'apicircle-mcp', '/new/.apicircle', env);
      expect(result.outcome).toBe('updated');
    });

    it('treats malformed YAML as "create fresh"', () => {
      const continuePath = resolveAiClientConfigPath('continue', env)!;
      fs.mkdirSync(path.dirname(continuePath), { recursive: true });
      fs.writeFileSync(continuePath, ':\n:not valid yaml\n  : nested oops');
      const result = installClientConfig('continue', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(result.outcome).toBe('created');
    });
  });

  // ==========================================================================
  // Codex — TOML schema
  // ==========================================================================

  describe('install — Codex TOML', () => {
    it('creates a TOML file with apicircle under mcp_servers', () => {
      const result = installClientConfig('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(result.outcome).toBe('created');
      const written = fs.readFileSync(result.path, 'utf8');
      expect(written).toContain('mcp_servers');
      expect(written).toContain('apicircle');
      expect(written.trimStart()).not.toMatch(/^\{/);
    });

    it('uses mcp_servers (snake_case) NOT mcpServers (camelCase)', () => {
      const result = installClientConfig('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      const written = fs.readFileSync(result.path, 'utf8');
      expect(written).toContain('mcp_servers');
      expect(written).not.toContain('mcpServers');
    });

    it('preserves Codex foreign keys on update', () => {
      const codexPath = resolveAiClientConfigPath('codex', env)!;
      fs.mkdirSync(path.dirname(codexPath), { recursive: true });
      fs.writeFileSync(
        codexPath,
        ['model = "gpt-5.5"', '', '[windows]', 'sandbox = "elevated"', ''].join('\n'),
      );
      installClientConfig('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      const written = fs.readFileSync(codexPath, 'utf8');
      expect(written).toContain('gpt-5.5');
      expect(written).toContain('elevated');
      expect(written).toContain('apicircle');
    });

    it('returns unchanged on second install with same paths', () => {
      installClientConfig('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      const second = installClientConfig('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(second.outcome).toBe('unchanged');
    });

    it('returns updated when apicircleDir drifts', () => {
      installClientConfig('codex', 'apicircle-mcp', '/old/.apicircle', env);
      const result = installClientConfig('codex', 'apicircle-mcp', '/new/.apicircle', env);
      expect(result.outcome).toBe('updated');
    });

    it('treats malformed TOML as "create fresh"', () => {
      const codexPath = resolveAiClientConfigPath('codex', env)!;
      fs.mkdirSync(path.dirname(codexPath), { recursive: true });
      fs.writeFileSync(codexPath, '= broken\n[unclosed');
      const result = installClientConfig('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(result.outcome).toBe('created');
    });
  });

  // ==========================================================================
  // detectClientInstallState
  // ==========================================================================

  describe('detectClientInstallState', () => {
    it('returns absent for non-installable clients', () => {
      expect(detectClientInstallState('chatgpt', 'apicircle-mcp', '/ws')).toBe('absent');
      expect(detectClientInstallState('generic', 'apicircle-mcp', '/ws')).toBe('absent');
      expect(detectClientInstallState('cline', 'apicircle-mcp', '/ws')).toBe('absent');
    });

    it('returns absent when config file does not exist', () => {
      const state = detectClientInstallState('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(state).toBe('absent');
    });

    it('returns installed-current after a matching install', () => {
      installClientConfig('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      const state = detectClientInstallState('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(state).toBe('installed-current');
    });

    it('returns installed-stale when args have drifted', () => {
      installClientConfig('cursor', 'apicircle-mcp', '/old/.apicircle', env);
      const state = detectClientInstallState('cursor', 'apicircle-mcp', '/new/.apicircle', env);
      expect(state).toBe('installed-stale');
    });

    it('returns absent when config exists but has no apicircle entry', () => {
      const configPath = resolveAiClientConfigPath('cursor', env)!;
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
      const state = detectClientInstallState('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(state).toBe('absent');
    });

    it('detects installed-current for Continue YAML', () => {
      installClientConfig('continue', 'apicircle-mcp', '/ws/.apicircle', env);
      const state = detectClientInstallState('continue', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(state).toBe('installed-current');
    });

    it('detects installed-current for Codex TOML', () => {
      installClientConfig('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      const state = detectClientInstallState('codex', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(state).toBe('installed-current');
    });

    it('detects installed-current for Zed context_servers', () => {
      installClientConfig('zed', 'apicircle-mcp', '/ws/.apicircle', env);
      const state = detectClientInstallState('zed', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(state).toBe('installed-current');
    });

    it('returns absent on malformed config file', () => {
      const configPath = resolveAiClientConfigPath('cursor', env)!;
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'garbage');
      const state = detectClientInstallState('cursor', 'apicircle-mcp', '/ws/.apicircle', env);
      expect(state).toBe('absent');
    });
  });

  // ==========================================================================
  // Security guards
  // ==========================================================================

  describe('security — homedir containment', () => {
    it('throws for non-installable clients', () => {
      expect(() => installClientConfig('chatgpt', 'apicircle-mcp', '/ws')).toThrow(
        /does not support direct config installation/,
      );
    });

    it('throws for unknown client ids', () => {
      expect(() => installClientConfig('nonexistent', 'apicircle-mcp', '/ws')).toThrow();
    });

    it('refuses symlink-based escape from homedir', () => {
      if (process.platform === 'win32') return;
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      try {
        const cursorDir = path.join(tmp, '.cursor');
        fs.symlinkSync(outsideDir, cursorDir);
        expect(() => installClientConfig('cursor', 'apicircle-mcp', '/ws/.apicircle', env)).toThrow(
          /outside home/,
        );
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
