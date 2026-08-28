import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { MockServer } from '@apicircle/shared';
import { Uri, window, commands, workspace, env as mockEnv } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { VsCodeMockController } from '../host/vscodeMockController';
import {
  newMockCommand,
  startMockCommand,
  stopMockCommand,
  restartMockCommand,
  deleteMockCommand,
  copyEndpointPathCommand,
  revealEndpointInMockYamlCommand,
  setMockPortCommand,
  openMockEndpointYamlCommand,
  openMockInBrowserCommand,
} from './mockActions';

vi.mock('@apicircle/core/providers', () => ({
  InProcessMockController: class {
    started = new Map<string, { port: number; pid: number; startedAt: string }>();
    async start(server: { id: string }, _opts: { port?: number }) {
      const r = { port: 3000, pid: 42, startedAt: '2026-01-01T00:00:00Z' };
      this.started.set(server.id, r);
      return r;
    }
    async stop(id: string) {
      this.started.delete(id);
    }
    async list() {
      return Array.from(this.started.entries()).map(([serverId, runtime]) => ({
        serverId,
        runtime: { ...runtime, lastError: null, requestCount: 0 },
      }));
    }
  },
}));

vi.mock('@apicircle/mock-server-core', () => ({
  parseSourceToEndpoints: vi.fn().mockResolvedValue({ endpoints: [], warnings: [] }),
}));

function makeMockContext(globalStoragePath: string) {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T) =>
        state.has(key) ? (state.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => Array.from(state.keys()),
    },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
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
  } as never;
}

function seed(apicircleDir: string, mock?: MockServer): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const mockServers: Record<string, MockServer> = mock ? { [mock.id]: mock } : {};
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'mact',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers,
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

function makeMock(over: Partial<MockServer> = {}): MockServer {
  return {
    id: 'm1',
    name: 'Pet Store',
    source: { kind: 'manual', endpoints: [] },
    endpoints: [],
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  };
}

function makeMockWithEndpoint(): MockServer {
  return makeMock({
    endpoints: [
      {
        id: 'ep-1',
        method: 'GET',
        pathPattern: '/pets',
        name: 'list pets',
        requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
        requestValidation: [],
        responseRules: [],
        defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '[]' } },
      },
    ],
  });
}

