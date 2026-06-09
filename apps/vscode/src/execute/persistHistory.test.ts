import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Request as ApiRequest } from '@apicircle/shared';
import type { ExecutionResult } from '@apicircle/core';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { persistRequestRun } from './persistHistory';

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
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
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

function makeReq(): ApiRequest {
  return {
    id: 'req-1',
    name: 'Get user',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/x',
    headers: [
      { key: 'X-Trace', value: 'abc', enabled: true },
      { key: 'X-Skip', value: 'no', enabled: false },
    ],
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

function makeResult(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 100,
    status: 200,
    ok: true,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    bodyKind: 'json',
    url: 'https://api.example.com/x',
    method: 'GET',
    authWarnings: [],
    ...over,
  };
}

describe('persistRequestRun', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seedWorkspace(apicircleDir);
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('appends a RequestRun to history.requestRuns', async () => {
    const surface = bridge.activeWorkspace()!;
    const run = await persistRequestRun({
      surface,
      request: makeReq(),
      result: makeResult(),
    });
    expect(run.id).toBeTruthy();
    const state = await surface.read();
    expect(state.local.history.requestRuns).toHaveLength(1);
    expect(state.local.history.requestRuns[0].id).toBe(run.id);
  });

  it('captures only enabled request headers', async () => {
    const surface = bridge.activeWorkspace()!;
    const run = await persistRequestRun({ surface, request: makeReq(), result: makeResult() });
    expect(run.requestHeaders).toEqual({ 'X-Trace': 'abc' });
  });

  it('captures null request body preview for body type none', async () => {
    const surface = bridge.activeWorkspace()!;
    const run = await persistRequestRun({ surface, request: makeReq(), result: makeResult() });
    expect(run.requestBodyPreview).toBeNull();
  });

  it('captures JSON body preview when body type is json', async () => {
    const surface = bridge.activeWorkspace()!;
    const req = { ...makeReq(), body: { type: 'json' as const, content: '{"a":1}' } };
    const run = await persistRequestRun({ surface, request: req, result: makeResult() });
    expect(run.requestBodyPreview).toBe('{"a":1}');
  });

  it('truncates large response bodies', async () => {
    const surface = bridge.activeWorkspace()!;
    const huge = 'x'.repeat(200_000);
    const run = await persistRequestRun({
      surface,
      request: makeReq(),
      result: makeResult({ body: huge }),
    });
    expect(run.responseBodyPreview.length).toBeLessThanOrEqual(64 * 1024);
  });

  it('preserves assertion verdicts in the run', async () => {
    const surface = bridge.activeWorkspace()!;
    const run = await persistRequestRun({
      surface,
      request: makeReq(),
      result: makeResult(),
      assertionVerdicts: [
        {
          assertionId: 'a1',
          kind: 'status',
          op: 'equals',
          expected: 200,
          passed: true,
          detail: 'ok',
        },
      ],
    });
    expect(run.assertions).toHaveLength(1);
    expect(run.assertions[0].passed).toBe(true);
  });

  it('enforces maxEntries by evicting oldest', async () => {
    const surface = bridge.activeWorkspace()!;
    for (let i = 0; i < 5; i++) {
      await persistRequestRun({
        surface,
        request: { ...makeReq(), id: `r${i}` },
        result: makeResult({ startedAt: `2026-01-${10 + i}T00:00:00.000Z` }),
        maxEntries: 3,
      });
    }
    const state = await surface.read();
    expect(state.local.history.requestRuns).toHaveLength(3);
    // Most recent runs retained
    expect(state.local.history.requestRuns[0].requestId).toBe('r4');
  });

  it('prunes runs older than retentionDays before appending', async () => {
    const surface = bridge.activeWorkspace()!;
    const now = Date.now();
    const old = now - 40 * 86_400_000;
    const recent = now - 1 * 86_400_000;
    await persistRequestRun({
      surface,
      request: { ...makeReq(), id: 'old' },
      result: makeResult({ startedAt: new Date(old).toISOString() }),
    });
    await persistRequestRun({
      surface,
      request: { ...makeReq(), id: 'recent' },
      result: makeResult({ startedAt: new Date(recent).toISOString() }),
    });
    // Third write with retentionDays=30 should drop "old"
    await persistRequestRun({
      surface,
      request: { ...makeReq(), id: 'fresh' },
      result: makeResult({ startedAt: new Date(now).toISOString() }),
      retentionDays: 30,
    });
    const state = await surface.read();
    const ids = state.local.history.requestRuns.map((r) => r.requestId);
    expect(ids).toContain('fresh');
    expect(ids).toContain('recent');
    expect(ids).not.toContain('old');
  });

  it('honors retentionDays=0 as "no time cap" (default)', async () => {
    const surface = bridge.activeWorkspace()!;
    const old = Date.now() - 100 * 86_400_000;
    await persistRequestRun({
      surface,
      request: { ...makeReq(), id: 'very-old' },
      result: makeResult({ startedAt: new Date(old).toISOString() }),
      retentionDays: 0,
    });
    await persistRequestRun({
      surface,
      request: { ...makeReq(), id: 'now' },
      result: makeResult(),
      retentionDays: 0,
    });
    const state = await surface.read();
    expect(state.local.history.requestRuns.map((r) => r.requestId)).toEqual(['now', 'very-old']);
  });

  it('persists newest-first ordering in history', async () => {
    const surface = bridge.activeWorkspace()!;
    await persistRequestRun({
      surface,
      request: { ...makeReq(), id: 'first' },
      result: makeResult(),
    });
    await persistRequestRun({
      surface,
      request: { ...makeReq(), id: 'second' },
      result: makeResult(),
    });
    const state = await surface.read();
    expect(state.local.history.requestRuns[0].requestId).toBe('second');
    expect(state.local.history.requestRuns[1].requestId).toBe('first');
  });
});
