import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { window } from '../../test/mocks/vscode';
import {
  installMcpForClientCommand,
  installMcpForAllClientsCommand,
  uninstallMcpForClientCommand,
  coerceInstallableClientArg,
  type McpClientActionsDeps,
} from './mcpClientActions';
import * as mcpClientInstall from '../host/mcpClientInstall';
import type { VsCodeMcpManager } from '../host/mcpManager';

function makeManager(over: { hasActiveWorkspace?: boolean } = {}) {
  return {
    resolvePaths: () => ({
      binary: '/bin/apicircle',
      workspace: '/repo/.apicircle',
      hasActiveWorkspace: over.hasActiveWorkspace ?? true,
    }),
  } as unknown as VsCodeMcpManager;
}

function makeDeps(over: Partial<McpClientActionsDeps & { autoConfigure: string[] }> = {}) {
  return {
    mcp: over.mcp ?? makeManager(),
    getAutoConfigureClients:
      over.getAutoConfigureClients ?? (() => (over.autoConfigure ?? []) as never),
    onChanged: vi.fn(),
    log: vi.fn(),
  } as McpClientActionsDeps;
}

function reset(): void {
  (window.showInformationMessage as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showQuickPick as Mock).mockReset();
  vi.restoreAllMocks();
}

describe('installMcpForClientCommand', () => {
  beforeEach(reset);

  it('warns when no active workspace is found', async () => {
    const deps = makeDeps({ mcp: makeManager({ hasActiveWorkspace: false }) });
    await installMcpForClientCommand(deps, 'claude-desktop');
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No active API Circle workspace'),
    );
  });

  it('toasts "Installed" on a created outcome and triggers onChanged', async () => {
    const deps = makeDeps();
    vi.spyOn(mcpClientInstall, 'installClientMcpConfig').mockReturnValue({
      outcome: 'created',
      path: '/cfg/claude.json',
      client: 'claude-desktop',
    });
    await installMcpForClientCommand(deps, 'claude-desktop');
    expect(deps.onChanged).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Installed API Circle MCP/),
    );
  });

  it('toasts "Updated" on an updated outcome and triggers onChanged', async () => {
    const deps = makeDeps();
    vi.spyOn(mcpClientInstall, 'installClientMcpConfig').mockReturnValue({
      outcome: 'updated',
      path: '/cfg/cursor.json',
      client: 'cursor',
    });
    await installMcpForClientCommand(deps, 'cursor');
    expect(deps.onChanged).toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Updated'));
  });

  it('does NOT fire onChanged on an unchanged outcome', async () => {
    const deps = makeDeps();
    vi.spyOn(mcpClientInstall, 'installClientMcpConfig').mockReturnValue({
      outcome: 'unchanged',
      path: '/cfg/x.json',
      client: 'cursor',
    });
    await installMcpForClientCommand(deps, 'cursor');
    expect(deps.onChanged).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('already up to date'),
    );
  });

  it('shows a modal error on UnsafeClientConfigPathError', async () => {
    const deps = makeDeps();
    vi.spyOn(mcpClientInstall, 'installClientMcpConfig').mockImplementation(() => {
      throw new mcpClientInstall.UnsafeClientConfigPathError('unsafe path');
    });
    await installMcpForClientCommand(deps, 'cursor');
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), { modal: true });
  });

  it('shows a non-modal error on a generic install failure', async () => {
    const deps = makeDeps();
    vi.spyOn(mcpClientInstall, 'installClientMcpConfig').mockImplementation(() => {
      throw new Error('disk full');
    });
    await installMcpForClientCommand(deps, 'cursor');
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });
});

describe('installMcpForAllClientsCommand', () => {
  beforeEach(reset);

  it('prompts the user when the autoConfigure list is empty and bails on cancel', async () => {
    const deps = makeDeps({ autoConfigure: [] });
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    const spy = vi.spyOn(mcpClientInstall, 'installMcpForClients');
    await installMcpForAllClientsCommand(deps);
    expect(spy).not.toHaveBeenCalled();
  });

  it('summarises mixed outcomes (created + updated + unchanged) as info', async () => {
    const deps = makeDeps({ autoConfigure: ['claude-desktop', 'cursor', 'continue'] });
    vi.spyOn(mcpClientInstall, 'installMcpForClients').mockReturnValue({
      summary: { created: 1, updated: 1, unchanged: 1, error: 0 },
      results: [
        { client: 'claude-desktop', outcome: 'created', path: '/a' },
        { client: 'cursor', outcome: 'updated', path: '/b' },
        { client: 'continue', outcome: 'unchanged', path: '/c' },
      ],
    });
    await installMcpForAllClientsCommand(deps);
    expect(deps.onChanged).toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('1 installed'),
    );
  });

  it('surfaces a warning toast when any client fails', async () => {
    const deps = makeDeps({ autoConfigure: ['claude-desktop', 'cursor'] });
    vi.spyOn(mcpClientInstall, 'installMcpForClients').mockReturnValue({
      summary: { created: 1, updated: 0, unchanged: 0, error: 1 },
      results: [
        { client: 'claude-desktop', outcome: 'created', path: '/a' },
        { client: 'cursor', outcome: 'error', path: null, error: 'EACCES' },
      ],
    });
    await installMcpForAllClientsCommand(deps);
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Failed'));
  });

  it('summarises an all-unchanged install without firing onChanged', async () => {
    const deps = makeDeps({ autoConfigure: ['cursor'] });
    vi.spyOn(mcpClientInstall, 'installMcpForClients').mockReturnValue({
      summary: { created: 0, updated: 0, unchanged: 1, error: 0 },
      results: [{ client: 'cursor', outcome: 'unchanged', path: '/c' }],
    });
    await installMcpForAllClientsCommand(deps);
    expect(deps.onChanged).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('1 already up to date'),
    );
  });
});