describe('mockActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let controller: VsCodeMockController;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mockact-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seed(apicircleDir);
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
      source: 'git-folder',
    });
    bridge.setActive(apicircleDir);
    controller = new VsCodeMockController({
      getActiveSurface: () => bridge.activeWorkspace() ?? undefined,
    });
    (window.showQuickPick as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
    (window.showOpenDialog as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
    // P3R3-G6: reset clipboard so leaked calls from prior tests don't
    // pollute writeText assertion counts.
    (mockEnv.clipboard.writeText as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('newMockCommand', () => {
    it('warns when no workspace is active', async () => {
      bridge.dispose();
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      controller = new VsCodeMockController({
        getActiveSurface: () => bridge.activeWorkspace() ?? undefined,
      });
      await newMockCommand({ bridge, controller });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('cancels gracefully at source pick', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });

    it('creates a manual mock with empty endpoints', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'manual' });
      (window.showInputBox as Mock).mockResolvedValueOnce('My Manual'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port (free)
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      const ids = Object.keys(state.synced.mockServers);
      expect(ids).toHaveLength(1);
      const m = state.synced.mockServers[ids[0]];
      expect(m.name).toBe('My Manual');
      expect(m.source.kind).toBe('manual');
      expect(m.defaultPort).toBeNull();
    });

    it('creates an OpenAPI mock via paste (5-step flow)', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      // Step 2: method pick — paste
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      // Step 3: paste content
      (window.showInputBox as Mock).mockResolvedValueOnce('{"openapi":"3.0"}');
      // Step 4: name
      (window.showInputBox as Mock).mockResolvedValueOnce('My Pet Store');
      // Step 5: port
      (window.showInputBox as Mock).mockResolvedValueOnce('4040');
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      const m = Object.values(state.synced.mockServers)[0];
      expect(m.source.kind).toBe('openapi');
      expect(m.defaultPort).toBe(4040);
    });

    it('P3R5-G4: creates an OpenAPI mock by reading from a file', async () => {
      // Write a real spec to disk
      const specPath = path.join(tmp, 'pet-store.yaml');
      fs.writeFileSync(specPath, 'openapi: 3.0.0\ninfo:\n  title: Pet Store\n');
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'file' });
      // showOpenDialog returns a Uri[]
      (window.showOpenDialog as Mock).mockResolvedValueOnce([Uri.file(specPath)]);
      (window.showInputBox as Mock).mockResolvedValueOnce('Pet Store from file'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port (free)
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      const m = Object.values(state.synced.mockServers)[0];
      expect(m.source.kind).toBe('openapi');
      if (m.source.kind === 'openapi') {
        expect(m.source.spec).toContain('Pet Store');
        expect(m.source.format).toBe('yaml');
      }
    });

    it('P3R5-G4: cancels gracefully when the file picker is dismissed', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'file' });
      (window.showOpenDialog as Mock).mockResolvedValueOnce(undefined);
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });

    it('P3R6-G1: cancels gracefully when the method-pick (paste vs file) is dismissed', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      // Step 2 — paste-vs-file pick dismissed.
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
      // No content prompt should have been reached.
      expect(window.showInputBox).not.toHaveBeenCalled();
      expect(window.showOpenDialog).not.toHaveBeenCalled();
    });

    it('P3R5-G4: surfaces an error toast when the picked file is unreadable', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'file' });
      (window.showOpenDialog as Mock).mockResolvedValueOnce([
        Uri.file(path.join(tmp, 'does-not-exist.yaml')),
      ]);
      await newMockCommand({ bridge, controller });
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read'),
      );
    });

    it('rejects out-of-range default port via validateInput', async () => {
      // Manual flow is 3 steps (kind → name → port).
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'manual' });
      (window.showInputBox as Mock).mockResolvedValueOnce('m');
      let validator: ((s: string) => string | null) | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          validator = opts.validateInput;
          return undefined;
        },
      );
      await newMockCommand({ bridge, controller });
      expect(validator?.('80')).toBe('Port must be 1024-65535');
      expect(validator?.('abc')).toBe('Enter an integer port number or leave blank');
      expect(validator?.('3000')).toBeNull();
      expect(validator?.('')).toBeNull();
    });
  });

  describe('startMockCommand', () => {
    it('warns when no mocks exist (palette path)', async () => {
      await startMockCommand({ bridge, controller });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No mock servers'),
      );
    });

    it('P3R1-G8: surfaces an error toast when controller.start throws (port conflict)', async () => {
      seed(apicircleDir, makeMock());
      // Spy on the controller method to inject a port-conflict error.
      const original = controller.start.bind(controller);
      controller.start = async () => {
        throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:3000');
      };
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('EADDRINUSE'));
      controller.start = original;
    });

    it('starts via node arg and writes runtime entry', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.mockRuntime.active.m1?.port).toBe(3000);
    });

    it('reports "already running" when the controller already has this id', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      (window.showInformationMessage as Mock).mockReset();
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('already running'),
      );
    });
  });

  describe('stopMockCommand', () => {
    it('warns when mock is not running', async () => {
      seed(apicircleDir, makeMock());
      await stopMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('not running'),
      );
    });

    it('stops a running mock and clears runtime', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      await stopMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.mockRuntime.active.m1).toBeUndefined();
    });
  });

  describe('restartMockCommand', () => {
    it('stops then starts again', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      await restartMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.mockRuntime.active.m1?.port).toBe(3000);
    });
  });

  describe('copyEndpointPathCommand (P3R2-G4)', () => {
    it('warns when called without a node', async () => {
      await copyEndpointPathCommand({ bridge, controller });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Right-click an endpoint'),
      );
    });

    it('warns when endpoint no longer exists', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      await copyEndpointPathCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ghost' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Endpoint no longer'),
      );
    });

    it('writes the pathPattern to the system clipboard', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      await copyEndpointPathCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ep-1' },
      );
      expect(mockEnv.clipboard.writeText).toHaveBeenCalledWith('/pets');
      expect(window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('/pets'));
    });
  });

  describe('revealEndpointInMockYamlCommand (P3R2-G4)', () => {
    it('warns when called without a node', async () => {
      await revealEndpointInMockYamlCommand({ bridge, controller });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Right-click an endpoint'),
      );
    });

    it('warns when mock no longer exists', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      await revealEndpointInMockYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'ghost-mock', endpointId: 'ep-1' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Mock no longer'),
      );
    });

    it('warns when endpoint no longer exists', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      await revealEndpointInMockYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ghost-ep' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Endpoint no longer'),
      );
    });

    it('opens the mock YAML document via workspace.openTextDocument', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      const mockDoc = {
        lineCount: 5,
        lineAt: (line: number) => ({
          text: line === 2 ? '  - id: ep-1' : `# line ${line}`,
        }),
      };
      (workspace.openTextDocument as Mock).mockResolvedValueOnce(mockDoc);
      const revealRange = vi.fn();
      (window.showTextDocument as Mock).mockResolvedValueOnce({
        selection: {},
        revealRange,
      });
      await revealEndpointInMockYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ep-1' },
      );
      expect(workspace.openTextDocument).toHaveBeenCalled();
      expect(window.showTextDocument).toHaveBeenCalled();
      // P3R3-G4: assert revealRange was called with line 2 (where 'id: ep-1' lives)
      expect(revealRange).toHaveBeenCalled();
      const [rangeArg] = revealRange.mock.calls[0] as [{ start: { line: number } }];
      expect(rangeArg.start.line).toBe(2);
    });

    it('P3R3-G4: falls back to line 0 when the endpoint id line cannot be located', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      const mockDoc = {
        lineCount: 3,
        lineAt: (line: number) => ({ text: `# line ${line} — no id here` }),
      };
      (workspace.openTextDocument as Mock).mockResolvedValueOnce(mockDoc);
      const revealRange = vi.fn();
      (window.showTextDocument as Mock).mockResolvedValueOnce({
        selection: {},
        revealRange,
      });
      await revealEndpointInMockYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ep-1' },
      );
      const [rangeArg] = revealRange.mock.calls[0] as [{ start: { line: number } }];
      expect(rangeArg.start.line).toBe(0);
    });
  });

  describe('deleteMockCommand', () => {
    it('cancels gracefully when user declines', async () => {
      seed(apicircleDir, makeMock());
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deleteMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.mockServers.m1).toBeDefined();
    });

    it('removes the mock on confirmation', async () => {
      seed(apicircleDir, makeMock());
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.mockServers.m1).toBeUndefined();
    });

    it('auto-stops a running mock before deleting', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.mockServers.m1).toBeUndefined();
      expect(state.local.mockRuntime.active.m1).toBeUndefined();
    });
  });

  describe('setMockPortCommand', () => {
    it('persists a valid port via mock.upsert', async () => {
      seed(apicircleDir, makeMock());
      (window.showInputBox as Mock).mockResolvedValueOnce('4040');
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.mockServers.m1.defaultPort).toBe(4040);
    });

    it('clears the port (null) when input is blank', async () => {
      seed(apicircleDir, makeMock({ defaultPort: 5000 }));
      (window.showInputBox as Mock).mockResolvedValueOnce('');
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.mockServers.m1.defaultPort).toBeNull();
    });

    it('rejects out-of-range port via validateInput', async () => {
      seed(apicircleDir, makeMock());
      let validator: ((s: string) => string | null) | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          validator = opts.validateInput;
          return undefined;
        },
      );
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(validator?.('22')).toBe('Port must be 1024-65535');
      expect(validator?.('abc')).toBe('Enter an integer port number or leave blank');
      expect(validator?.('3000')).toBeNull();
      expect(validator?.('')).toBeNull();
    });

    it('warns when the mock no longer exists', async () => {
      seed(apicircleDir);
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'ghost' });
      // Node arg short-circuits the QuickPick — fall through to the
      // "Mock no longer exists." branch in setMockPortCommand.
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Mock no longer exists.'),
      );
    });

    it('cancels gracefully when the input is dismissed', async () => {
      seed(apicircleDir, makeMock({ defaultPort: 3030 }));
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const state = await bridge.activeWorkspace()!.read();
      // Unchanged — caller dismissed.
      expect(state.synced.mockServers.m1.defaultPort).toBe(3030);
    });

    it('is a no-op when the entered port matches the current port', async () => {
      seed(apicircleDir, makeMock({ defaultPort: 3030 }));
      const before = await bridge.activeWorkspace()!.read();
      const beforeUpdated = before.synced.mockServers.m1.updatedAt;
      (window.showInputBox as Mock).mockResolvedValueOnce('3030');
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const after = await bridge.activeWorkspace()!.read();
      expect(after.synced.mockServers.m1.defaultPort).toBe(3030);
      expect(after.synced.mockServers.m1.updatedAt).toBe(beforeUpdated);
    });
  });

  describe('additional lifecycle coverage', () => {
    it('newMockCommand exits silently when source-kind picker is cancelled', async () => {
      seed(path.join(tmp, '.apicircle'));
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      bridge.registerWorkspace({
        id: path.join(tmp, '.apicircle'),
        apicircleDir: path.join(tmp, '.apicircle'),
        workspaceJsonPath: path.join(tmp, '.apicircle', 'workspace.json'),
        workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
        label: 't',
        source: 'git-folder',
      });
      bridge.setActive(path.join(tmp, '.apicircle'));
      controller = new VsCodeMockController({
        getActiveSurface: () => bridge.activeWorkspace() ?? undefined,
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toHaveLength(0);
    });
  });

  // =========================================================================
  // New tests — push line coverage above 90%
  // =========================================================================

  describe('openMockEndpointYamlCommand', () => {
    it('warns when called without a node', async () => {
      await openMockEndpointYamlCommand({ bridge, controller });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Right-click an endpoint'),
      );
    });

    it('warns when no active workspace', async () => {
      bridge.dispose();
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      controller = new VsCodeMockController({
        getActiveSurface: () => bridge.activeWorkspace() ?? undefined,
      });
      await openMockEndpointYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ep-1' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('warns when mock no longer exists', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      await openMockEndpointYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'ghost', endpointId: 'ep-1' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Mock no longer'),
      );
    });

    it('warns when endpoint no longer exists', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      await openMockEndpointYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ghost-ep' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Endpoint no longer'),
      );
    });

    it('opens the endpoint YAML via vscode.open', async () => {
      seed(apicircleDir, makeMockWithEndpoint());
      await openMockEndpointYamlCommand(
        { bridge, controller },
        { kind: 'endpoint', serverId: 'm1', endpointId: 'ep-1' },
      );
      expect(commands.executeCommand).toHaveBeenCalledWith(
        'vscode.open',
        expect.objectContaining({ scheme: 'apicircle' }),
      );
    });
  });

  describe('openMockInBrowserCommand', () => {
    it('warns when mock is not running', async () => {
      seed(apicircleDir, makeMock());
      await openMockInBrowserCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Start the mock first'),
      );
    });

    it('opens the running mock URL in the system browser', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      (window.showInformationMessage as Mock).mockReset();
      await openMockInBrowserCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(mockEnv.openExternal).toHaveBeenCalledWith(
        expect.objectContaining({ scheme: 'http' }),
      );
    });

    it('resolves mock id via QuickPick when no node is passed', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      (window.showInformationMessage as Mock).mockReset();
      // Palette path — pick from the mock list
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Pet Store', id: 'm1' });
      await openMockInBrowserCommand({ bridge, controller });
      expect(mockEnv.openExternal).toHaveBeenCalled();
    });

    it('exits when resolveMockId returns undefined (no mocks)', async () => {
      // No mocks seeded
      await openMockInBrowserCommand({ bridge, controller });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No mock servers'),
      );
    });
  });

  describe('newMockCommand — URL flow', () => {
    it('creates a mock by fetching from a URL', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: async () => '{"openapi":"3.0.0","info":{"title":"URL Mock"}}',
      }) as unknown as typeof fetch;
      try {
        (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
        (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'url' });
        (window.showInputBox as Mock).mockResolvedValueOnce('https://example.com/spec.json');
        (window.showInputBox as Mock).mockResolvedValueOnce('URL Mock'); // name
        (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
        await newMockCommand({ bridge, controller });
        const state = await bridge.activeWorkspace()!.read();
        const m = Object.values(state.synced.mockServers)[0];
        expect(m.source.kind).toBe('openapi');
        if (m.source.kind === 'openapi') {
          expect(m.source.format).toBe('json');
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('shows error when fetch returns non-ok status', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }) as unknown as typeof fetch;
      try {
        (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
        (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'url' });
        (window.showInputBox as Mock).mockResolvedValueOnce('https://example.com/missing.json');
        await newMockCommand({ bridge, controller });
        expect(window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining('Fetch failed (404'),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('shows error when fetch throws a network error', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED')) as unknown as typeof fetch;
      try {
        (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
        (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'url' });
        (window.showInputBox as Mock).mockResolvedValueOnce('https://example.com/spec.json');
        await newMockCommand({ bridge, controller });
        expect(window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining('Failed to fetch'),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('cancels when URL input is dismissed', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'url' });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined); // URL dismissed
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });

    it('validates URL input', async () => {
      let validator: ((s: string) => string | null) | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'url' });
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          validator = opts.validateInput;
          return undefined;
        },
      );
      await newMockCommand({ bridge, controller });
      expect(validator?.('')).toBe('URL is required');
      expect(validator?.('  ')).toBe('URL is required');
      expect(validator?.('ftp://bad')).toBe('URL must start with http:// or https://');
      expect(validator?.('https://ok.com')).toBeNull();
    });
  });

  describe('newMockCommand — Postman source', () => {
    it('creates a Postman-sourced mock via paste', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'postman' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce(
        '{"info":{"name":"My Postman Collection"}}',
      );
      (window.showInputBox as Mock).mockResolvedValueOnce('Postman Mock'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      const m = Object.values(state.synced.mockServers)[0];
      expect(m.source.kind).toBe('postman');
      if (m.source.kind === 'postman') {
        expect(m.source.collection).toContain('My Postman Collection');
      }
      expect(m.name).toBe('Postman Mock');
    });
  });

  describe('newMockCommand — Insomnia source', () => {
    it('creates an Insomnia-sourced mock via paste', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'insomnia' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce(
        '{"resources":[{"_type":"workspace","name":"Insomnia WS"}]}',
      );
      (window.showInputBox as Mock).mockResolvedValueOnce('Insomnia Mock'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      const m = Object.values(state.synced.mockServers)[0];
      expect(m.source.kind).toBe('insomnia');
      if (m.source.kind === 'insomnia') {
        expect(m.source.export).toContain('Insomnia WS');
      }
    });
  });

  describe('newMockCommand — paste cancel and validate', () => {
    it('cancels when paste input is dismissed', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined); // paste dismissed
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });

    it('validates paste content is non-empty', async () => {
      let validator: ((s: string) => string | null) | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          validator = opts.validateInput;
          return undefined;
        },
      );
      await newMockCommand({ bridge, controller });
      expect(validator?.('')).toBe('Source content is required');
      expect(validator?.('   ')).toBe('Source content is required');
      expect(validator?.('{"ok":true}')).toBeNull();
    });
  });

  describe('newMockCommand — name and port cancellation', () => {
    it('cancels when name input is dismissed (manual flow)', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'manual' });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined); // name dismissed
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });

    it('cancels when port input is dismissed (manual flow)', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'manual' });
      (window.showInputBox as Mock).mockResolvedValueOnce('A Mock'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined); // port dismissed
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });

    it('validates name is non-empty', async () => {
      let validator: ((s: string) => string | null) | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'manual' });
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          validator = opts.validateInput;
          return undefined;
        },
      );
      await newMockCommand({ bridge, controller });
      expect(validator?.('')).toBe('Name is required');
      expect(validator?.('  ')).toBe('Name is required');
      expect(validator?.('Valid Name')).toBeNull();
    });
  });

  describe('newMockCommand — parse warnings and errors', () => {
    it('shows warning toast when parser returns warnings', async () => {
      const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
      (parseSourceToEndpoints as Mock).mockResolvedValueOnce({
        endpoints: [],
        warnings: ['Unknown path type', 'Duplicate operation id'],
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce('openapi: 3.0.0');
      (window.showInputBox as Mock).mockResolvedValueOnce('Warn Mock'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('2 warning(s)'),
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('+1 more'));
    });

    it('shows warning without "+N more" for a single warning', async () => {
      const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
      (parseSourceToEndpoints as Mock).mockResolvedValueOnce({
        endpoints: [],
        warnings: ['Single warning here'],
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce('openapi: 3.0.0');
      (window.showInputBox as Mock).mockResolvedValueOnce('One Warn Mock'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('1 warning(s)'),
      );
      // Ensure no "+N more" suffix
      const call = (window.showWarningMessage as Mock).mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('warning(s)'),
      );
      expect(call?.[0]).not.toContain('+');
    });

    it('shows error toast and aborts when parser throws', async () => {
      const mod = await import('@apicircle/mock-server-core');
      (mod.parseSourceToEndpoints as Mock).mockRejectedValueOnce(new Error('Invalid YAML'));
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce('bad yaml %%%');
      (window.showInputBox as Mock).mockResolvedValueOnce('Bad Mock'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse openapi source'),
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });
  });

  describe('newMockCommand — name suggestion from source', () => {
    it('suggests name from OpenAPI JSON spec', async () => {
      let nameValue: string | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce(
        '{"openapi":"3.0.0","info":{"title":"My Pet API"}}',
      );
      // Capture the value pre-filled in the name input
      (window.showInputBox as Mock).mockImplementationOnce(async (opts: { value?: string }) => {
        nameValue = opts.value;
        return opts.value ?? 'fallback';
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(nameValue).toBe('My Pet API');
    });

    it('suggests name from OpenAPI YAML spec via title regex', async () => {
      let nameValue: string | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce(
        'openapi: 3.0.0\ninfo:\n  title: YAML Title Mock',
      );
      (window.showInputBox as Mock).mockImplementationOnce(async (opts: { value?: string }) => {
        nameValue = opts.value;
        return opts.value ?? 'fallback';
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(nameValue).toBe('YAML Title Mock');
    });

    it('suggests name from Postman collection info.name', async () => {
      let nameValue: string | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'postman' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce(
        '{"info":{"name":"Postman Collection Name"}}',
      );
      (window.showInputBox as Mock).mockImplementationOnce(async (opts: { value?: string }) => {
        nameValue = opts.value;
        return opts.value ?? 'fallback';
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(nameValue).toBe('Postman Collection Name');
    });

    it('suggests name from Insomnia export workspace resource', async () => {
      let nameValue: string | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'insomnia' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce(
        '{"resources":[{"_type":"workspace","name":"Insomnia WS Name"}]}',
      );
      (window.showInputBox as Mock).mockImplementationOnce(async (opts: { value?: string }) => {
        nameValue = opts.value;
        return opts.value ?? 'fallback';
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(nameValue).toBe('Insomnia WS Name');
    });

    it('falls back to empty string when JSON source is unparseable', async () => {
      let nameValue: string | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'postman' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce('not json at all');
      (window.showInputBox as Mock).mockImplementationOnce(async (opts: { value?: string }) => {
        nameValue = opts.value;
        return opts.value ?? 'fallback';
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(nameValue).toBe('');
    });

    it('uses "Manual mock" default name for manual source', async () => {
      let nameValue: string | undefined;
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'manual' });
      (window.showInputBox as Mock).mockImplementationOnce(async (opts: { value?: string }) => {
        nameValue = opts.value;
        return opts.value ?? 'fallback';
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(nameValue).toBe('Manual mock');
    });
  });

  describe('newMockCommand — large file warning', () => {
    it('proceeds after user confirms large file warning', async () => {
      // Write a spec file (we fake the size by actually writing 11 MB)
      const specPath = path.join(tmp, 'large-spec.json');
      const content = '{"openapi":"3.0.0","info":{"title":"Big"}}';
      // Write real content — the file size gate checks stat.size, so pad it.
      const padding = Buffer.alloc(11 * 1024 * 1024, ' ');
      fs.writeFileSync(specPath, content + padding.toString());

      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'file' });
      (window.showOpenDialog as Mock).mockResolvedValueOnce([Uri.file(specPath)]);
      // User confirms "Continue" on the large-file warning
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Continue');
      (window.showInputBox as Mock).mockResolvedValueOnce('Big Mock'); // name
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // port
      await newMockCommand({ bridge, controller });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('MB'),
        expect.objectContaining({ modal: true }),
        'Continue',
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toHaveLength(1);
    });

    it('aborts when user declines large file warning', async () => {
      const specPath = path.join(tmp, 'large-spec2.json');
      const padding = Buffer.alloc(11 * 1024 * 1024, ' ');
      fs.writeFileSync(specPath, '{}' + padding.toString());

      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'file' });
      (window.showOpenDialog as Mock).mockResolvedValueOnce([Uri.file(specPath)]);
      // User declines
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });

    it('cancels when file picker returns empty array', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'file' });
      (window.showOpenDialog as Mock).mockResolvedValueOnce([]);
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.mockServers)).toEqual([]);
    });
  });

  describe('startMockCommand — edge cases', () => {
    it('warns when mock no longer exists', async () => {
      seed(apicircleDir); // no mocks
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Mock no longer exists'),
      );
    });

    it('resolves via QuickPick when called from palette', async () => {
      seed(apicircleDir, makeMock());
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Pet Store', id: 'm1' });
      await startMockCommand({ bridge, controller });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Started'),
      );
    });

    it('returns undefined from QuickPick when picker is cancelled', async () => {
      seed(apicircleDir, makeMock());
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await startMockCommand({ bridge, controller });
      // No start or error should have occurred — command just exits.
      expect(window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('accepts mock-running node kind', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'mock-idle', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Started'),
      );
    });
  });

  describe('stopMockCommand — error path', () => {
    it('shows error toast when controller.stop throws', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      const original = controller.stop.bind(controller);
      controller.stop = async () => {
        throw new Error('Permission denied');
      };
      await stopMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop mock'),
      );
      controller.stop = original;
    });
  });

  describe('restartMockCommand — edge cases', () => {
    it('warns when mock no longer exists', async () => {
      seed(apicircleDir); // no mocks
      await restartMockCommand({ bridge, controller }, { kind: 'server', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Mock no longer exists'),
      );
    });

    it('shows error toast when controller.restart throws', async () => {
      seed(apicircleDir, makeMock());
      const original = controller.restart.bind(controller);
      controller.restart = async () => {
        throw new Error('Port busy');
      };
      await restartMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to restart mock'),
      );
      controller.restart = original;
    });
  });

  describe('deleteMockCommand — edge cases', () => {
    it('warns when mock no longer exists', async () => {
      seed(apicircleDir); // no mocks
      await deleteMockCommand({ bridge, controller }, { kind: 'server', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Mock no longer exists'),
      );
    });

    it('resolves via QuickPick when called from palette', async () => {
      seed(apicircleDir, makeMock());
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Pet Store', id: 'm1' });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.mockServers.m1).toBeUndefined();
    });
  });

  describe('setMockPortCommand — additional branches', () => {
    it('shows running-mock hint in prompt when mock is running', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      let promptText: string | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(async (opts: { prompt?: string }) => {
        promptText = opts.prompt;
        return undefined;
      });
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(promptText).toContain('currently running');
    });

    it('shows free-port message when port is set to null', async () => {
      seed(apicircleDir, makeMock({ defaultPort: 5000 }));
      (window.showInputBox as Mock).mockResolvedValueOnce('  '); // blank = null
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('pick a free port'),
      );
    });

    it('shows specific port in message when port is set to a number', async () => {
      seed(apicircleDir, makeMock());
      (window.showInputBox as Mock).mockResolvedValueOnce('8080');
      await setMockPortCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('8080'));
    });

    it('resolves via QuickPick when called from palette', async () => {
      seed(apicircleDir, makeMock());
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Pet Store', id: 'm1' });
      (window.showInputBox as Mock).mockResolvedValueOnce('9090');
      await setMockPortCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.mockServers.m1.defaultPort).toBe(9090);
    });
  });

  describe('newMockCommand — endpoint count in success message', () => {
    it('shows singular "endpoint" for exactly 1 endpoint', async () => {
      const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
      (parseSourceToEndpoints as Mock).mockResolvedValueOnce({
        endpoints: [
          {
            id: 'e1',
            method: 'GET',
            pathPattern: '/test',
            name: 'test',
            requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
            requestValidation: [],
            responseRules: [],
            defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '{}' } },
          },
        ],
        warnings: [],
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce('{"openapi":"3.0"}');
      (window.showInputBox as Mock).mockResolvedValueOnce('One EP Mock');
      (window.showInputBox as Mock).mockResolvedValueOnce('');
      await newMockCommand({ bridge, controller });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('1 endpoint.'),
      );
    });

    it('shows plural "endpoints" for 0 endpoints', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'manual' });
      (window.showInputBox as Mock).mockResolvedValueOnce('Empty Mock');
      (window.showInputBox as Mock).mockResolvedValueOnce('');
      await newMockCommand({ bridge, controller });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('0 endpoints'),
      );
    });
  });

  describe('resolveMockId — node kind variations', () => {
    it('accepts mock-running kind', async () => {
      seed(apicircleDir, makeMock());
      await startMockCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
      (window.showInformationMessage as Mock).mockReset();
      await stopMockCommand({ bridge, controller }, { kind: 'mock-running', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Mock stopped'),
      );
    });

    it('accepts mock-idle kind', async () => {
      seed(apicircleDir, makeMock());
      await stopMockCommand({ bridge, controller }, { kind: 'mock-idle', id: 'm1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('not running'),
      );
    });
  });

  describe('newMockCommand — OpenAPI YAML format detection', () => {
    it('detects JSON format for JSON-opening content', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce('{"openapi":"3.0.0"}');
      (window.showInputBox as Mock).mockResolvedValueOnce('JSON Spec');
      (window.showInputBox as Mock).mockResolvedValueOnce('');
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      const m = Object.values(state.synced.mockServers)[0];
      if (m.source.kind === 'openapi') {
        expect(m.source.format).toBe('json');
      }
    });

    it('detects YAML format for non-JSON-opening content', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'openapi' });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'paste' });
      (window.showInputBox as Mock).mockResolvedValueOnce('openapi: 3.0.0\ninfo:\n  title: t');
      (window.showInputBox as Mock).mockResolvedValueOnce('YAML Spec');
      (window.showInputBox as Mock).mockResolvedValueOnce('');
      await newMockCommand({ bridge, controller });
      const state = await bridge.activeWorkspace()!.read();
      const m = Object.values(state.synced.mockServers)[0];
      if (m.source.kind === 'openapi') {
        expect(m.source.format).toBe('yaml');
      }
    });
  });
});
