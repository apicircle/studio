// =============================================================================
// historyRoundTrip integration test (gap #11).
//
// Verifies: real HTTP send → persistRequestRun writes to history → HistoryView
// shows the run → click resolves history URI to formatted YAML.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { Uri } from '../mocks/vscode';
import { generateId } from '@apicircle/shared';
import { executeRequest } from '@apicircle/core';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { ApicircleFsProvider } from '../../src/fs/apicircleFsProvider';
import { persistRequestRun } from '../../src/execute/persistHistory';
import { HistoryView } from '../../src/views/HistoryView';

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

describe('historyRoundTrip (send → persist → view → resolve URI)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;
  let server: http.Server;
  let serverUrl: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-rt-'));
    apicircleDir = path.join(tmp, '.apicircle');
    fs.mkdirSync(apicircleDir, { recursive: true });
    fs.writeFileSync(
      path.join(apicircleDir, 'workspace.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: 'history-rt',
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
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ msg: 'history test' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (typeof addr === 'string' || addr === null) throw new Error('bad addr');
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('end-to-end: real send → history entry → HistoryView surfaces → URI resolves', async () => {
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
      source: 'git-folder',
    });
    bridge.setActive(apicircleDir);

    const reqId = generateId();
    const surface = bridge.activeWorkspace()!;
    await surface.apply({
      kind: 'request.create',
      request: {
        id: reqId,
        name: 'History test',
        folderId: null,
        method: 'GET',
        url: `${serverUrl}/x`,
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
    });

    // Real send
    const state = await surface.read();
    const request = state.synced.collections.requests[reqId];
    const result = await executeRequest(request);
    expect(result.status).toBe(200);

    // Persist
    const run = await persistRequestRun({ surface, request, result });

    // HistoryView surfaces it
    const fsProvider = new ApicircleFsProvider(bridge);
    const view = new HistoryView(bridge, fsProvider);
    const buckets = await view.getChildren();
    expect(buckets).toEqual([
      { kind: 'bucket', id: 'requests' },
      { kind: 'bucket', id: 'plans' },
    ]);
    const requestRuns = await view.getChildren({ kind: 'bucket', id: 'requests' });
    expect(requestRuns).toEqual([{ kind: 'request-run', runId: run.id }]);

    // History URI resolves via FS provider — lazily reads from local.history.
    // historyUri now accepts a display label so the tab basename is the
    // request name; identity is still the `?runId=` query.
    const uri = ApicircleFsProvider.historyUri(apicircleDir, run.id, 'Login');
    const bytes = await fsProvider.readFile(uri as never);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain(run.id);
    expect(text).toContain('status: 200');
    expect(text).toContain('history test');
  });
});
