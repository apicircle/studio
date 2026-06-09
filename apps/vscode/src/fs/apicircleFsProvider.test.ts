import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider, __encodeAuthorityForTests } from './apicircleFsProvider';
import { generateId } from '@apicircle/shared';
import type { Request } from '@apicircle/shared';

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
  } as never;
}

function seedWorkspaceWithRequest(apicircleDir: string, request: Request): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const now = new Date().toISOString();
  const synced = {
    schemaVersion: 1,
    workspaceId: 'test-ws',
    collections: {
      tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: request.id }] },
      requests: { [request.id]: request },
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    executionPlans: {},
    secretKeys: {},
    secretCrypto: null,
    meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
  };
  fs.writeFileSync(path.join(apicircleDir, 'workspace.json'), JSON.stringify(synced, null, 2));
}

function makeRequest(id = generateId()): Request {
  return {
    id,
    name: 'Get user',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/users/123',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('ApicircleFsProvider', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let provider: ApicircleFsProvider;
  let apicircleDir: string;
  let workspaceId: string;
  let requestId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-fs-'));
    apicircleDir = path.join(tmp, '.apicircle');
    requestId = generateId();
    seedWorkspaceWithRequest(apicircleDir, makeRequest(requestId));

    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    workspaceId = apicircleDir;
    bridge.registerWorkspace({
      id: workspaceId,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'test', index: 0 } as never,
      label: 'test',
    });
    bridge.setActive(workspaceId);
    provider = new ApicircleFsProvider(bridge);
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('requestUri()', () => {
    it('builds a canonical URI containing scheme + authority + path', () => {
      const uri = ApicircleFsProvider.requestUri('/some/.apicircle', 'req_xyz');
      expect(uri.scheme).toBe('apicircle');
      expect(uri.authority).toBe(__encodeAuthorityForTests('/some/.apicircle'));
      expect(uri.path).toBe('/requests/req_xyz.req.yaml');
    });
  });

  describe('readFile()', () => {
    it('serializes the stored request as YAML', async () => {
      const uri = ApicircleFsProvider.requestUri(workspaceId, requestId);
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('name: Get user');
      expect(text).toContain('method: GET');
      expect(text).toContain('url: https://api.example.com/users/123');
    });

    it('throws FileNotFound for an unknown request id', async () => {
      const uri = ApicircleFsProvider.requestUri(workspaceId, 'nonexistent');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('throws FileNotFound for an unknown workspace authority', async () => {
      const uri = ApicircleFsProvider.requestUri('/other/.apicircle', requestId);
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });
  });

  describe('writeFile()', () => {
    it('persists a name edit through applyMutation', async () => {
      const uri = ApicircleFsProvider.requestUri(workspaceId, requestId);
      const newYaml = `name: Renamed\nmethod: GET\nurl: https://api.example.com/users/123\n`;
      await provider.writeFile(uri as never, Buffer.from(newYaml, 'utf8'), {
        create: false,
        overwrite: true,
      });

      // Read disk directly to verify the round-trip went through to workspace.json
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { requests: Record<string, Request> } };
      expect(synced.collections.requests[requestId].name).toBe('Renamed');
    });

    it('throws NoPermissions on invalid YAML', async () => {
      const uri = ApicircleFsProvider.requestUri(workspaceId, requestId);
      await expect(
        provider.writeFile(uri as never, Buffer.from('::: !! ::', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/Invalid YAML/);
    });

    it('throws NoPermissions when required fields are missing', async () => {
      const uri = ApicircleFsProvider.requestUri(workspaceId, requestId);
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: x', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/method/);
    });
  });

  describe('delete()', () => {
    it('removes the request from the workspace', async () => {
      const uri = ApicircleFsProvider.requestUri(workspaceId, requestId);
      await provider.delete(uri as never, { recursive: false });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { requests: Record<string, unknown> } };
      expect(synced.collections.requests[requestId]).toBeUndefined();
    });
  });

  describe('rename()', () => {
    it('refuses with a helpful message — rename via name: field instead', () => {
      const uri = ApicircleFsProvider.requestUri(workspaceId, requestId);
      const other = ApicircleFsProvider.requestUri(workspaceId, 'other');
      expect(() => provider.rename(uri as never, other as never, { overwrite: false })).toThrow(
        /name:/,
      );
    });
  });

  describe('createDirectory()', () => {
    it('refuses — folders are managed via TreeView, not FS', () => {
      const uri = Uri.parse('apicircle://x/folders/y');
      expect(() => provider.createDirectory(uri as never)).toThrow(/TreeView/);
    });
  });
});
