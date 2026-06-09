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

  it('warns when no workspace is active', async () => {
    await newRequestCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
  });

  it('cancels gracefully if user dismisses method picker', async () => {
    activate();
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const openCreated = vi.fn();
    await newRequestCommand({ bridge, openCreated });
    expect(openCreated).not.toHaveBeenCalled();
  });

  it('cancels gracefully if user dismisses URL input', async () => {
    activate();
    (window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ label: 'GET' });
    (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const openCreated = vi.fn();
    await newRequestCommand({ bridge, openCreated });
    expect(openCreated).not.toHaveBeenCalled();
  });

  it('creates a request with the picked method + URL + None auth', async () => {
    activate();
    const qpFn = window.showQuickPick as ReturnType<typeof vi.fn>;
    const ipFn = window.showInputBox as ReturnType<typeof vi.fn>;
    qpFn
      .mockResolvedValueOnce({ label: 'POST' })
      .mockResolvedValueOnce({ label: '(top level)', folderId: null })
      .mockResolvedValueOnce({ label: 'None', value: 'none' });
    ipFn
      .mockResolvedValueOnce('https://api.example.com/users') // URL
      .mockResolvedValueOnce('Create user'); // name

    const openCreated = vi.fn().mockResolvedValueOnce(undefined);
    await newRequestCommand({ bridge, openCreated });

    expect(openCreated).toHaveBeenCalled();
    // Read disk to verify the request was created
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    const requests = Object.values(synced.collections.requests) as Array<{
      name: string;
      method: string;
      url: string;
      auth: { type: string };
    }>;
    expect(requests).toHaveLength(1);
    expect(requests[0].name).toBe('Create user');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('https://api.example.com/users');
    expect(requests[0].auth.type).toBe('none');
  });

  it('handles bearer auth credentials prompt', async () => {
    activate();
    const qpFn = window.showQuickPick as ReturnType<typeof vi.fn>;
    const ipFn = window.showInputBox as ReturnType<typeof vi.fn>;
    qpFn
      .mockResolvedValueOnce({ label: 'GET' })
      .mockResolvedValueOnce({ label: '(top level)', folderId: null })
      .mockResolvedValueOnce({ label: 'Bearer token', value: 'bearer' });
    ipFn
      .mockResolvedValueOnce('https://api.example.com/me')
      .mockResolvedValueOnce('abc-123-token') // bearer token
      .mockResolvedValueOnce('Get me');

    await newRequestCommand({ bridge, openCreated: vi.fn() });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    const requests = Object.values(synced.collections.requests) as Array<{
      auth: { type: string; token: string };
    }>;
    expect(requests[0].auth.type).toBe('bearer');
    expect(requests[0].auth.token).toBe('abc-123-token');
  });

  it('rejects empty URL via validateInput', async () => {
    activate();
    const qpFn = window.showQuickPick as ReturnType<typeof vi.fn>;
    qpFn.mockResolvedValueOnce({ label: 'GET' });
    let capturedValidate: ((s: string) => string | null) | undefined;
    (window.showInputBox as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (opts: { validateInput?: (s: string) => string | null }) => {
        capturedValidate = opts.validateInput;
        return undefined;
      },
    );

    await newRequestCommand({ bridge, openCreated: vi.fn() });
    expect(capturedValidate?.('')).toBe('URL is required');
    expect(capturedValidate?.('https://x.com')).toBeNull();
  });
});
