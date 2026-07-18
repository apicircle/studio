import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { MockServer } from '@apicircle/shared';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { VsCodeMockController } from '../host/vscodeMockController';
import { addAllToCollectionCommand, addEndpointToCollectionCommand } from './promoteMockActions';

vi.mock('@apicircle/mcp-server', () => ({
  InProcessMockController: class {
    async start() {
      return { port: 3000, pid: 42, startedAt: '2026-01-01T00:00:00Z' };
    }
    async stop() {}
    async list() {
      return [];
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

function seed(apicircleDir: string, mock: MockServer): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'promote',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: { [mock.id]: mock },
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

function makeMockWithEndpoint(): MockServer {
  return {
    id: 'm1',
    name: 'Pet Store',
    source: { kind: 'manual', endpoints: [] },
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
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

describe('promoteMockActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let controller: VsCodeMockController;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promote-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seed(apicircleDir, makeMockWithEndpoint());
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
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('addAllToCollection creates the active Mock env + "<name> (mock)" folder + a request per endpoint', async () => {
    await addAllToCollectionCommand({ bridge, controller }, { kind: 'server', id: 'm1' });
    const s = (await bridge.activeWorkspace()!.read()).synced;
    expect(s.environments.activeName).toBe('Mock');
    expect(s.environments.items['Mock'].variables.find((v) => v.key === 'MOCK_PORT')?.value).toBe(
      '8080',
    );
    const folder = Object.values(s.collections.folders).find((f) => f.name === 'Pet Store (mock)');
    expect(folder).toBeTruthy();
    const reqs = Object.values(s.collections.requests).filter((r) => r.folderId === folder!.id);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].url).toBe('{{MOCK_BASE_URL}}:{{MOCK_PORT}}/pets');
  });

  it('addEndpointToCollection promotes a single endpoint into the folder', async () => {
    await addEndpointToCollectionCommand(
      { bridge, controller },
      { kind: 'endpoint', serverId: 'm1', endpointId: 'ep-1' },
    );
    const s = (await bridge.activeWorkspace()!.read()).synced;
    const folder = Object.values(s.collections.folders).find((f) => f.name === 'Pet Store (mock)');
    expect(folder).toBeTruthy();
    const reqs = Object.values(s.collections.requests).filter((r) => r.folderId === folder!.id);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].url).toBe('{{MOCK_BASE_URL}}:{{MOCK_PORT}}/pets');
  });

  it('warns and does nothing when invoked without a mock node', async () => {
    await addAllToCollectionCommand({ bridge, controller });
    expect(window.showWarningMessage).toHaveBeenCalled();
    const s = (await bridge.activeWorkspace()!.read()).synced;
    expect(Object.keys(s.collections.requests)).toHaveLength(0);
  });
});
