import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import type { Request as ApiRequest } from '@apicircle/shared';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  deleteRequestCommand,
  duplicateRequestCommand,
  revealInSourceCommand,
} from './requestActions';

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

function makeReq(id: string, name = 'r'): ApiRequest {
  return {
    id,
    name,
    folderId: null,
    method: 'GET',
    url: 'https://x.com',
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

function seedWorkspace(dir: string, requests: ApiRequest[]): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: {
        tree: {
          id: 'root',
          type: 'root',
          children: requests.map((r) => ({ kind: 'request', id: r.id })),
        },
        requests: Object.fromEntries(requests.map((r) => [r.id, r])),
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
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('request actions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reqact-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(reqs: ApiRequest[]): void {
    seedWorkspace(apicircleDir, reqs);
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
      source: 'git-folder',
    });
    bridge.setActive(apicircleDir);
  }

  describe('deleteRequestCommand', () => {
    it('warns and skips when user does not confirm', async () => {
      const r = makeReq('r1', 'Test');
      activate([r]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deleteRequestCommand({ bridge }, { kind: 'request', id: 'r1' });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.collections.requests.r1).toBeDefined();
    });

    it('deletes when user confirms', async () => {
      const r = makeReq('r1', 'Test');
      activate([r]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteRequestCommand({ bridge }, { kind: 'request', id: 'r1' });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.collections.requests.r1).toBeUndefined();
    });

    it('warns when request no longer exists', async () => {
      activate([]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteRequestCommand({ bridge }, { kind: 'request', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('no longer exists'),
      );
    });
  });

  describe('duplicateRequestCommand', () => {
    it('creates a copy with " (copy)" suffix and new id', async () => {
      const r = makeReq('r1', 'Original');
      activate([r]);
      await duplicateRequestCommand({ bridge }, { kind: 'request', id: 'r1' });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      const requests = Object.values(synced.collections.requests) as ApiRequest[];
      expect(requests).toHaveLength(2);
      const copy = requests.find((req) => req.name === 'Original (copy)');
      expect(copy).toBeDefined();
      expect(copy!.id).not.toBe('r1');
      expect(copy!.method).toBe('GET');
      expect(copy!.url).toBe('https://x.com');
    });
  });

  describe('additional coverage', () => {
    it('deleteRequestCommand warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      await deleteRequestCommand({ bridge }, { kind: 'request', id: 'r1' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No active API Circle workspace'),
      );
    });

    it('deleteRequestCommand warns when the request id is missing from state', async () => {
      activate([]);
      await deleteRequestCommand({ bridge }, { kind: 'request', id: 'r-missing' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Request no longer exists'),
      );
    });

    it('deleteRequestCommand exits on modal cancel', async () => {
      const r = makeReq('r1', 'Test');
      activate([r]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deleteRequestCommand({ bridge }, { kind: 'request', id: 'r1' });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { requests: Record<string, ApiRequest> } };
      expect(synced.collections.requests.r1).toBeDefined();
    });

    it('duplicateRequestCommand warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      await duplicateRequestCommand({ bridge }, { kind: 'request', id: 'r1' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No active API Circle workspace'),
      );
    });

    it('duplicateRequestCommand warns when the source request is gone', async () => {
      activate([]);
      await duplicateRequestCommand({ bridge }, { kind: 'request', id: 'r-missing' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Request no longer exists'),
      );
    });

    it('revealInSourceCommand warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      await revealInSourceCommand({ bridge }, { kind: 'request', id: 'r1' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No active API Circle workspace'),
      );
    });

    it('revealInSourceCommand prompts when no editor + node arg present', async () => {
      activate([makeReq('r1')]);
      window.activeTextEditor = undefined as unknown;
      await revealInSourceCommand({ bridge });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Open a request'),
      );
    });
  });
});