describe('uninstallMcpForClientCommand', () => {
  beforeEach(reset);

  it('shortcircuits when the entry is already absent', async () => {
    const deps = makeDeps();
    vi.spyOn(mcpClientInstall, 'detectClientMcpConfigState').mockReturnValue('absent');
    await uninstallMcpForClientCommand(deps, 'cursor');
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('already absent'),
    );
  });

  it('does nothing when the confirmation modal is dismissed', async () => {
    const deps = makeDeps();
    vi.spyOn(mcpClientInstall, 'detectClientMcpConfigState').mockReturnValue('installed-current');
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await uninstallMcpForClientCommand(deps, 'cursor');
    expect(deps.onChanged).not.toHaveBeenCalled();
  });

  it('warns when no active workspace is found', async () => {
    const deps = makeDeps({ mcp: makeManager({ hasActiveWorkspace: false }) });
    await uninstallMcpForClientCommand(deps, 'cursor');
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No active API Circle workspace'),
    );
  });
});

// =============================================================================
// coerceInstallableClientArg — regression coverage for the 1.1.0 bug where
// the inline "Remove API Circle MCP from AI Client" menu and the trash
// icon both silently no-op'd because VS Code passes the McpNode tree
// element `{ kind: 'client', client }` to the command, but the registered
// handler was typed `(clientArg?: InstallableClient)` and rejected any
// non-string. The helper centralises the unwrap so both call sites stay
// in sync.
// =============================================================================

describe('coerceInstallableClientArg', () => {
  it('accepts a bare string client id', () => {
    expect(coerceInstallableClientArg('claude-code')).toBe('claude-code');
    expect(coerceInstallableClientArg('cursor')).toBe('cursor');
  });

  it('unwraps the McpNode shape VS Code passes from view/item/context menus', () => {
    expect(coerceInstallableClientArg({ kind: 'client', client: 'claude-code' })).toBe(
      'claude-code',
    );
    expect(coerceInstallableClientArg({ kind: 'client', client: 'windsurf' })).toBe('windsurf');
    expect(coerceInstallableClientArg({ kind: 'client', client: 'zed' })).toBe('zed');
  });

  it('rejects unknown clients (string + object shapes)', () => {
    expect(coerceInstallableClientArg('github-copilot')).toBeUndefined();
    expect(
      coerceInstallableClientArg({ kind: 'client', client: 'github-copilot' }),
    ).toBeUndefined();
    expect(coerceInstallableClientArg('not-a-client')).toBeUndefined();
  });

  it('rejects undefined / null / non-client objects', () => {
    expect(coerceInstallableClientArg(undefined)).toBeUndefined();
    expect(coerceInstallableClientArg(null)).toBeUndefined();
    expect(coerceInstallableClientArg({})).toBeUndefined();
    expect(coerceInstallableClientArg({ kind: 'header' })).toBeUndefined();
    expect(coerceInstallableClientArg({ client: 42 })).toBeUndefined();
  });
});

// =============================================================================
// Codex TOML uninstall — integration test that exercises the real
// removeApicircleEntry TOML parse/write path against the filesystem.
// =============================================================================

describe('uninstallMcpForClientCommand — Codex TOML integration', () => {
  let tmp: string;
  let codexPath: string;

  beforeEach(() => {
    reset();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-uninstall-codex-'));
    codexPath = path.join(tmp, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });

    vi.spyOn(mcpClientInstall, 'resolveInstallPath').mockReturnValue(codexPath);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('removes the apicircle entry from a TOML file while preserving foreign keys', async () => {
    fs.writeFileSync(
      codexPath,
      [
        'model = "o3-pro"',
        '',
        '[mcp_servers.apicircle]',
        'command = "apicircle-mcp"',
        'args = ["--workspace", "/ws/.apicircle"]',
        '',
        '[mcp_servers.other-server]',
        'command = "other-mcp"',
        '',
      ].join('\n'),
    );

    vi.spyOn(mcpClientInstall, 'detectClientMcpConfigState').mockReturnValue('installed-current');
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Remove');

    const deps = makeDeps();
    await uninstallMcpForClientCommand(deps, 'codex');

    expect(deps.onChanged).toHaveBeenCalled();

    const result = fs.readFileSync(codexPath, 'utf8');
    expect(result).toContain('model = "o3-pro"');
    expect(result).toContain('other-server');
    expect(result).not.toContain('apicircle');
  });

  it('drops the mcp_servers block entirely when apicircle is the only entry', async () => {
    fs.writeFileSync(
      codexPath,
      [
        'model = "o3-pro"',
        '',
        '[mcp_servers.apicircle]',
        'command = "apicircle-mcp"',
        'args = ["--workspace", "/ws/.apicircle"]',
        '',
      ].join('\n'),
    );

    vi.spyOn(mcpClientInstall, 'detectClientMcpConfigState').mockReturnValue('installed-current');
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Remove');

    const deps = makeDeps();
    await uninstallMcpForClientCommand(deps, 'codex');

    const result = fs.readFileSync(codexPath, 'utf8');
    expect(result).toContain('model = "o3-pro"');
    expect(result).not.toContain('mcp_servers');
    expect(result).not.toContain('apicircle');
  });
});
