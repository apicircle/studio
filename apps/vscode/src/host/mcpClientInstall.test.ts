import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  installClientMcpConfig,
  detectClientMcpConfigState,
  installMcpForClients,
  resolveInstallPath,
  INSTALLABLE_CLIENTS,
  UnsafeClientConfigPathError,
  CLIENT_LABELS,
  type InstallableClient,
} from './mcpClientInstall';

// Every test runs against a virtual home directory under os.tmpdir() so we
// never touch the developer's actual `~/.cursor/` or Claude Desktop config.
function makeVirtualHome(platform: NodeJS.Platform = 'linux'): {
  tmp: string;
  env: { homedir: string; platform: NodeJS.Platform; appdata?: string };
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-client-install-'));
  const env = {
    homedir: tmp,
    platform,
    appdata: platform === 'win32' ? path.join(tmp, 'AppData/Roaming') : undefined,
  };
  return { tmp, env };
}

describe('mcpClientInstall — Phase 8 multi-client installer', () => {
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

  describe('static catalog', () => {
    it('exports 6 installable clients (Phase 8: 5 + Phase 11: Continue)', () => {
      expect(INSTALLABLE_CLIENTS).toHaveLength(6);
      expect(INSTALLABLE_CLIENTS).toContain('claude-desktop');
      expect(INSTALLABLE_CLIENTS).toContain('claude-code');
      expect(INSTALLABLE_CLIENTS).toContain('cursor');
      expect(INSTALLABLE_CLIENTS).toContain('windsurf');
      expect(INSTALLABLE_CLIENTS).toContain('zed');
      expect(INSTALLABLE_CLIENTS).toContain('continue');
    });

    it('exports a human-readable label per client', () => {
      for (const c of INSTALLABLE_CLIENTS) {
        expect(CLIENT_LABELS[c]).toBeTruthy();
        expect(CLIENT_LABELS[c].length).toBeGreaterThan(0);
      }
    });
  });

  describe('path resolution per client', () => {
    it('claude-desktop → Linux ~/.config/Claude/claude_desktop_config.json', () => {
      const resolved = resolveInstallPath('claude-desktop', env);
      expect(resolved).toBe(path.join(tmp, '.config/Claude/claude_desktop_config.json'));
    });

    it('claude-desktop → macOS uses Application Support', () => {
      const macEnv = { ...env, platform: 'darwin' as NodeJS.Platform };
      const resolved = resolveInstallPath('claude-desktop', macEnv);
      expect(resolved).toBe(
        path.join(tmp, 'Library/Application Support/Claude/claude_desktop_config.json'),
      );
    });

    it('claude-desktop → Windows uses %APPDATA%/Claude', () => {
      const winEnv = {
        ...env,
        platform: 'win32' as NodeJS.Platform,
        appdata: path.join(tmp, 'AppData/Roaming'),
      };
      const resolved = resolveInstallPath('claude-desktop', winEnv);
      expect(resolved.replace(/\\/g, '/')).toContain(
        'AppData/Roaming/Claude/claude_desktop_config.json',
      );
    });

    it('cursor → ~/.cursor/mcp.json', () => {
      expect(resolveInstallPath('cursor', env)).toBe(path.join(tmp, '.cursor/mcp.json'));
    });

    it('claude-code → ~/.claude/mcp.json', () => {
      expect(resolveInstallPath('claude-code', env)).toBe(path.join(tmp, '.claude/mcp.json'));
    });

    it('windsurf → ~/.codeium/windsurf/mcp_config.json', () => {
      expect(resolveInstallPath('windsurf', env)).toBe(
        path.join(tmp, '.codeium/windsurf/mcp_config.json'),
      );
    });

    it('zed → ~/.config/zed/settings.json', () => {
      expect(resolveInstallPath('zed', env)).toBe(path.join(tmp, '.config/zed/settings.json'));
    });
  });

  describe('install (single client) — standard mcpServers schema', () => {
    it.each(['claude-desktop', 'claude-code', 'cursor', 'windsurf'] as const)(
      '%s — creates the config file with apicircle under mcpServers when absent',
      (client) => {
        const result = installClientMcpConfig({
          client,
          binary: 'apicircle-mcp',
          apicircleDir: '/some/.apicircle',
          env,
        });
        expect(result.outcome).toBe('created');
        expect(result.client).toBe(client);
        expect(fs.existsSync(result.path)).toBe(true);

        const written = fs.readFileSync(result.path, 'utf8');
        const parsed = JSON.parse(written) as { mcpServers: Record<string, unknown> };
        expect(parsed.mcpServers).toBeDefined();
        expect(parsed.mcpServers.apicircle).toBeDefined();
        expect(written.endsWith('\n')).toBe(true);
      },
    );

    it('returns unchanged when the entry already matches', () => {
      const opts = {
        client: 'cursor' as const,
        binary: 'apicircle-mcp',
        apicircleDir: '/some/.apicircle',
        env,
      };
      const first = installClientMcpConfig(opts);
      expect(first.outcome).toBe('created');
      const second = installClientMcpConfig(opts);
      expect(second.outcome).toBe('unchanged');
    });

    it('returns updated when args have drifted', () => {
      installClientMcpConfig({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/old/.apicircle',
        env,
      });
      const result = installClientMcpConfig({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/new/.apicircle',
        env,
      });
      expect(result.outcome).toBe('updated');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as {
        mcpServers: { apicircle: { args: string[] } };
      };
      expect(parsed.mcpServers.apicircle.args).toContain('/new/.apicircle');
    });

    it('preserves foreign mcpServers entries on update', () => {
      const configDir = path.dirname(resolveInstallPath('cursor', env));
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'mcp.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            mcpServers: {
              shopify: { command: '/usr/local/bin/shopify-mcp', args: ['--token', 'abc'] },
            },
            extraneousTopLevelKey: 'preserve me',
          },
          null,
          2,
        ),
      );

      installClientMcpConfig({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });

      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        mcpServers: Record<string, { command: string; args?: string[] }>;
        extraneousTopLevelKey: string;
      };
      expect(parsed.mcpServers.shopify.command).toBe('/usr/local/bin/shopify-mcp');
      expect(parsed.mcpServers.apicircle).toBeDefined();
      expect(parsed.extraneousTopLevelKey).toBe('preserve me');
    });

    it('treats malformed JSON as "create fresh" rather than throwing', () => {
      const configDir = path.dirname(resolveInstallPath('claude-desktop', env));
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(resolveInstallPath('claude-desktop', env), 'not json at all');
      const result = installClientMcpConfig({
        client: 'claude-desktop',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      // Outcome is 'created' because there was no pre-existing apicircle entry
      // we could see (the file was unreadable).
      expect(result.outcome).toBe('created');
      const written = JSON.parse(fs.readFileSync(result.path, 'utf8')) as {
        mcpServers: Record<string, unknown>;
      };
      expect(written.mcpServers.apicircle).toBeDefined();
    });
  });

  describe('install (single client) — Zed context_servers schema', () => {
    it('writes under context_servers (NOT mcpServers) for Zed', () => {
      const result = installClientMcpConfig({
        client: 'zed',
        binary: 'apicircle-mcp',
        apicircleDir: '/zed-ws/.apicircle',
        env,
      });
      expect(result.outcome).toBe('created');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as Record<string, unknown>;
      // Zed-specific: no mcpServers key
      expect(parsed.mcpServers).toBeUndefined();
      expect(parsed.context_servers).toBeDefined();
      const block = parsed.context_servers as { apicircle: { command: string } };
      expect(block.apicircle.command).toBe('apicircle-mcp');
    });

    it('preserves Zed user settings outside context_servers', () => {
      const zedConfig = resolveInstallPath('zed', env);
      fs.mkdirSync(path.dirname(zedConfig), { recursive: true });
      fs.writeFileSync(
        zedConfig,
        JSON.stringify({ theme: 'One Dark', buffer_font_size: 14 }, null, 2),
      );
      installClientMcpConfig({
        client: 'zed',
        binary: 'apicircle-mcp',
        apicircleDir: '/zed-ws/.apicircle',
        env,
      });
      const parsed = JSON.parse(fs.readFileSync(zedConfig, 'utf8')) as Record<string, unknown>;
      expect(parsed.theme).toBe('One Dark');
      expect(parsed.buffer_font_size).toBe(14);
      expect(parsed.context_servers).toBeDefined();
    });
  });

  describe('install (single client) — Continue YAML schema (Phase 11)', () => {
    it('writes ~/.continue/config.yaml (NOT config.json)', () => {
      const continuePath = resolveInstallPath('continue', env);
      expect(continuePath).toBe(path.join(tmp, '.continue/config.yaml'));
    });

    it('creates a YAML file with apicircle under mcpServers when absent', () => {
      const result = installClientMcpConfig({
        client: 'continue',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(result.outcome).toBe('created');
      const written = fs.readFileSync(result.path, 'utf8');
      // YAML output — readable, not JSON-escaped.
      expect(written).toContain('mcpServers:');
      expect(written).toContain('apicircle:');
      expect(written).toContain('command: apicircle-mcp');
      // Definitely NOT JSON (would start with `{`).
      expect(written.trimStart()).not.toMatch(/^\{/);
    });

    it('preserves Continue foreign keys (name, version, models) on update', () => {
      const continuePath = resolveInstallPath('continue', env);
      fs.mkdirSync(path.dirname(continuePath), { recursive: true });
      fs.writeFileSync(
        continuePath,
        [
          'name: My Assistant',
          'version: 0.0.1',
          'schema: v1',
          'models:',
          '  - name: gpt-4',
          '    provider: openai',
          '',
        ].join('\n'),
      );
      installClientMcpConfig({
        client: 'continue',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      const written = fs.readFileSync(continuePath, 'utf8');
      // Foreign keys preserved verbatim.
      expect(written).toContain('name: My Assistant');
      expect(written).toContain('version: 0.0.1');
      expect(written).toContain('schema: v1');
      expect(written).toContain('models:');
      expect(written).toContain('provider: openai');
      // apicircle entry added.
      expect(written).toContain('apicircle:');
      expect(written).toContain('command: apicircle-mcp');
    });

    it('returns unchanged on a second install with the same paths', () => {
      const opts = {
        client: 'continue' as const,
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      };
      const first = installClientMcpConfig(opts);
      expect(first.outcome).toBe('created');
      const second = installClientMcpConfig(opts);
      expect(second.outcome).toBe('unchanged');
    });

    it('returns updated when apicircleDir drifts', () => {
      installClientMcpConfig({
        client: 'continue',
        binary: 'apicircle-mcp',
        apicircleDir: '/old/.apicircle',
        env,
      });
      const result = installClientMcpConfig({
        client: 'continue',
        binary: 'apicircle-mcp',
        apicircleDir: '/new/.apicircle',
        env,
      });
      expect(result.outcome).toBe('updated');
    });

    it('detects installed-current for the YAML variant', () => {
      installClientMcpConfig({
        client: 'continue',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      const state = detectClientMcpConfigState({
        client: 'continue',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(state).toBe('installed-current');
    });

    it('treats malformed YAML as "create fresh" rather than throwing', () => {
      const continuePath = resolveInstallPath('continue', env);
      fs.mkdirSync(path.dirname(continuePath), { recursive: true });
      fs.writeFileSync(continuePath, ':\n:not valid yaml\n  : nested oops\n\t- mixed tabs');
      const result = installClientMcpConfig({
        client: 'continue',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(result.outcome).toBe('created');
    });
  });

  describe('install — security guards', () => {
    it('refuses to write when a parent directory is a symlink pointing outside homedir', () => {
      // Skip on Windows where symlink creation needs elevation.
      if (process.platform === 'win32') return;
      const outsideHome = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      try {
        // Create a symlink at <tmp>/.cursor pointing at outside-home dir
        const dotCursor = path.join(tmp, '.cursor');
        fs.symlinkSync(outsideHome, dotCursor, 'dir');
        expect(() =>
          installClientMcpConfig({
            client: 'cursor',
            binary: 'apicircle-mcp',
            apicircleDir: '/ws/.apicircle',
            env,
          }),
        ).toThrow(UnsafeClientConfigPathError);
      } finally {
        fs.rmSync(outsideHome, { recursive: true, force: true });
      }
    });
  });

  describe('detect (probe — no mutation)', () => {
    it('returns absent when the config file does not exist', () => {
      const state = detectClientMcpConfigState({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(state).toBe('absent');
    });

    it('returns installed-current after a fresh install', () => {
      installClientMcpConfig({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      const state = detectClientMcpConfigState({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(state).toBe('installed-current');
    });

    it('returns installed-stale when args drift', () => {
      installClientMcpConfig({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/old/.apicircle',
        env,
      });
      const state = detectClientMcpConfigState({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/new/.apicircle',
        env,
      });
      expect(state).toBe('installed-stale');
    });

    it('detects Zed schema correctly (context_servers, not mcpServers)', () => {
      installClientMcpConfig({
        client: 'zed',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      const state = detectClientMcpConfigState({
        client: 'zed',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(state).toBe('installed-current');
    });

    it('does NOT crash on malformed JSON — returns absent', () => {
      const cursorConfig = resolveInstallPath('cursor', env);
      fs.mkdirSync(path.dirname(cursorConfig), { recursive: true });
      fs.writeFileSync(cursorConfig, 'garbage');
      const state = detectClientMcpConfigState({
        client: 'cursor',
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(state).toBe('absent');
    });
  });

  describe('installMcpForClients (bulk)', () => {
    it('installs into all 6 clients in one call', () => {
      const report = installMcpForClients(INSTALLABLE_CLIENTS, {
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(report.results).toHaveLength(6);
      expect(report.summary.created).toBe(6);
      expect(report.summary.error).toBe(0);
      for (const r of report.results) {
        expect(r.outcome).toBe('created');
      }
    });

    it('continues past a per-client failure (one error does not abort the batch)', () => {
      // Pre-place a symlink to outside-home for cursor only (Linux/macOS only).
      if (process.platform === 'win32') return;
      const outsideHome = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      try {
        fs.symlinkSync(outsideHome, path.join(tmp, '.cursor'), 'dir');
        const report = installMcpForClients(
          ['cursor', 'claude-desktop', 'zed'] as const satisfies readonly InstallableClient[],
          {
            binary: 'apicircle-mcp',
            apicircleDir: '/ws/.apicircle',
            env,
          },
        );
        expect(report.results).toHaveLength(3);
        expect(report.summary.error).toBe(1);
        expect(report.summary.created).toBe(2);
        const cursorResult = report.results.find((r) => r.client === 'cursor');
        expect(cursorResult?.outcome).toBe('error');
      } finally {
        fs.rmSync(outsideHome, { recursive: true, force: true });
      }
    });

    it('reports created vs updated vs unchanged accurately on a re-run', () => {
      // First run: all created.
      installMcpForClients(['cursor', 'claude-desktop'] as const, {
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      // Second run: all unchanged.
      const report = installMcpForClients(['cursor', 'claude-desktop'] as const, {
        binary: 'apicircle-mcp',
        apicircleDir: '/ws/.apicircle',
        env,
      });
      expect(report.summary.unchanged).toBe(2);
      // Third run with drifted args: all updated.
      const updated = installMcpForClients(['cursor', 'claude-desktop'] as const, {
        binary: 'apicircle-mcp',
        apicircleDir: '/new/.apicircle',
        env,
      });
      expect(updated.summary.updated).toBe(2);
    });
  });
});
