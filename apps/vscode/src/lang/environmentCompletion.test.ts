import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { EnvironmentCompletionProvider } from './environmentCompletion';

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

function seedWorkspace(
  apicircleDir: string,
  secretKeys: Record<string, { id: string; label: string; salt: string; createdAt: string }> = {},
): void {
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
      secretKeys,
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const fakeCtx = {} as unknown as vscode.CompletionContext;
function pos(line: number, ch: number): vscode.Position {
  return { line, character: ch } as unknown as vscode.Position;
}

describe('EnvironmentCompletionProvider', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let provider: EnvironmentCompletionProvider;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envcomp-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    provider = new EnvironmentCompletionProvider(bridge);
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
    });
    bridge.setActive(apicircleDir);
  }

  it('returns [] for non-apicircle docs', async () => {
    const items = await provider.provideCompletionItems(
      makeDoc(Uri.parse('file:///foo.yaml'), ['encrypted: ']),
      pos(0, 10),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  it('returns [] for apicircle: docs that are not .env.yaml', async () => {
    const items = await provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/requests/r.req.yaml'), ['encrypted: ']),
      pos(0, 10),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  it('completes encrypted: with true/false', async () => {
    seedWorkspace(apicircleDir);
    activate();
    const items = await provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/environments/prod.env.yaml'), [
        'name: prod',
        'variables:',
        '  - key: k',
        '    encrypted: ',
      ]),
      pos(3, 16),
      fakeToken,
      fakeCtx,
    );
    expect(items.map((i) => i.label)).toEqual(['true', 'false']);
  });

  it('completes secretKeyId: with registered slot ids', async () => {
    seedWorkspace(apicircleDir, {
      ck_a: { id: 'ck_a', label: 'API key', salt: 'sss', createdAt: '2026-01-01' },
      ck_b: { id: 'ck_b', label: 'JWT signing', salt: 'ttt', createdAt: '2026-01-02' },
    });
    activate();
    const items = await provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/environments/prod.env.yaml'), [
        'name: prod',
        'variables:',
        '  - key: k',
        '    secretKeyId: ',
      ]),
      pos(3, 18),
      fakeToken,
      fakeCtx,
    );
    expect(items.map((i) => i.label).sort()).toEqual(['ck_a', 'ck_b']);
    const a = items.find((i) => i.label === 'ck_a');
    expect(a?.detail).toContain('API key');
  });

  it('returns [] when no workspace is active and secretKeyId is being completed', async () => {
    const items = await provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/environments/prod.env.yaml'), ['secretKeyId: ']),
      pos(0, 13),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  it('returns [] for unrelated YAML lines', async () => {
    seedWorkspace(apicircleDir);
    activate();
    const items = await provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/environments/p.env.yaml'), ['name: x']),
      pos(0, 7),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });
});
