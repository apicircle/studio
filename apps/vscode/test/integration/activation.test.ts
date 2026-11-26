// =============================================================================
// Activation integration test.
//
// Drives the extension's `activate()` function with a hand-rolled mock
// ExtensionContext + empty / single / multi workspace folder configurations.
// Verifies the full activation pipeline registers views, commands, watchers
// without errors — the seam that pure unit tests don't cover.
//
// This is NOT an E2E test — it doesn't launch a real VS Code. That harness
// lives in `e2e/vscode/`. This sits between unit (per-module mock) and E2E
// (real VS Code) and validates the wiring.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import type * as vscode from 'vscode';
import { Uri, window, workspace, commands } from '../mocks/vscode';
import { activate, deactivate, __getInternalsForTests } from '../../src/extension';
import { ApicircleFsProvider } from '../../src/fs/apicircleFsProvider';
import { EXTENSION_API_VERSION } from '../../src/api';

interface TestContext {
  ctx: vscode.ExtensionContext;
  globalState: Map<string, unknown>;
}

function makeMockContext(globalStoragePath: string): TestContext {
  const state = new Map<string, unknown>();
  const ctx = {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        state.has(key) ? (state.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => Array.from(state.keys()),
    },
    workspaceState: {
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
      update: async () => undefined,
      keys: () => [],
    },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    globalStorageUri: Uri.file(globalStoragePath),
    storageUri: undefined,
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext',
    asAbsolutePath: (rel: string) => path.join('/ext', rel),
    extensionMode: 3,
  };
  return { ctx: ctx as unknown as vscode.ExtensionContext, globalState: state };
}

