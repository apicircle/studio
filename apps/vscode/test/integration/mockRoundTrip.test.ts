import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../mocks/vscode';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { ApicircleFsProvider } from '../../src/fs/apicircleFsProvider';

// =============================================================================
// Mock YAML round-trip integration test.
//
// Verifies: FS provider → mock.upsert → on-disk path.
//   1. Seed a workspace with one mock.
//   2. Read mocks/<id>.mock.yaml via the FS provider.
//   3. Mutate name + defaultPort + cors in the YAML.
//   4. Write back through the FS provider.
//   5. Read again — source + endpoints preserved (read-only), name +
//      defaultPort + cors updated.
//
// Also exercises the FS provider delete path firing `mock.delete`.
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

function seed(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'mrt',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {
        m1: {
          id: 'm1',
          name: 'Pet Store',
          source: { kind: 'openapi', spec: '{"openapi":"3.0.0"}', format: 'json' },
          endpoints: [
            {
              id: 'e1',
              method: 'GET',
              pathPattern: '/pets',
              name: 'list pets',
              requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
              requestValidation: [],
              responseRules: [],
              defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '[]' } },
            },
          ],
          defaultPort: 3000,
          cors: { enabled: false, origins: [] },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      },
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('mock YAML round-trip (FS provider integration)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let fsProvider: ApicircleFsProvider;
  let apicircleDir: string;

  // The mockUri builder now takes the MockServer object so it can put the
  // slugified name in the URI basename. Look the mock up from the bridge so
  // each call site doesn't need to reach into the seed fixture by hand.
  async function mockUriFor(id: string) {
    const state = await bridge.activeWorkspace()!.read();
    const mock = state.synced.mockServers[id];
    if (!mock) throw new Error(`Mock ${id} not seeded`);
    return ApicircleFsProvider.mockUri(apicircleDir, mock);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-rt-'));
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
    fsProvider = new ApicircleFsProvider(bridge);
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('serializes a mock to YAML via the FS provider', async () => {
    const uri = await mockUriFor('m1');
    const buf = await fsProvider.readFile(uri);
    const yaml = Buffer.from(buf).toString('utf8');
    expect(yaml).toContain('name: Pet Store');
    expect(yaml).toContain('defaultPort: 3000');
    expect(yaml).toContain('kind: openapi');
    expect(yaml).toContain('pathPattern: /pets');
  });

  it('round-trips: serialize → mutate name + port + cors → write → re-read', async () => {
    const uri = await mockUriFor('m1');
    const original = Buffer.from(await fsProvider.readFile(uri)).toString('utf8');
    const mutated = original
      .replace('name: Pet Store', 'name: Pet Store (v2)')
      .replace('defaultPort: 3000', 'defaultPort: 4040')
      .replace('enabled: false', 'enabled: true');
    await fsProvider.writeFile(uri, Buffer.from(mutated, 'utf8'), {
      create: false,
      overwrite: true,
    });
    const state = await bridge.activeWorkspace()!.read();
    expect(state.synced.mockServers.m1.name).toBe('Pet Store (v2)');
    expect(state.synced.mockServers.m1.defaultPort).toBe(4040);
    expect(state.synced.mockServers.m1.cors.enabled).toBe(true);
  });

  it('preserves source + endpoints (read-only) on update', async () => {
    const uri = await mockUriFor('m1');
    const original = Buffer.from(await fsProvider.readFile(uri)).toString('utf8');
    const mutated = original.replace('name: Pet Store', 'name: Renamed');
    await fsProvider.writeFile(uri, Buffer.from(mutated, 'utf8'), {
      create: false,
      overwrite: true,
    });
    const state = await bridge.activeWorkspace()!.read();
    expect(state.synced.mockServers.m1.source.kind).toBe('openapi');
    expect(state.synced.mockServers.m1.endpoints).toHaveLength(1);
    expect(state.synced.mockServers.m1.endpoints[0].pathPattern).toBe('/pets');
  });

  it('throws NoPermissions when YAML port is out of range', async () => {
    const uri = await mockUriFor('m1');
    const original = Buffer.from(await fsProvider.readFile(uri)).toString('utf8');
    const mutated = original.replace('defaultPort: 3000', 'defaultPort: 80');
    await expect(
      fsProvider.writeFile(uri, Buffer.from(mutated, 'utf8'), { create: false, overwrite: true }),
    ).rejects.toThrow(/1024-65535/);
  });

  it('delete on mocks/<id>.mock.yaml fires mock.delete', async () => {
    const uri = await mockUriFor('m1');
    await fsProvider.delete(uri, { recursive: false });
    const state = await bridge.activeWorkspace()!.read();
    expect(state.synced.mockServers.m1).toBeUndefined();
  });
});
