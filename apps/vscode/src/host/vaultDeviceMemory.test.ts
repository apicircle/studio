import { describe, it, expect, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import {
  rememberPassphrase,
  readRememberedPassphrase,
  forgetPassphrase,
  forgetAllPassphrases,
} from './vaultDeviceMemory';

// Minimal in-memory SecretStorage matching vscode.SecretStorage shape.
function makeFakeStorage() {
  const map = new Map<string, string>();
  return {
    storage: {
      get: async (key: string) => map.get(key),
      store: async (key: string, value: string) => {
        map.set(key, value);
      },
      delete: async (key: string) => {
        map.delete(key);
      },
      onDidChange: { dispose: () => undefined } as never,
    } as unknown as vscode.SecretStorage,
    map,
  };
}

describe('vaultDeviceMemory', () => {
  let secrets: ReturnType<typeof makeFakeStorage>['storage'];
  let map: Map<string, string>;

  beforeEach(() => {
    const f = makeFakeStorage();
    secrets = f.storage;
    map = f.map;
  });

  it('rememberPassphrase + readRememberedPassphrase round-trip', async () => {
    await rememberPassphrase(secrets, 'ws-1', 'correct horse battery staple');
    const got = await readRememberedPassphrase(secrets, 'ws-1');
    expect(got).toBe('correct horse battery staple');
  });

  it('returns undefined when nothing is stored', async () => {
    const got = await readRememberedPassphrase(secrets, 'never-stored');
    expect(got).toBeUndefined();
  });

  it('namespaces by workspaceId — different workspaces stay isolated', async () => {
    await rememberPassphrase(secrets, 'ws-1', 'apple');
    await rememberPassphrase(secrets, 'ws-2', 'banana');
    expect(await readRememberedPassphrase(secrets, 'ws-1')).toBe('apple');
    expect(await readRememberedPassphrase(secrets, 'ws-2')).toBe('banana');
  });

  it('forgetPassphrase wipes a single workspace entry', async () => {
    await rememberPassphrase(secrets, 'ws-1', 'apple');
    await rememberPassphrase(secrets, 'ws-2', 'banana');
    await forgetPassphrase(secrets, 'ws-1');
    expect(await readRememberedPassphrase(secrets, 'ws-1')).toBeUndefined();
    expect(await readRememberedPassphrase(secrets, 'ws-2')).toBe('banana');
  });

  it('forgetPassphrase on a missing entry is a no-op (no throw)', async () => {
    await expect(forgetPassphrase(secrets, 'never-stored')).resolves.toBeUndefined();
  });

  it('forgetAllPassphrases clears every known workspace entry', async () => {
    await rememberPassphrase(secrets, 'ws-1', 'one');
    await rememberPassphrase(secrets, 'ws-2', 'two');
    await rememberPassphrase(secrets, 'ws-3', 'three');
    const cleared = await forgetAllPassphrases(secrets, ['ws-1', 'ws-2', 'ws-3']);
    expect(cleared).toBe(3);
    expect(await readRememberedPassphrase(secrets, 'ws-1')).toBeUndefined();
    expect(await readRememberedPassphrase(secrets, 'ws-2')).toBeUndefined();
    expect(await readRememberedPassphrase(secrets, 'ws-3')).toBeUndefined();
  });

  it('forgetAllPassphrases reports only the workspaces that had entries', async () => {
    await rememberPassphrase(secrets, 'ws-1', 'only-this-one');
    const cleared = await forgetAllPassphrases(secrets, ['ws-1', 'ws-2', 'ws-3']);
    expect(cleared).toBe(1);
  });

  it('SecretStorage keys are prefixed (avoids collision with unrelated secrets)', async () => {
    await rememberPassphrase(secrets, 'ws-1', 'apple');
    const keys = Array.from(map.keys());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^apicircle\.vault\.passphrase\./);
    expect(keys[0]).toContain('ws-1');
  });
});
