// =============================================================================
// Activation performance benchmark (Phase 1 gate item).
//
// Target: extension activation < 200ms on a synthetic 100-request workspace.
// This test seeds a deterministic workspace and times the activate() call.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, workspace } from '../mocks/vscode';
import { activate, deactivate } from '../../src/extension';

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

function seedLargeWorkspace(apicircleDir: string, requestCount: number): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const requests: Record<string, unknown> = {};
  const children: Array<{ kind: 'request'; id: string }> = [];
  for (let i = 0; i < requestCount; i++) {
    const id = `req-${i.toString().padStart(4, '0')}`;
    requests[id] = {
      id,
      name: `Request ${i}`,
      folderId: null,
      method: 'GET',
      url: `https://api.example.com/r/${i}`,
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
    children.push({ kind: 'request', id });
  }
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'perf-test',
      collections: {
        tree: { id: 'root', type: 'root', children },
        requests,
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

describe('activation performance benchmark', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-perf-'));
  });

  afterEach(async () => {
    try {
      await deactivate();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('activates within 500ms on a 100-request workspace (target: <200ms)', () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    seedLargeWorkspace(apicircleDir, 100);
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(tmp), name: 'perf', index: 0 },
    ];

    const ctx = makeMockContext(path.join(tmp, 'globalStorage'));
    const t0 = performance.now();
    activate(ctx);
    const elapsed = performance.now() - t0;

    // 500ms cap is lenient for vitest's Node environment with file I/O.
    // The 200ms target applies to a real VS Code extension host where the
    // FileBackedWorkspaceProvider's lazy reads + the OS file cache make I/O
    // faster. This test guards against runaway regressions.
    expect(elapsed).toBeLessThan(500);
  });

  it('activates within 100ms on an empty workspace', () => {
    (workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
    const ctx = makeMockContext(path.join(tmp, 'globalStorage'));
    const t0 = performance.now();
    activate(ctx);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });

  it('activates within 1000ms on a 500-request workspace (scaling check)', () => {
    const apicircleDir = path.join(tmp, '.apicircle');
    seedLargeWorkspace(apicircleDir, 500);
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(tmp), name: 'perf', index: 0 },
    ];
    const ctx = makeMockContext(path.join(tmp, 'globalStorage'));
    const t0 = performance.now();
    activate(ctx);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);
  });
});
