import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as vscode from 'vscode';
import { Uri, languages, workspace } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { PreSendDiagnostics } from './preSendDiagnostics';

interface MockCollection {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

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

function seedWorkspace(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const now = new Date().toISOString();
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
      meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
    }),
  );
}

function makeDoc(uri: unknown, text: string): vscode.TextDocument {
  return {
    uri,
    fileName: (uri as { path: string }).path,
    languageId: 'apicircle-request',
    version: 1,
    isUntitled: false,
    isDirty: false,
    isClosed: false,
    encoding: 'utf8',
    eol: 1,
    lineCount: text.split('\n').length,
    getText: () => text,
  } as unknown as vscode.TextDocument;
}

describe('PreSendDiagnostics', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let collection: MockCollection;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diags-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seedWorkspace(apicircleDir);
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'test', index: 0 } as never,
      label: 'test',
    });
    bridge.setActive(apicircleDir);

    collection = {
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    };
    (languages.createDiagnosticCollection as ReturnType<typeof vi.fn>).mockReset();
    (languages.createDiagnosticCollection as ReturnType<typeof vi.fn>).mockReturnValue(collection);
    (workspace.onDidOpenTextDocument as ReturnType<typeof vi.fn>).mockReset();
    (workspace.onDidOpenTextDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      dispose: () => undefined,
    });
    (workspace.onDidChangeTextDocument as ReturnType<typeof vi.fn>).mockReset();
    (workspace.onDidChangeTextDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      dispose: () => undefined,
    });
    (workspace.onDidCloseTextDocument as ReturnType<typeof vi.fn>).mockReset();
    (workspace.onDidCloseTextDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      dispose: () => undefined,
    });
    (workspace as { textDocuments: unknown[] }).textDocuments = [];
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('ignores non-apicircle: documents', () => {
    const diag = new PreSendDiagnostics(bridge);
    const doc = makeDoc(Uri.parse('file:///foo.txt'), 'hello');
    diag.lintDocument(doc);
    expect(collection.set).not.toHaveBeenCalled();
    diag.dispose();
  });

  it('emits an Error diagnostic for invalid YAML', () => {
    const diag = new PreSendDiagnostics(bridge);
    const uri = Uri.parse('apicircle://x/requests/abc.req.yaml');
    diag.lintDocument(makeDoc(uri, '!!! not yaml ::: ['));
    expect(collection.set).toHaveBeenCalled();
    const [, diagnostics] = collection.set.mock.calls.at(-1) as [
      unknown,
      Array<{ severity: number }>,
    ];
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe(0); // Error
    diag.dispose();
  });

  it('emits warning diagnostic for unresolved variable', async () => {
    const diag = new PreSendDiagnostics(bridge);
    const uri = Uri.parse('apicircle://x/requests/abc.req.yaml');
    diag.lintDocument(makeDoc(uri, 'name: x\nmethod: GET\nurl: "{{undefined_var}}/path"\n'));
    // Allow the async lint (file read + scope build) to complete
    await new Promise((r) => setTimeout(r, 100));
    expect(collection.set).toHaveBeenCalled();
    const calls = collection.set.mock.calls as Array<
      [unknown, Array<{ message: string; severity: number }>]
    >;
    const lastCall = calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![1].some((d) => d.message.includes('undefined_var'))).toBe(true);
    diag.dispose();
  });

  it('hasBlocker reads the underlying collection', () => {
    const diag = new PreSendDiagnostics(bridge);
    const uri = Uri.parse('apicircle://x/requests/abc.req.yaml');
    collection.get.mockReturnValueOnce([{ severity: 0 }]);
    expect(diag.hasBlocker(uri as never)).toBe(true);
    collection.get.mockReturnValueOnce([{ severity: 1 }]); // Warning only
    expect(diag.hasBlocker(uri as never)).toBe(false);
    diag.dispose();
  });

  it('removes diagnostics when document is closed', () => {
    const diag = new PreSendDiagnostics(bridge);
    // Simulate close handler invocation
    const closeHandler = (workspace.onDidCloseTextDocument as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as ((doc: vscode.TextDocument) => void) | undefined;
    expect(closeHandler).toBeDefined();
    const uri = Uri.parse('apicircle://x/requests/abc.req.yaml');
    closeHandler?.(makeDoc(uri, ''));
    expect(collection.delete).toHaveBeenCalledWith(uri);
    diag.dispose();
  });
});
