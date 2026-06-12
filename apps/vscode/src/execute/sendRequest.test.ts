import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, workspace, env as mockEnv } from '../../test/mocks/vscode';
import type { Request as ApiRequest } from '@apicircle/shared';
import type { ExecutionResult } from '@apicircle/core';
import { VsCodeBridge } from '../host/vscodeBridge';
import { AbortRegistry } from './abortRegistry';
import { InFlightSendTracker } from './inFlightTracker';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import { sendRequestCommand } from './sendRequest';

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

function makeRequest(id: string, over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    name: 'Test request',
    folderId: null,
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
    ...over,
  };
}

function seedWorkspace(apicircleDir: string, requests: ApiRequest[]): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
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
      meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
    }),
  );
}

function makeResult(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    startedAt: '2026-01-01T00:00:00Z',
    durationMs: 50,
    status: 200,
    ok: true,
    statusText: 'OK',
    headers: {},
    body: '{"ok":true}',
    bodyKind: 'json',
    url: 'https://api.example.com/x',
    method: 'GET',
    authWarnings: [],
    ...over,
  };
}

describe('sendRequestCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let registry: AbortRegistry;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sendreq-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    registry = new AbortRegistry();
    (window.activeTextEditor as unknown) = undefined;
    (window as { showWarningMessage: { mockReset: () => void } }).showWarningMessage.mockReset();
    (
      window as { showInformationMessage: { mockReset: () => void } }
    ).showInformationMessage.mockReset();
    (window as { showErrorMessage: { mockReset: () => void } }).showErrorMessage.mockReset();
    (window as { showQuickPick: { mockReset: () => void } }).showQuickPick.mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    registry.cancelAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(requests: ApiRequest[]): void {
    seedWorkspace(apicircleDir, requests);
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
    await sendRequestCommand({ bridge, abortRegistry: registry });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No active APICircle workspace'),
    );
  });

  it('warns when the workspace has no requests', async () => {
    activate([]);
    await sendRequestCommand({ bridge, abortRegistry: registry });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No requests'));
  });

  it('falls back to a QuickPick when no apicircle: editor is active', async () => {
    const req = makeRequest('r1');
    activate([req]);
    (
      window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
    ).mockResolvedValueOnce({
      label: 'Test request',
      request: req,
    });

    const execute = vi.fn().mockResolvedValueOnce(makeResult());
    const openResponse = vi.fn().mockResolvedValueOnce(undefined);
    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      execute: execute as never,
      openResponse,
    });
    expect(window.showQuickPick).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(openResponse).toHaveBeenCalledTimes(1);
  });

  it('opens the response viewer beside the source on success', async () => {
    const req = makeRequest('r1');
    activate([req]);
    (
      window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
    ).mockResolvedValueOnce({
      label: 'Test request',
      request: req,
    });

    const execute = vi.fn().mockResolvedValueOnce(makeResult({ body: '{"x":1}' }));
    const openResponse = vi.fn().mockResolvedValueOnce(undefined);

    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      execute: execute as never,
      openResponse,
    });
    expect(openResponse).toHaveBeenCalled();
    const [, content] = openResponse.mock.calls[0];
    expect(content).toContain('Test request');
    expect(content).toContain('{"x":1}');
  });

  it('runs assertions when the request has them', async () => {
    const req = makeRequest('r1', {
      assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
    });
    activate([req]);
    (
      window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
    ).mockResolvedValueOnce({
      label: 'x',
      request: req,
    });

    const execute = vi.fn().mockResolvedValueOnce(makeResult({ status: 200 }));
    const openResponse = vi.fn();
    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      execute: execute as never,
      openResponse,
    });

    const [, content] = openResponse.mock.calls[0];
    expect(content).toContain('assertions');
    expect(content).toContain('passed: true');
  });

  it('shows "cancelled" toast when the send is aborted', async () => {
    const req = makeRequest('r1');
    activate([req]);
    (
      window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
    ).mockResolvedValueOnce({
      label: 'x',
      request: req,
    });

    const execute = vi.fn().mockImplementationOnce((_req, opts: { signal: AbortSignal }) => {
      return new Promise<ExecutionResult>((_resolve, reject) => {
        const onAbort = () => reject(new Error('aborted'));
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort);
        // Trigger cancel after the listener is attached
        setImmediate(() => registry.cancelAll());
      });
    });

    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      execute: execute as never,
      openResponse: vi.fn(),
    });

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('cancelled'),
    );
  });

  it('surfaces a clear error message on execute failure', async () => {
    const req = makeRequest('r1');
    activate([req]);
    (
      window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
    ).mockResolvedValueOnce({
      label: 'x',
      request: req,
    });

    const execute = vi.fn().mockRejectedValueOnce(new Error('boom'));
    await sendRequestCommand({
      bridge,
      abortRegistry: registry,
      execute: execute as never,
      openResponse: vi.fn(),
    });
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  describe('eager response tab', () => {
    it('stashes a "Sending…" placeholder in the FS provider before execute runs', async () => {
      const req = makeRequest('r1');
      activate([req]);
      const fsProvider = new ApicircleFsProvider(bridge);
      let placeholderSeen: string | undefined;
      const execute = vi.fn().mockImplementationOnce(async () => {
        // Snapshot what's in the response store the moment execute starts —
        // this is the content the pre-opened tab is showing right now.
        const stored = Array.from(
          (fsProvider as unknown as { responseStore: Map<string, string> }).responseStore.entries(),
        );
        placeholderSeen = stored[0]?.[1];
        return makeResult({ body: '{"final":true}' });
      });
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({ label: 'x', request: req });

      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        fsProvider,
        execute: execute as never,
      });
      expect(placeholderSeen).toBeDefined();
      expect(placeholderSeen).toContain('Sending…');
      // After completion the store should hold the real response.
      const finalStore = (fsProvider as unknown as { responseStore: Map<string, string> })
        .responseStore;
      const finalContent = Array.from(finalStore.values())[0];
      expect(finalContent).toContain('{"final":true}');
      expect(finalContent).not.toContain('Sending…');
    });

    it('shows the response tab beside the request editor with preserveFocus', async () => {
      const req = makeRequest('r1');
      activate([req]);
      const fsProvider = new ApicircleFsProvider(bridge);
      (window.showTextDocument as unknown as { mockClear: () => void }).mockClear();
      const execute = vi.fn().mockResolvedValueOnce(makeResult());
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({ label: 'x', request: req });

      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        fsProvider,
        execute: execute as never,
      });
      // showTextDocument is called for the pre-open. The options object on
      // call 0 should carry ViewColumn.Beside (= -2 in VS Code's enum) and
      // preserveFocus: true so the cursor stays in the request editor.
      const calls = (
        window.showTextDocument as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const opts = calls[0][1] as { viewColumn?: number; preserveFocus?: boolean };
      expect(opts.preserveFocus).toBe(true);
    });

    it('replaces the placeholder with a cancel notice when the send is aborted', async () => {
      const req = makeRequest('r1');
      activate([req]);
      const fsProvider = new ApicircleFsProvider(bridge);
      const execute = vi.fn().mockImplementationOnce((_req, opts: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
          setImmediate(() => registry.cancelAll());
        });
      });
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({ label: 'x', request: req });

      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        fsProvider,
        execute: execute as never,
      });
      const stored = Array.from(
        (fsProvider as unknown as { responseStore: Map<string, string> }).responseStore.values(),
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toContain('Cancelled');
      expect(stored[0]).not.toContain('Sending…');
    });

    it('replaces the placeholder with a failed notice when execute throws', async () => {
      const req = makeRequest('r1');
      activate([req]);
      const fsProvider = new ApicircleFsProvider(bridge);
      const execute = vi.fn().mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({ label: 'x', request: req });

      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        fsProvider,
        execute: execute as never,
      });
      const stored = Array.from(
        (fsProvider as unknown as { responseStore: Map<string, string> }).responseStore.values(),
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toContain('Failed');
      expect(stored[0]).toContain('connect ECONNREFUSED');
      expect(stored[0]).not.toContain('Sending…');
    });
  });

  describe('in-flight tracker', () => {
    it('marks the request URI in flight while execute is running, then clears it', async () => {
      const req = makeRequest('r1');
      activate([req]);
      const tracker = new InFlightSendTracker();
      const requestUri = ApicircleFsProvider.requestUri(apicircleDir, req, {}, { [req.id]: req });
      (window.activeTextEditor as unknown) = {
        document: { uri: requestUri },
        selection: undefined,
      };
      let snapshotDuringExecute: ReturnType<InFlightSendTracker['snapshot']> | null = null;
      const execute = vi.fn().mockImplementationOnce(async () => {
        snapshotDuringExecute = tracker.snapshot();
        return makeResult();
      });
      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        tracker,
        execute: execute as never,
        openResponse: vi.fn(),
      });
      expect(snapshotDuringExecute).not.toBeNull();
      // Snapshot taken inside execute() should have the URI registered.
      const inflight = Array.from(snapshotDuringExecute!.values());
      expect(inflight).toHaveLength(1);
      expect(inflight[0].requestName).toBe('Test request');
      // After completion, the tracker should be empty.
      expect(tracker.hasAny()).toBe(false);
    });

    it('clears the tracker entry even when execute throws', async () => {
      const req = makeRequest('r1');
      activate([req]);
      const tracker = new InFlightSendTracker();
      const requestUri = ApicircleFsProvider.requestUri(apicircleDir, req, {}, { [req.id]: req });
      (window.activeTextEditor as unknown) = {
        document: { uri: requestUri },
        selection: undefined,
      };
      const execute = vi.fn().mockRejectedValueOnce(new Error('boom'));
      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        tracker,
        execute: execute as never,
        openResponse: vi.fn(),
      });
      expect(tracker.hasAny()).toBe(false);
    });
  });

  describe('wired settings', () => {
    afterEach(() => {
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReset();
      mockEnv.remoteName = undefined;
    });

    it('propagates apicircle.execution.timeoutMs to executeRequest', async () => {
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        get: vi.fn((key: string, def?: unknown) => {
          if (key === 'execution.timeoutMs') return 12345;
          if (key === 'execution.host') return 'remote';
          if (key === 'validation.validateOnSend') return true;
          if (key === 'history.maxEntriesPerWorkspace') return 500;
          if (key === 'history.retentionDays') return 30;
          return def;
        }),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
      }));

      const req = makeRequest('r1');
      activate([req]);
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({
        label: 'x',
        request: req,
      });

      const execute = vi.fn().mockResolvedValueOnce(makeResult());
      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        execute: execute as never,
        openResponse: vi.fn(),
      });
      const [, opts] = execute.mock.calls[0] as [unknown, { timeoutMs: number }];
      expect(opts.timeoutMs).toBe(12345);
    });

    it('warns when execution.host=local but no remoteName is set', async () => {
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        get: vi.fn((key: string, def?: unknown) => {
          if (key === 'execution.host') return 'local';
          if (key === 'execution.timeoutMs') return 30000;
          if (key === 'validation.validateOnSend') return true;
          return def;
        }),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
      }));
      mockEnv.remoteName = undefined;

      const req = makeRequest('r1');
      activate([req]);
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({
        label: 'x',
        request: req,
      });

      const execute = vi.fn().mockResolvedValueOnce(makeResult());
      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        execute: execute as never,
        openResponse: vi.fn(),
      });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Remote-SSH'));
    });

    it('does NOT warn when execution.host=local AND remoteName is set', async () => {
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        get: vi.fn((key: string, def?: unknown) => {
          if (key === 'execution.host') return 'local';
          if (key === 'execution.timeoutMs') return 30000;
          if (key === 'validation.validateOnSend') return true;
          return def;
        }),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
      }));
      mockEnv.remoteName = 'ssh-remote';

      const req = makeRequest('r1');
      activate([req]);
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({
        label: 'x',
        request: req,
      });

      const execute = vi.fn().mockResolvedValueOnce(makeResult());
      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        execute: execute as never,
        openResponse: vi.fn(),
      });
      // Should not warn about Remote-SSH
      const warningCalls = (window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls;
      const remoteCalls = warningCalls.filter(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('Remote-SSH'),
      );
      expect(remoteCalls).toHaveLength(0);
    });

    it('does NOT warn when execution.host=remote (default)', async () => {
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        get: vi.fn((key: string, def?: unknown) => {
          if (key === 'execution.host') return 'remote';
          if (key === 'execution.timeoutMs') return 30000;
          if (key === 'validation.validateOnSend') return true;
          return def;
        }),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
      }));

      const req = makeRequest('r1');
      activate([req]);
      (
        window.showQuickPick as { mockResolvedValueOnce: (v: unknown) => unknown }
      ).mockResolvedValueOnce({
        label: 'x',
        request: req,
      });

      const execute = vi.fn().mockResolvedValueOnce(makeResult());
      await sendRequestCommand({
        bridge,
        abortRegistry: registry,
        execute: execute as never,
        openResponse: vi.fn(),
      });
      const warningCalls = (window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls;
      const remoteCalls = warningCalls.filter(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('Remote-SSH'),
      );
      expect(remoteCalls).toHaveLength(0);
    });
  });
});
