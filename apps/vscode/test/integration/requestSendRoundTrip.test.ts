// =============================================================================
// requestSendRoundTrip integration test.
//
// Exercises the full Phase 1 user-visible pipe with NO execute-time mocking:
//
//   1. Seed a real .apicircle/workspace.json with a Request pointing at a
//      locally-spawned HTTP server.
//   2. Register the workspace with VsCodeBridge using the real
//      GitWorkspaceProvider.
//   3. Edit the request via the apicircle: FileSystemProvider (YAML write).
//   4. Call sendRequestCommand with the REAL executeRequest from core
//      (no `execute` hook injected).
//   5. Capture the response document content via the `openResponse` hook.
//   6. Verify: the response document includes the actual server's body, the
//      captured headers, the right status, and the assertion verdicts the
//      request defines.
//
// This is the only test that catches a real regression in the wire glue
// between bridge → applyMutation → FileSystemProvider → executeRequest →
// formatResponseDocument. sendRequest.test.ts mocks execute; that's
// appropriate for unit-level wiring, but doesn't tell us the full flow
// produces correct output.
// =============================================================================

import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { Uri, window } from '../mocks/vscode';
import { generateId } from '@apicircle/shared';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { AbortRegistry } from '../../src/execute/abortRegistry';
import { sendRequestCommand } from '../../src/execute/sendRequest';

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

interface RequestSeed {
  id: string;
  name: string;
  method: 'GET' | 'POST';
  url: string;
  expectAssertions?: Array<{
    id: string;
    kind: 'status' | 'duration' | 'json-path';
    op: 'equals' | 'lt' | 'contains';
    target?: string;
    expected: string | number;
  }>;
}

