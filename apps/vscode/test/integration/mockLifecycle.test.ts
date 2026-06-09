import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../mocks/vscode';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { VsCodeMockController } from '../../src/host/vscodeMockController';
import { ApicircleFsProvider } from '../../src/fs/apicircleFsProvider';
import {
  deleteMockCommand,
  startMockCommand,
  stopMockCommand,
} from '../../src/commands/mockActions';

// =============================================================================
// F-G2: Real Hono lifecycle integration test.
//
// Exercises VsCodeMockController against the REAL InProcessMockController
// (no mock) — spawns an actual Hono server, hits the endpoint with fetch,
// asserts the response, then stops the server and confirms the port is
// reclaimed. Catches regressions in the mock-server-core ↔ VS Code seam
// that the heavily-mocked unit suite can't see.
//
// F-G11: also covers the FS-provider delete path via the
// `apicircle.deleteMock` command (not just the direct FS provider call).
// =============================================================================

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

const PETSTORE_SPEC = `openapi: 3.0.0
info:
  title: Pet Store
  version: 1.0.0
paths:
  /pets:
    get:
      summary: list pets
      responses:
        '200':
          description: list of pets
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    id:
                      type: integer
                    name:
                      type: string
              example:
                - id: 1
                  name: Fido
`;

function seed(apicircleDir: string, withMock: boolean): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const mockServers: Record<string, unknown> = withMock
    ? {
        'mock-petstore': {
          id: 'mock-petstore',
          name: 'Pet Store',
          source: { kind: 'openapi', spec: PETSTORE_SPEC, format: 'yaml' },
          endpoints: [],
          defaultPort: null,
          cors: { enabled: false, origins: [] },
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      }
    : {};
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'mock-lifecycle',
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

describe('mock lifecycle (real Hono integration)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let controller: VsCodeMockController;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-lifecycle-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    controller = new VsCodeMockController({
      getActiveSurface: () => bridge.activeWorkspace() ?? undefined,
    });
  });

  afterEach(async () => {
    // Defensive cleanup — disposeAll stops every running server even if
    // the test failed mid-way.
    await controller.disposeAll();
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(): void {
    seed(apicircleDir, true);
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
  }

  it('F-G2: starts a real Hono server, serves the endpoint, stops cleanly', async () => {
    activate();
    const state = await bridge.activeWorkspace()!.read();
    const mock = state.synced.mockServers['mock-petstore'];
    expect(mock).toBeDefined();

    // Parse endpoints up-front (the wizard would do this; here we
    // simulate by importing parseSourceToEndpoints directly).
    const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
    const parsed = await parseSourceToEndpoints(mock.source);
    expect(parsed.endpoints.length).toBeGreaterThan(0);

    // Write back with parsed endpoints (mirroring the wizard's mock.upsert).
    await bridge.activeWorkspace()!.apply({
      kind: 'mock.upsert',
      mock: { ...mock, endpoints: parsed.endpoints },
    });

    // Now start through the REAL controller — no mocks.
    const result = await controller.start({ ...mock, endpoints: parsed.endpoints });
    expect(result.port).toBeGreaterThan(0);

    try {
      const response = await fetch(`http://localhost:${result.port}/pets`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
    } finally {
      await controller.stop('mock-petstore');
    }

    // After stop, the port should be reclaimable — attempt a fetch and
    // expect a connection error.
    let stoppedOk = false;
    try {
      await fetch(`http://localhost:${result.port}/pets`, { signal: AbortSignal.timeout(500) });
    } catch {
      stoppedOk = true;
    }
    expect(stoppedOk).toBe(true);
  }, 15_000);

  it('F-G2: start then stop is idempotent — second stop is a no-op', async () => {
    activate();
    const state = await bridge.activeWorkspace()!.read();
    const mock = state.synced.mockServers['mock-petstore'];
    const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
    const parsed = await parseSourceToEndpoints(mock.source);
    await controller.start({ ...mock, endpoints: parsed.endpoints });
    await controller.stop('mock-petstore');
    // Second stop must not throw.
    await expect(controller.stop('mock-petstore')).resolves.toBeUndefined();
  }, 15_000);

  it('F-G2: runtime entry is written to local on start, cleared on stop', async () => {
    activate();
    const state = await bridge.activeWorkspace()!.read();
    const mock = state.synced.mockServers['mock-petstore'];
    const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
    const parsed = await parseSourceToEndpoints(mock.source);
    await controller.start({ ...mock, endpoints: parsed.endpoints });
    const afterStart = await bridge.activeWorkspace()!.read();
    expect(afterStart.local.mockRuntime.active['mock-petstore']).toBeDefined();
    expect(afterStart.local.mockRuntime.active['mock-petstore'].port).toBeGreaterThan(0);

    await controller.stop('mock-petstore');
    const afterStop = await bridge.activeWorkspace()!.read();
    expect(afterStop.local.mockRuntime.active['mock-petstore']).toBeUndefined();
  }, 15_000);

  it('F-G11: deleteMock command stops the running mock and removes definition', async () => {
    activate();
    const state = await bridge.activeWorkspace()!.read();
    const mock = state.synced.mockServers['mock-petstore'];
    const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core');
    const parsed = await parseSourceToEndpoints(mock.source);
    await controller.start({ ...mock, endpoints: parsed.endpoints });
    // Confirm running
    expect(await controller.isRunning('mock-petstore')).toBe(true);

    // Simulate user clicking Delete (Confirmation mocked via window).
    const vscodeMock = await import('../mocks/vscode');
    (vscodeMock.window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
    await deleteMockCommand({ bridge, controller }, { kind: 'server', id: 'mock-petstore' });
    const after = await bridge.activeWorkspace()!.read();
    expect(after.synced.mockServers['mock-petstore']).toBeUndefined();
    expect(await controller.isRunning('mock-petstore')).toBe(false);
  }, 15_000);

  it('F-G11: FS provider delete on mocks/<id>.mock.yaml fires mock.delete', async () => {
    activate();
    const fsProvider = new ApicircleFsProvider(bridge);
    const uri = ApicircleFsProvider.mockUri(apicircleDir, 'mock-petstore');
    await fsProvider.delete(uri, { recursive: false });
    const after = await bridge.activeWorkspace()!.read();
    expect(after.synced.mockServers['mock-petstore']).toBeUndefined();
  });

  // F-G2: silence the dead-import warning by referencing the imports
  void startMockCommand;
  void stopMockCommand;
});
