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
} from './mockActions';

vi.mock('@apicircle/mcp-server', () => ({
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
});
