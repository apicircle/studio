import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { newRequestCommand } from './newRequest';

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

function seedWorkspace(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {},
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

interface SyncedShape {
  collections: {
    requests: Record<
      string,
      {
        name: string;
        method: string;
        url: string;
        folderId: string | null;
        auth: { type: string };
        headers: Array<{ key: string }>;
        query: Array<{ key: string }>;
        body: { type: string };
      }
    >;
    folders: Record<string, { id: string; name: string; parentId: string | null }>;
  };
}

describe('newRequestCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'newreq-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockReset();
    (window.showInputBox as ReturnType<typeof vi.fn>).mockReset();
    (window.showWarningMessage as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(): void {
    seedWorkspace(apicircleDir);
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'test', index: 0 } as never,
      label: 'test',
    });
    bridge.setActive(apicircleDir);
  }

  function readSynced(): SyncedShape {
    return JSON.parse(
      fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
    ) as SyncedShape;
  }

  it('warns when no workspace is active', async () => {
    await newRequestCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
  });

  it('cancels gracefully when the folder picker is dismissed', async () => {
    activate();
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const openCreated = vi.fn();
    await newRequestCommand({ bridge, openCreated });
    expect(openCreated).not.toHaveBeenCalled();
    expect(Object.keys(readSynced().collections.requests)).toHaveLength(0);
  });

  it('creates a GET request at the top level with sensible defaults (no extra prompts)', async () => {
    activate();
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      label: '(top level)',
      folderId: null,
    });
    const openCreated = vi.fn().mockResolvedValueOnce(undefined);
    await newRequestCommand({ bridge, openCreated });

    expect(openCreated).toHaveBeenCalled();
    // Only the folder picker was shown — no method / URL / auth / name prompts.
    expect((window.showQuickPick as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect((window.showInputBox as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    const requests = Object.values(readSynced().collections.requests);
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.name).toBe('New Request');
    expect(req.method).toBe('GET');
    expect(req.folderId).toBeNull();
    expect(req.auth.type).toBe('none');
    // GET scaffold: Accept header + sample page query + no body.
    expect(req.headers[0].key).toBe('Accept');
    expect(req.query[0].key).toBe('page');
    expect(req.body.type).toBe('none');
  });

  it('creates a new folder inline and parents the request to it', async () => {
    activate();
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      label: 'New folder…',
      folderId: '__new_folder__',
    });
    (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Smoke tests');
    await newRequestCommand({ bridge, openCreated: vi.fn() });

    const synced = readSynced();
    const folders = Object.values(synced.collections.folders);
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('Smoke tests');
    expect(folders[0].parentId).toBeNull();
    const req = Object.values(synced.collections.requests)[0];
    expect(req.folderId).toBe(folders[0].id);
  });

  it('cancels when the new-folder name prompt is dismissed', async () => {
    activate();
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      label: 'New folder…',
      folderId: '__new_folder__',
    });
    (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const openCreated = vi.fn();
    await newRequestCommand({ bridge, openCreated });
    expect(openCreated).not.toHaveBeenCalled();
    const synced = readSynced();
    expect(Object.keys(synced.collections.folders)).toHaveLength(0);
    expect(Object.keys(synced.collections.requests)).toHaveLength(0);
  });

  it('skips the folder picker when a folder id is supplied via context', async () => {
    activate();
    // Pre-create a folder by running once through the inline-create path.
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      label: 'New folder…',
      folderId: '__new_folder__',
    });
    (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Existing');
    await newRequestCommand({ bridge, openCreated: vi.fn() });
    const folderId = Object.values(readSynced().collections.folders)[0].id;

    // Now invoke with the folder context — no picker should be shown.
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockReset();
    const openCreated = vi.fn().mockResolvedValueOnce(undefined);
    await newRequestCommand({ bridge, openCreated }, { folderId });
    expect((window.showQuickPick as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(openCreated).toHaveBeenCalled();

    const reqs = Object.values(readSynced().collections.requests);
    expect(reqs).toHaveLength(2);
    expect(reqs.every((r) => r.folderId === folderId)).toBe(true);
  });

  it('warns and aborts when the supplied context folder no longer exists', async () => {
    activate();
    await newRequestCommand({ bridge, openCreated: vi.fn() }, { folderId: 'ghost' });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
    );
    expect(Object.keys(readSynced().collections.requests)).toHaveLength(0);
  });
});
