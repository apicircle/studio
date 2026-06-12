import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  installCopilotMcpConfig,
  uninstallCopilotMcpConfig,
  detectCopilotMcpConfigState,
  assertSafeRelativeConfigPath,
  UnsafeConfigPathError,
  type McpConfigShape,
} from './copilotMcpInstall';

describe('copilotMcpInstall', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-install-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('installCopilotMcpConfig', () => {
    it('creates .vscode/mcp.json when it does not exist', () => {
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(result.outcome).toBe('created');
      const written = fs.readFileSync(result.path, 'utf8');
      const parsed = JSON.parse(written) as McpConfigShape;
      expect(parsed.mcpServers).toBeDefined();
      expect(parsed.mcpServers!.apicircle.command).toBe('apicircle-mcp');
      expect(parsed.mcpServers!.apicircle.args).toEqual([
        '--workspace',
        path.join(tmp, '.apicircle').replace(/\\/g, '/'),
      ]);
      // 2-space indent + trailing newline.
      expect(written.endsWith('\n')).toBe(true);
      expect(written).toContain('  "mcpServers": {');
    });

    it('creates the .vscode directory if it does not exist', () => {
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(fs.existsSync(path.join(tmp, '.vscode'))).toBe(true);
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it('returns "unchanged" when the existing entry already matches', () => {
      // First install
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      // Second install with same args
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(result.outcome).toBe('unchanged');
    });

    it('returns "updated" when binary path differs from the on-disk entry', () => {
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'old-apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: '/usr/local/bin/apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(result.outcome).toBe('updated');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as McpConfigShape;
      expect(parsed.mcpServers!.apicircle.command).toBe('/usr/local/bin/apicircle-mcp');
    });

    it('preserves unrelated mcpServers entries (idempotent merge)', () => {
      // Seed with another MCP server (e.g. user already has a "shopify" server).
      const cfg = {
        mcpServers: {
          shopify: {
            command: 'shopify-mcp',
            args: ['--token', 'sk-xxx'],
            env: { SHOPIFY_API_KEY: 'sk-yyy' },
          },
        },
      };
      fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.vscode/mcp.json'), JSON.stringify(cfg, null, 2));

      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      // "created" describes the apicircle entry (newly added), not the
      // file (which existed). The unrelated shopify entry doesn't
      // affect this — we're not "updating" apicircle, we're adding it.
      expect(result.outcome).toBe('created');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as McpConfigShape;
      // Apicircle was added.
      expect(parsed.mcpServers!.apicircle).toBeDefined();
      // Shopify was preserved verbatim.
      expect(parsed.mcpServers!.shopify).toEqual(cfg.mcpServers.shopify);
    });

    it('preserves unrelated top-level keys in the config file', () => {
      // Some users may have custom keys (e.g. comments, future VS Code
      // additions, or third-party tooling annotations). Don't drop them.
      const cfg = {
        $schema: 'https://example.com/mcp.json',
        mcpServers: {},
        myCustomKey: { foo: 'bar' },
      };
      fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.vscode/mcp.json'), JSON.stringify(cfg, null, 2));

      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as McpConfigShape;
      expect((parsed as { $schema?: string }).$schema).toBe('https://example.com/mcp.json');
      expect((parsed as { myCustomKey?: { foo: string } }).myCustomKey).toEqual({ foo: 'bar' });
    });

    it('creates fresh when the on-disk file is malformed JSON', () => {
      fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.vscode/mcp.json'), '{not valid json');
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      // Existing file was malformed → treated as empty → outcome is "created".
      expect(result.outcome).toBe('created');
      const parsed = JSON.parse(fs.readFileSync(result.path, 'utf8')) as McpConfigShape;
      expect(parsed.mcpServers!.apicircle).toBeDefined();
    });

    it('creates fresh when the on-disk file is JSON but not an object', () => {
      fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.vscode/mcp.json'), '[]');
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(result.outcome).toBe('created');
    });

    it('honours a custom relativeConfigPath setting', () => {
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        relativeConfigPath: 'custom/mcp.json',
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(result.outcome).toBe('created');
      expect(fs.existsSync(path.join(tmp, 'custom/mcp.json'))).toBe(true);
    });

    it('always writes forward-slash paths even when apicircleDir uses backslashes', () => {
      // Simulate a Windows-style path.
      const winDir = 'C:\\Users\\me\\repo\\.apicircle';
      const result = installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: winDir,
      });
      const written = fs.readFileSync(result.path, 'utf8');
      // The written JSON should NOT contain `\\` escapes — forward-slash
      // variant is canonical for committed config.
      expect(written).not.toContain('\\\\');
      const parsed = JSON.parse(written) as McpConfigShape;
      expect(parsed.mcpServers!.apicircle.args![1]).toBe('C:/Users/me/repo/.apicircle');
    });
  });

  describe('detectCopilotMcpConfigState', () => {
    it('returns "absent" when the file does not exist', () => {
      const state = detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(state).toBe('absent');
    });

    it('returns "absent" when the file exists but has no apicircle entry', () => {
      const cfg = { mcpServers: { other: { command: 'other-mcp' } } };
      fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.vscode/mcp.json'), JSON.stringify(cfg));
      const state = detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(state).toBe('absent');
    });

    it('returns "installed-current" after installCopilotMcpConfig with matching args', () => {
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      const state = detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(state).toBe('installed-current');
    });

    it('returns "installed-stale" when binary differs from on-disk entry', () => {
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      const state = detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        binary: '/usr/local/bin/apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(state).toBe('installed-stale');
    });

    it('returns "installed-stale" when apicircleDir differs from on-disk entry', () => {
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      const state = detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, 'OTHER.apicircle'),
      });
      expect(state).toBe('installed-stale');
    });

    it('returns "absent" for malformed JSON on disk', () => {
      fs.mkdirSync(path.join(tmp, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.vscode/mcp.json'), 'not json');
      const state = detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(state).toBe('absent');
    });

    // ----- P6R4-G2: probe returns 'absent' (does NOT throw) on unsafe path -----

    it('returns "absent" when relativeConfigPath would escape the workspace folder', () => {
      const state = detectCopilotMcpConfigState({
        workspaceFolder: tmp,
        relativeConfigPath: '../../../etc/passwd',
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      expect(state).toBe('absent');
    });
  });

  // =========================================================================
  // P6R4-G2 (SECURITY): assertSafeRelativeConfigPath path-traversal guard
  // =========================================================================
  describe('assertSafeRelativeConfigPath', () => {
    let tmpFolder: string;

    beforeEach(() => {
      tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-safe-'));
    });

    afterEach(() => {
      fs.rmSync(tmpFolder, { recursive: true, force: true });
    });

    it('accepts a normal relative path under the workspace folder', () => {
      const resolved = assertSafeRelativeConfigPath(tmpFolder, '.vscode/mcp.json');
      expect(resolved).toBe(path.join(tmpFolder, '.vscode/mcp.json'));
    });

    it('accepts a nested relative path', () => {
      const resolved = assertSafeRelativeConfigPath(tmpFolder, 'config/mcp/apicircle.json');
      expect(resolved).toBe(path.join(tmpFolder, 'config/mcp/apicircle.json'));
    });

    it('rejects an absolute path', () => {
      expect(() => assertSafeRelativeConfigPath(tmpFolder, '/etc/passwd')).toThrow(
        UnsafeConfigPathError,
      );
    });

    it('rejects ../../escape attempts', () => {
      expect(() => assertSafeRelativeConfigPath(tmpFolder, '../../../tmp/evil.json')).toThrow(
        UnsafeConfigPathError,
      );
    });

    it('rejects relative path that resolves outside the workspace via parent traversal', () => {
      // Multi-segment traversal — `.vscode/../../../evil.json`
      expect(() => assertSafeRelativeConfigPath(tmpFolder, '.vscode/../../../evil.json')).toThrow(
        UnsafeConfigPathError,
      );
    });

    it('accepts a relative path that traverses but stays inside the workspace', () => {
      // `.vscode/../mcp.json` resolves to `<workspace>/mcp.json` — valid.
      const resolved = assertSafeRelativeConfigPath(tmpFolder, '.vscode/../mcp.json');
      expect(resolved).toBe(path.join(tmpFolder, 'mcp.json'));
    });

    it('UnsafeConfigPathError carries .name = "UnsafeConfigPathError"', () => {
      try {
        assertSafeRelativeConfigPath(tmpFolder, '/etc/passwd');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UnsafeConfigPathError);
        expect((err as Error).name).toBe('UnsafeConfigPathError');
      }
    });

    it('error message names the problematic setting + path so users can fix it', () => {
      try {
        assertSafeRelativeConfigPath(tmpFolder, '../../../tmp/evil.json');
        expect.fail('should have thrown');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain('apicircle.mcp.workspaceConfigPath');
        expect(msg).toContain('../../../tmp/evil.json');
      }
    });
  });

  // =========================================================================
  // P6R4-G2 (SECURITY): installCopilotMcpConfig surfaces the error
  // =========================================================================
  describe('installCopilotMcpConfig — path traversal rejection', () => {
    let tmp2: string;

    beforeEach(() => {
      tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-install-safe-'));
    });

    afterEach(() => {
      fs.rmSync(tmp2, { recursive: true, force: true });
    });

    it('throws UnsafeConfigPathError when relativeConfigPath escapes the workspace', () => {
      expect(() =>
        installCopilotMcpConfig({
          workspaceFolder: tmp2,
          relativeConfigPath: '../../../tmp/evil.json',
          binary: 'apicircle-mcp',
          apicircleDir: path.join(tmp2, '.apicircle'),
        }),
      ).toThrow(UnsafeConfigPathError);
    });

    it('throws on an absolute relativeConfigPath', () => {
      expect(() =>
        installCopilotMcpConfig({
          workspaceFolder: tmp2,
          relativeConfigPath: '/etc/passwd',
          binary: 'apicircle-mcp',
          apicircleDir: path.join(tmp2, '.apicircle'),
        }),
      ).toThrow(UnsafeConfigPathError);
    });

    it('does NOT write any file when the safety check fails', () => {
      try {
        installCopilotMcpConfig({
          workspaceFolder: tmp2,
          relativeConfigPath: '../../../tmp/evil.json',
          binary: 'apicircle-mcp',
          apicircleDir: path.join(tmp2, '.apicircle'),
        });
      } catch {
        // expected
      }
      // No file under .vscode/ created.
      expect(fs.existsSync(path.join(tmp2, '.vscode'))).toBe(false);
    });
  });

  describe('uninstallCopilotMcpConfig', () => {
    it('reports "absent" when mcp.json does not exist', () => {
      const result = uninstallCopilotMcpConfig({ workspaceFolder: tmp });
      expect(result.outcome).toBe('absent');
    });

    it('removes only the apicircle entry, preserving foreign servers', () => {
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      // Hand-add a foreign server entry that the user might have added.
      const mcpPath = path.join(tmp, '.vscode', 'mcp.json');
      const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as McpConfigShape;
      parsed.mcpServers!.other = { command: 'other-mcp', args: ['--foo'] };
      fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + '\n');

      const result = uninstallCopilotMcpConfig({ workspaceFolder: tmp });
      expect(result.outcome).toBe('removed');
      const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as McpConfigShape;
      expect(after.mcpServers).toBeDefined();
      expect(after.mcpServers!.apicircle).toBeUndefined();
      expect(after.mcpServers!.other).toBeDefined();
      expect(after.mcpServers!.other.command).toBe('other-mcp');
    });

    it('strips the mcpServers key entirely when the apicircle entry was the only one', () => {
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      const result = uninstallCopilotMcpConfig({ workspaceFolder: tmp });
      expect(result.outcome).toBe('removed');
      const after = JSON.parse(fs.readFileSync(result.path, 'utf8')) as McpConfigShape;
      expect(after.mcpServers).toBeUndefined();
    });

    it('preserves unrelated top-level keys when stripping the apicircle entry', () => {
      const mcpPath = path.join(tmp, '.vscode', 'mcp.json');
      fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
      fs.writeFileSync(
        mcpPath,
        JSON.stringify(
          { mcpServers: { apicircle: { command: 'apicircle-mcp' } }, inputs: ['x'] },
          null,
          2,
        ),
      );
      const result = uninstallCopilotMcpConfig({ workspaceFolder: tmp });
      expect(result.outcome).toBe('removed');
      const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as McpConfigShape & {
        inputs?: string[];
      };
      expect(after.inputs).toEqual(['x']);
      expect(after.mcpServers).toBeUndefined();
    });

    it('is idempotent — running on an already-clean file is a no-op', () => {
      installCopilotMcpConfig({
        workspaceFolder: tmp,
        binary: 'apicircle-mcp',
        apicircleDir: path.join(tmp, '.apicircle'),
      });
      uninstallCopilotMcpConfig({ workspaceFolder: tmp });
      const second = uninstallCopilotMcpConfig({ workspaceFolder: tmp });
      expect(second.outcome).toBe('absent');
    });

    it('rejects unsafe relative paths via the same path-traversal guard as install', () => {
      expect(() =>
        uninstallCopilotMcpConfig({
          workspaceFolder: tmp,
          relativeConfigPath: '../../../etc/passwd',
        }),
      ).toThrow(UnsafeConfigPathError);
    });
  });
});