describe('extension activation (integration)', () => {
  let tmp: string;
  let registeredCommandIds: string[] = [];
  let registeredTreeViewIds: string[] = [];
  let prevWorkspacesRoot: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-activation-'));
    registeredCommandIds = [];
    registeredTreeViewIds = [];

    // Make registry discovery hermetic. activate() → rediscoverAndRegister →
    // discoverRegistryWorkspaces() resolves the apicircle root via
    // APICIRCLE_WORKSPACES_ROOT (falling back to ~/.apicircle). Point it at an
    // empty dir so the dev machine's real ~/.apicircle/ workspaces can't leak
    // into the workspace-count assertions below. Restored in afterEach.
    prevWorkspacesRoot = process.env.APICIRCLE_WORKSPACES_ROOT;
    const apicircleHome = path.join(tmp, 'apicircle-home');
    fs.mkdirSync(apicircleHome, { recursive: true });
    process.env.APICIRCLE_WORKSPACES_ROOT = apicircleHome;

    (
      commands.registerCommand as unknown as {
        mockReset: () => void;
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockReset();
    (
      commands.registerCommand as unknown as {
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockImplementation((...args: unknown[]) => {
      registeredCommandIds.push(args[0] as string);
      return { dispose: () => undefined };
    });
    (
      window.createTreeView as unknown as {
        mockReset: () => void;
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockReset();
    (
      window.createTreeView as unknown as {
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockImplementation((...args: unknown[]) => {
      registeredTreeViewIds.push(args[0] as string);
      return { dispose: () => undefined };
    });
    (
      workspace.onDidChangeWorkspaceFolders as unknown as {
        mockReset: () => void;
        mockReturnValue: (v: unknown) => void;
      }
    ).mockReset();
    (
      workspace.onDidChangeWorkspaceFolders as unknown as { mockReturnValue: (v: unknown) => void }
    ).mockReturnValue({ dispose: () => undefined });
    (workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
  });

  afterEach(async () => {
    try {
      // P3R2-G3: deactivate is now async — await it so the mock controller
      // disposeAll completes before we tear down.
      await deactivate();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevWorkspacesRoot === undefined) delete process.env.APICIRCLE_WORKSPACES_ROOT;
    else process.env.APICIRCLE_WORKSPACES_ROOT = prevWorkspacesRoot;
  });

  it('registers all 8 sidebar views when no folder is open', () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    expect(registeredTreeViewIds.sort()).toEqual(
      [
        'apicircle.editor',
        'apicircle.environment',
        'apicircle.execution',
        'apicircle.history',
        'apicircle.linkWorkspaces',
        'apicircle.mock',
        'apicircle.snapshots',
        'apicircle.workspace',
      ].sort(),
    );
  });

  it('registers all expected commands', () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    // The runtime-registered command set is validated against package.json's
    // `contributes.commands` (read fresh from disk) rather than a
    // hand-maintained allowlist, so new contributions can't silently drift out
    // of sync with this test. Two invariants:
    //   1. Every command CONTRIBUTED in package.json must be REGISTERED at
    //      runtime — otherwise selecting it from the palette throws
    //      "command 'apicircle.x' not found".
    //   2. Every command REGISTERED at runtime must be either contributed OR a
    //      known CodeLens-only command. CodeLens-only commands are invoked with
    //      (uri, line) args from a request-YAML ◆ field-editor lens and are
    //      deliberately kept out of the palette (an arg-less palette invocation
    //      is a no-op / meaningless), so they're registered WITHOUT a
    //      package.json contribution. `manifestRegression.test.ts` pins
    //      `setRequestAuthField` OUT of the manifest — this allowlist is the
    //      seam that keeps such commands accounted for instead of flagged.
    const pkg = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { contributes: { commands: { command: string }[] } };
    const contributed = pkg.contributes.commands.map((c) => c.command);

    // Registered at runtime but intentionally NOT contributed to the palette —
    // driven only by the request-YAML ◆ field-editor CodeLenses
    // (`lang/requestCodeLens.ts`).
    const CODELENS_ONLY = [
      'apicircle.setRequestAssertionTargetField',
      'apicircle.setRequestAssertionExpectedField',
      'apicircle.setRequestAuthField',
    ];

    const notRegistered = contributed.filter((id) => !registeredCommandIds.includes(id));
    expect(
      notRegistered,
      `contributed in package.json but never registered (palette would throw "command not found"): ${notRegistered.join(', ')}`,
    ).toEqual([]);

    const allowed = new Set([...contributed, ...CODELENS_ONLY]);
    const unexpected = registeredCommandIds.filter((id) => !allowed.has(id));
    expect(
      unexpected,
      `registered at runtime but neither contributed in package.json nor a known CodeLens-only command: ${unexpected.join(', ')}`,
    ).toEqual([]);

    // Keep the CodeLens-only allowlist honest: a stale entry (no longer
    // registered) would mask a real removal, so require each to still register.
    const staleAllowlist = CODELENS_ONLY.filter((id) => !registeredCommandIds.includes(id));
    expect(
      staleAllowlist,
      `CODELENS_ONLY lists command(s) no longer registered — remove them: ${staleAllowlist.join(', ')}`,
    ).toEqual([]);
  });

  it('subscribes to workspace folder changes for re-discovery', () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);
    expect(workspace.onDidChangeWorkspaceFolders).toHaveBeenCalledTimes(1);
  });

  it('auto-registers workspaces found via canonical .apicircle/ discovery', () => {
    const folder = path.join(tmp, 'repo');
    const apicircleRoot = path.join(folder, '.apicircle');
    const wsDir = path.join(apicircleRoot, 'workspace-test-ws');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, 'workspace.json'),
      JSON.stringify({ schemaVersion: 1, workspaceId: 'test-ws' }),
    );
    fs.writeFileSync(
      path.join(apicircleRoot, 'registry.json'),
      JSON.stringify({
        schemaVersion: 1,
        activeWorkspaceId: 'test-ws',
        workspaces: [{ id: 'test-ws', name: 'repo', createdAt: 't', lastOpenedAt: 't' }],
      }),
    );

    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'repo', index: 0 },
    ];

    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    const { bridge } = __getInternalsForTests();
    expect(bridge?.listWorkspaces()).toHaveLength(1);
    expect(bridge?.activeWorkspace()?.workspace.label).toBe('repo');
  });

  it('does NOT register a workspace when the folder has no .apicircle/', () => {
    const folder = path.join(tmp, 'no-workspace');
    fs.mkdirSync(folder, { recursive: true });

    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'empty', index: 0 },
    ];

    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    const { bridge } = __getInternalsForTests();
    expect(bridge?.listWorkspaces()).toHaveLength(0);
    expect(bridge?.activeWorkspace()).toBeNull();
  });

  it('restores previously-active workspace from globalState on subsequent activation', async () => {
    const folder = path.join(tmp, 'repo-a');
    const apicircleRoot = path.join(folder, '.apicircle');
    const wsDir = path.join(apicircleRoot, 'workspace-ws-a');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'workspace.json'), '{}');
    fs.writeFileSync(
      path.join(apicircleRoot, 'registry.json'),
      JSON.stringify({
        schemaVersion: 1,
        activeWorkspaceId: 'ws-a',
        workspaces: [{ id: 'ws-a', name: 'repo-a', createdAt: 't', lastOpenedAt: 't' }],
      }),
    );

    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'repo-a', index: 0 },
    ];

    const { ctx, globalState } = makeMockContext(path.join(tmp, 'globalStorage'));
    globalState.set('apicircle.activeWorkspaceId', 'ws-a');
    activate(ctx);

    const { bridge } = __getInternalsForTests();
    expect(bridge?.activeWorkspace()?.workspace.label).toBe('repo-a');
  });

  it('deactivate() clears the bridge and view singletons', async () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);
    expect(__getInternalsForTests().bridge).not.toBeNull();

    await deactivate();
    expect(__getInternalsForTests().bridge).toBeNull();
    expect(__getInternalsForTests().views).toBeNull();
  });

  it('deactivate() waits for the workspace reads activation started, so teardown cannot pull workspace.json out from under them', async () => {
    // Activation makes the restored workspace active, and every listener on
    // that change (the status bar, the mock status bar) starts reading
    // workspace.json without anyone awaiting it. On a busy runner the read
    // can still be queued when the caller tears the folder down, and it then
    // fails with ENOENT long after the test that started it has ended. Hold
    // those reads open here so the ordering is certain rather than a race.
    const folder = path.join(tmp, 'repo-a');
    const apicircleRoot = path.join(folder, '.apicircle');
    const wsDir = path.join(apicircleRoot, 'workspace-ws-a');
    const workspaceJson = path.join(wsDir, 'workspace.json');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(workspaceJson, '{}');
    fs.writeFileSync(
      path.join(apicircleRoot, 'registry.json'),
      JSON.stringify({
        schemaVersion: 1,
        activeWorkspaceId: 'ws-a',
        workspaces: [{ id: 'ws-a', name: 'repo-a', createdAt: 't', lastOpenedAt: 't' }],
      }),
    );
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'repo-a', index: 0 },
    ];

    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const heldReads: Promise<unknown>[] = [];
    const readSpy = vi
      .spyOn(fs.promises, 'readFile')
      .mockImplementation((...args: Parameters<typeof fs.promises.readFile>) => {
        const target = args[0];
        if (typeof target !== 'string' || path.resolve(target) !== path.resolve(workspaceJson)) {
          return realReadFile(...args);
        }
        const held = gate.then(() => realReadFile(...args));
        heldReads.push(held);
        return held;
      });

    try {
      const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
      activate(ctx);
      expect(heldReads.length).toBeGreaterThan(0);

      // The teardown every test in this file runs: deactivate, then remove the
      // folder. Give deactivate a full turn of the event loop to finish
      // without the held reads.
      let deactivated = false;
      const teardown = deactivate().then(() => {
        deactivated = true;
        fs.rmSync(folder, { recursive: true, force: true });
      });
      await new Promise((resolve) => setImmediate(resolve));
      const finishedWithReadsInFlight = deactivated;

      release();
      await teardown;
      const outcomes = await Promise.allSettled(heldReads);

      expect(finishedWithReadsInFlight).toBe(false);
      expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
    } finally {
      release();
      readSpy.mockRestore();
    }
  });

  it('returns the public extension API (0e seam) exposing the bridge + fs provider', () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    const api = activate(ctx);

    expect(api.apiVersion).toBe(EXTENSION_API_VERSION);
    // The returned bridge is the live one — a companion (Enterprise) extension
    // drives the same workspaces through it.
    expect(api.bridge).toBe(__getInternalsForTests().bridge);
    // The apicircle:// virtual FS provider is exposed so a companion extension
    // can read/contribute virtual documents without re-implementing it.
    expect(api.fsProvider).toBeInstanceOf(ApicircleFsProvider);
  });
});
