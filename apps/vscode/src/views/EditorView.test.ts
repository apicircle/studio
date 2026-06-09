import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import { generateId } from '@apicircle/shared';
import type { Folder, Request as ApiRequest } from '@apicircle/shared';
import { VsCodeBridge } from '../host/vscodeBridge';
import { EditorView, type EditorNode } from './EditorView';

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

function makeRequest(id: string, name: string, folderId: string | null = null): ApiRequest {
  return {
    id,
    name,
    folderId,
    method: 'GET',
    url: 'https://api.example.com/x',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function makeFolder(id: string, name: string, parentId: string | null = null): Folder {
  return { id, name, parentId };
}

function seedWorkspace(
  apicircleDir: string,
  fragment: {
    rootChildren?: Array<{ kind: 'folder' | 'request'; id: string }>;
    folders?: Folder[];
    requests?: ApiRequest[];
  },
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const now = new Date().toISOString();
  const synced = {
    schemaVersion: 1,
    workspaceId: 'test-ws',
    collections: {
      tree: { id: 'root', type: 'root', children: fragment.rootChildren ?? [] },
      requests: Object.fromEntries((fragment.requests ?? []).map((r) => [r.id, r])),
      folders: Object.fromEntries((fragment.folders ?? []).map((f) => [f.id, f])),
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

describe('EditorView', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let view: EditorView;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'editorview-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    view = new EditorView(bridge);
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function registerAndActivate(): void {
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'test', index: 0 } as never,
      label: 'test',
    });
    bridge.setActive(apicircleDir);
  }

  describe('getChildren()', () => {
    it('returns [] when no active workspace', async () => {
      const result = await view.getChildren();
      expect(result).toEqual([]);
    });

    it('returns root tree children when no element passed', async () => {
      const r1 = generateId();
      const r2 = generateId();
      seedWorkspace(apicircleDir, {
        rootChildren: [
          { kind: 'request', id: r1 },
          { kind: 'request', id: r2 },
        ],
        requests: [makeRequest(r1, 'A'), makeRequest(r2, 'B')],
      });
      registerAndActivate();

      const result = await view.getChildren();
      expect(result).toEqual([
        { kind: 'request', id: r1 },
        { kind: 'request', id: r2 },
      ]);
    });

    it('returns [] for a request element (leaves have no children)', async () => {
      const r1 = generateId();
      seedWorkspace(apicircleDir, {
        rootChildren: [{ kind: 'request', id: r1 }],
        requests: [makeRequest(r1, 'A')],
      });
      registerAndActivate();

      const result = await view.getChildren({ kind: 'request', id: r1 });
      expect(result).toEqual([]);
    });

    it('returns folder children sorted alphabetically across kinds', async () => {
      const folderId = generateId();
      const subFolderId = generateId();
      const r1 = generateId();
      const r2 = generateId();
      seedWorkspace(apicircleDir, {
        rootChildren: [{ kind: 'folder', id: folderId }],
        folders: [makeFolder(folderId, 'users'), makeFolder(subFolderId, 'admin', folderId)],
        requests: [makeRequest(r1, 'zeta', folderId), makeRequest(r2, 'beta', folderId)],
      });
      registerAndActivate();

      const children = await view.getChildren({ kind: 'folder', id: folderId });
      expect(children).toHaveLength(3);
      // 'admin' (folder) < 'beta' (request) < 'zeta' (request)
      expect(children[0]).toEqual({ kind: 'folder', id: subFolderId });
      expect(children[1]).toEqual({ kind: 'request', id: r2 });
      expect(children[2]).toEqual({ kind: 'request', id: r1 });
    });
  });

  describe('getTreeItem()', () => {
    it('renders "No workspace" when nothing is active', async () => {
      const item = await view.getTreeItem({ kind: 'request', id: 'x' } as EditorNode);
      expect(item.label).toBe('No workspace');
    });

    it('renders a folder with its name + folder icon', async () => {
      const folderId = generateId();
      seedWorkspace(apicircleDir, {
        rootChildren: [{ kind: 'folder', id: folderId }],
        folders: [makeFolder(folderId, 'Users')],
      });
      registerAndActivate();

      const item = await view.getTreeItem({ kind: 'folder', id: folderId });
      expect(item.label).toBe('Users');
      expect(item.contextValue).toBe('folder');
    });

    it('renders a request with method-color icon + apicircle: command', async () => {
      const r1 = generateId();
      const req = {
        ...makeRequest(r1, 'Get user'),
        method: 'GET' as const,
        url: 'https://api.example.com/users/123',
      };
      seedWorkspace(apicircleDir, { rootChildren: [{ kind: 'request', id: r1 }], requests: [req] });
      registerAndActivate();

      const item = await view.getTreeItem({ kind: 'request', id: r1 });
      expect(item.label).toBe('Get user');
      expect(item.description).toBe('GET /users/123');
      expect(item.contextValue).toBe('request');
      expect(item.command?.command).toBe('vscode.open');
      expect((item.command?.arguments?.[0] as { scheme: string })?.scheme).toBe('apicircle');
    });

    it('handles a missing folder gracefully (deleted upstream)', async () => {
      seedWorkspace(apicircleDir, {});
      registerAndActivate();
      const item = await view.getTreeItem({ kind: 'folder', id: 'nonexistent' });
      expect(item.label).toBe('(deleted folder)');
    });

    it('handles a missing request gracefully', async () => {
      seedWorkspace(apicircleDir, {});
      registerAndActivate();
      const item = await view.getTreeItem({ kind: 'request', id: 'nonexistent' });
      expect(item.label).toBe('(deleted request)');
    });
  });
});
