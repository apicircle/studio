import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { deviceLocalPath } from '../util/workspaceDiscovery';
import { VsCodeBridge } from '../host/vscodeBridge';
import { addExtractionFromLatestResponseCommand } from './addExtraction';

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

interface SeedOpts {
  requestId?: string;
  bodyKind?: 'json' | 'text';
  bodyPreview?: string;
  hasRun?: boolean;
}

function seed(apicircleDir: string, globalStorageRoot: string, opts: SeedOpts = {}): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const reqId = opts.requestId ?? 'r1';
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'addex',
      collections: {
        tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: reqId }] },
        requests: {
          [reqId]: {
            id: reqId,
            name: 'Test req',
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
          },
        },
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
  if (opts.hasRun) {
    const localDir = deviceLocalPath(Uri.file(globalStorageRoot), { apicircleDir });
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      path.join(localDir, 'workspace.local.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: 'addex',
        executionPlans: {},
        history: {
          requestRuns: [
            {
              id: 'run-1',
              requestId: reqId,
              startedAt: '2026-01-01',
              durationMs: 100,
              status: 200,
              statusText: 'OK',
              ok: true,
              url: 'https://x.com',
              method: 'GET',
              requestHeaders: {},
              requestBodyPreview: null,
              responseHeaders: { 'content-type': 'application/json' },
              responseBodyPreview: opts.bodyPreview ?? '{"user":{"id":"u-42"}}',
              responseBodyKind: opts.bodyKind ?? 'json',
              responseTruncated: false,
              assertions: [],
            },
          ],
          planRuns: [],
        },
        secretIndex: { entries: {} },
        sessions: { github: { workspace: null, links: {} } },
        connectedRepo: null,
        workingBranch: null,
        seededWorkspaceSha: null,
        retiredBranch: null,
        sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
        linkedCollections: {},
        attachmentCache: {},
        globalContext: {},
        mockRuntime: { active: {} },
        ui: {
          activeRequestId: null,
          sidebarExpandedSections: [],
          themeId: 'one-dark-pro',
          fontId: 'system-mono',
          fontSizePercent: 100,
        },
        settings: { validateOnSend: true, monacoConsumesWheel: false },
        snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
      }),
    );
  }
}

describe('addExtractionFromLatestResponseCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addex-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (window.showQuickPick as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.activeTextEditor as unknown) = undefined;
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(): void {
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

  it('warns when no workspace is active', async () => {
    await addExtractionFromLatestResponseCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
  });

  it('shows info when workspace has no requests', async () => {
    fs.mkdirSync(apicircleDir, { recursive: true });
    fs.writeFileSync(
      path.join(apicircleDir, 'workspace.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: 'empty',
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
    activate();
    await addExtractionFromLatestResponseCommand({ bridge });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No requests'),
    );
  });

  it('tells the user to send the request first when no history exists', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), { hasRun: false });
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce({ id: 'r1' });
    await addExtractionFromLatestResponseCommand({ bridge });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Send the request once'),
    );
  });

  it('warns when latest response is not JSON', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), {
      hasRun: true,
      bodyKind: 'text',
      bodyPreview: 'hello',
    });
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce({ id: 'r1' });
    await addExtractionFromLatestResponseCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('not JSON'));
  });

  it('cancels when user dismisses the path picker', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), { hasRun: true });
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce({ id: 'r1' });
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await addExtractionFromLatestResponseCommand({ bridge });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    expect(synced.collections.requests.r1.extractions).toEqual([]);
  });

  it('rejects invalid variable names via validateInput', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), { hasRun: true });
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce({ id: 'r1' });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.user.id' });
    let capturedValidate: ((s: string) => string | null) | undefined;
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (s: string) => string | null }) => {
        capturedValidate = opts.validateInput;
        return undefined;
      },
    );
    await addExtractionFromLatestResponseCommand({ bridge });
    expect(capturedValidate?.('')).toBe('Variable name is required');
    expect(capturedValidate?.('1bad')).toBe('Use letters / digits / underscore only');
    expect(capturedValidate?.('valid_name')).toBeNull();
  });

  it('persists a new extraction to the request via request.update', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), { hasRun: true });
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce({ id: 'r1' });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.user.id' });
    (window.showInputBox as Mock).mockResolvedValueOnce('user_id');
    await addExtractionFromLatestResponseCommand({ bridge });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    const ext = synced.collections.requests.r1.extractions;
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({
      variable: 'user_id',
      source: 'body',
      path: '$.user.id',
      enabled: true,
    });
  });

  it('uses the active editor URI to resolve the request when present', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), { hasRun: true });
    activate();
    (window.activeTextEditor as unknown) = {
      document: { uri: Uri.parse('apicircle://x/requests/r1.yaml') },
    };
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '$.user.id' });
    (window.showInputBox as Mock).mockResolvedValueOnce('uid');
    await addExtractionFromLatestResponseCommand({ bridge });
    // showQuickPick was called only ONCE (for path picker, not for request picker)
    expect(window.showQuickPick).toHaveBeenCalledTimes(1);
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    expect(synced.collections.requests.r1.extractions).toHaveLength(1);
  });
});
