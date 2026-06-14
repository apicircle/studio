import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Uri, workspace } from '../test/mocks/vscode';
import { activate, deactivate, __getInternalsForTests } from './extension';

function makeContext(globalStorageRoot: string) {
  const state = new Map<string, unknown>();
  const ws = new Map<string, unknown>();
  return {
    subscriptions: [] as Array<{ dispose: () => unknown }>,
    globalState: {
      get: <T>(key: string, defaultValue?: T) =>
        state.has(key) ? (state.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => Array.from(state.keys()),
    },
    workspaceState: {
      get: <T>(key: string, defaultValue?: T) => (ws.has(key) ? (ws.get(key) as T) : defaultValue),
      update: async (key: string, value: unknown) => {
        ws.set(key, value);
      },
      keys: () => Array.from(ws.keys()),
    },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    globalStorageUri: Uri.file(globalStorageRoot),
    storageUri: undefined,
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext',
    asAbsolutePath: (rel: string) => path.join('/ext', rel),
    extensionMode: 3,
  } as never;
}

describe('extension activation', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-ext-'));
    (workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
    (workspace as { textDocuments: unknown }).textDocuments = [];
  });

  afterEach(async () => {
    await deactivate();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('activates without throwing and registers subscriptions on the context', () => {
    const context = makeContext(path.join(tmp, 'globalStorage'));
    expect(() => activate(context)).not.toThrow();
    expect((context as { subscriptions: unknown[] }).subscriptions.length).toBeGreaterThan(0);
  });

  it('exposes internals after activation', () => {
    const context = makeContext(path.join(tmp, 'globalStorage'));
    activate(context);
    const internals = __getInternalsForTests();
    expect(internals.bridge).not.toBeNull();
    expect(internals.views).not.toBeNull();
    expect(internals.abortRegistry).not.toBeNull();
  });

  it('deactivate() clears every module-scoped singleton', async () => {
    const context = makeContext(path.join(tmp, 'globalStorage'));
    activate(context);
    await deactivate();
    const internals = __getInternalsForTests();
    expect(internals.bridge).toBeNull();
    expect(internals.views).toBeNull();
    expect(internals.abortRegistry).toBeNull();
  });

  it('deactivate() is safe to call without a prior activate (idempotent)', async () => {
    await expect(deactivate()).resolves.toBeUndefined();
  });
});