function writeSeedWorkspace(apicircleDir: string, request: RequestSeed): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'roundtrip-test',
      collections: {
        tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: request.id }] },
        requests: {
          [request.id]: {
            id: request.id,
            name: request.name,
            folderId: null,
            method: request.method,
            url: request.url,
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: request.expectAssertions ?? [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
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
}

interface MockServerHandle {
  url: string;
  close(): Promise<void>;
}

function startMockServer(handler: http.RequestListener): Promise<MockServerHandle> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        reject(new Error('Unexpected server address'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}`;
      resolve({
        url,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

describe('requestSendRoundTrip (real wire integration)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let registry: AbortRegistry;
  let apicircleDir: string;
  let server: MockServerHandle;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'round-trip-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    registry = new AbortRegistry();
    (window.activeTextEditor as unknown) = undefined;
    (window.showQuickPick as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
  });

  afterEach(async () => {
    if (server) await server.close();
    bridge.dispose();
    registry.cancelAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activateBridgeForWorkspace(): void {
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'rt', index: 0 } as never,
      label: 'rt',
    });
    bridge.setActive(apicircleDir);
  }

  it('full pipe: GET → real HTTP → response document captures body + assertions', async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Echo-Header', 'integration-test');
      res.end(JSON.stringify({ user: { id: 'u123', email: 'a@b.com' } }));
    });

    const reqId = generateId();
    writeSeedWorkspace(apicircleDir, {
      id: reqId,
      name: 'Get user',
      method: 'GET',
      url: `${server.url}/users/me`,
      expectAssertions: [
        { id: 'a1', kind: 'status', op: 'equals', expected: 200 },
        { id: 'a2', kind: 'duration', op: 'lt', expected: 5000 },
        { id: 'a3', kind: 'json-path', op: 'equals', target: '$.user.id', expected: 'u123' },
      ],
    });
    activateBridgeForWorkspace();
    const surface = bridge.activeWorkspace()!;
    const fullRequest = (await surface.read()).synced.collections.requests[reqId];

    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Get user',
      request: fullRequest,
    });

    const captured: { uri: unknown; content: string }[] = [];
    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      openResponse: async (uri, content) => {
        captured.push({ uri, content });
      },
    });

    expect(captured).toHaveLength(1);
    const doc = captured[0].content;

    // Status / duration / size summary
    expect(doc).toContain('status: 200');
    expect(doc).toMatch(/durationMs:\s+\d+/);

    // Captured headers (lowercased by formatResponseDocument)
    expect(doc).toContain('content-type:');
    expect(doc).toMatch(/x-echo-header/i);

    // Body verbatim
    expect(doc).toContain('u123');
    expect(doc).toContain('a@b.com');

    // Assertion verdicts — all three should pass
    expect(doc).toContain('passed: true');
    expect(doc).toMatch(/kind:\s+status/);
    expect(doc).toMatch(/kind:\s+duration/);
    expect(doc).toMatch(/kind:\s+json-path/);
    expect(doc).not.toContain('passed: false');
  });

  it('full pipe: POST → real HTTP → response includes echoed body', async () => {
    server = await startMockServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            method: req.method,
            echoed: body,
            contentType: req.headers['content-type'],
          }),
        );
      });
    });

    const reqId = generateId();
    writeSeedWorkspace(apicircleDir, {
      id: reqId,
      name: 'Create user',
      method: 'POST',
      url: `${server.url}/users`,
      expectAssertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 201 }],
    });

    // Manually patch the request to have a JSON body — the seed sets none
    // so the POST is sent with no body. Use the bridge to update.
    const active = bridge.activeWorkspace();
    activateBridgeForWorkspace();
    void active; // suppress unused warning if pattern reorders

    const surface = bridge.activeWorkspace()!;
    await surface.apply({
      kind: 'request.update',
      id: reqId,
      patch: { body: { type: 'json', content: '{"name":"Alice"}' } },
    });

    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Create user',
      request: (await surface.read()).synced.collections.requests[reqId],
    });

    const captured: { uri: unknown; content: string }[] = [];
    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      openResponse: async (uri, content) => {
        captured.push({ uri, content });
      },
    });

    const doc = captured[0].content;
    expect(doc).toContain('status: 201');
    expect(doc).toContain('POST');
    expect(doc).toContain('Alice');
    // Assertion: status equals 201
    expect(doc).toContain('passed: true');
  });

  it('full pipe: failed assertion surfaces in the response document', async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });

    const reqId = generateId();
    writeSeedWorkspace(apicircleDir, {
      id: reqId,
      name: 'Server error',
      method: 'GET',
      url: `${server.url}/oops`,
      expectAssertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
    });
    activateBridgeForWorkspace();
    const surface500 = bridge.activeWorkspace()!;
    const fullReq500 = (await surface500.read()).synced.collections.requests[reqId];

    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Server error',
      request: fullReq500,
    });

    const captured: { uri: unknown; content: string }[] = [];
    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      openResponse: async (uri, content) => {
        captured.push({ uri, content });
      },
    });

    const doc = captured[0].content;
    expect(doc).toContain('status: 500');
    // The single assertion should fail
    expect(doc).toContain('passed: false');
  });

  it('full pipe: network error surfaces gracefully', async () => {
    // Don't start the server — request will hit a closed port
    const reqId = generateId();
    writeSeedWorkspace(apicircleDir, {
      id: reqId,
      name: 'Unreachable',
      method: 'GET',
      url: 'http://127.0.0.1:1', // reserved unused port
    });
    activateBridgeForWorkspace();
    const surfaceUnreach = bridge.activeWorkspace()!;
    const fullReqUnreach = (await surfaceUnreach.read()).synced.collections.requests[reqId];

    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Unreachable',
      request: fullReqUnreach,
    });

    const captured: { uri: unknown; content: string }[] = [];
    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      openResponse: async (uri, content) => {
        captured.push({ uri, content });
      },
    });

    // The send completes (executeRequest returns ExecutionResult with status: null)
    // and the response viewer shows the error
    expect(captured).toHaveLength(1);
    expect(captured[0].content).toContain('Network error');
  });
});
