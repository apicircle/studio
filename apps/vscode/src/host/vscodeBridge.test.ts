import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from './vscodeBridge';
import { GitWorkspaceProvider } from './gitWorkspaceProvider';
import type { DiscoveredWorkspace } from '../util/workspaceDiscovery';

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
      get: <T>(key: string, defaultValue?: T) => defaultValue,
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

function makeWs(dir: string, label = 'ws'): DiscoveredWorkspace {
  return {
    id: path.join(dir, '.apicircle'),
    apicircleDir: path.join(dir, '.apicircle'),
    workspaceJsonPath: path.join(dir, '.apicircle', 'workspace.json'),
    workspaceFolder: { uri: Uri.file(dir), name: label, index: 0 } as never,
    label,
    source: 'git-folder',
  };
}

describe('VsCodeBridge', () => {
  let tmp: string;
  let bridge: VsCodeBridge;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vscbridge-'));
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('registerWorkspace is idempotent — same id returns the same surface', () => {
    const ws = makeWs(tmp);
    const s1 = bridge.registerWorkspace(ws);
    const s2 = bridge.registerWorkspace(ws);
    expect(s1).toBe(s2);
  });

  it('listWorkspaces returns every registered workspace', () => {
    const d1 = fs.mkdtempSync(path.join(tmp, 'a-'));
    const d2 = fs.mkdtempSync(path.join(tmp, 'b-'));
    bridge.registerWorkspace(makeWs(d1, 'a'));
    bridge.registerWorkspace(makeWs(d2, 'b'));
    expect(
      bridge
        .listWorkspaces()
        .map((w) => w.workspace.label)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('setActive throws for unknown id', () => {
    expect(() => bridge.setActive('/nonexistent/.apicircle')).toThrow(/unknown workspace id/);
  });

  it('setActive remembers selection via globalState', () => {
    const ws = makeWs(tmp);
    bridge.registerWorkspace(ws);
    bridge.setActive(ws.id);
    expect(bridge.activeWorkspace()?.workspace.id).toBe(ws.id);
  });

  it('F-G9: fires onDidChangeActiveWorkspace on setActive', () => {
    const wsA = makeWs(tmp);
    const wsB = makeWs(path.join(tmp, 'b'));
    bridge.registerWorkspace(wsA);
    bridge.registerWorkspace(wsB);
    const listener = vi.fn();
    const sub = bridge.onDidChangeActiveWorkspace(listener);
    bridge.setActive(wsA.id);
    expect(listener).toHaveBeenCalledTimes(1);
    bridge.setActive(wsB.id);
    expect(listener).toHaveBeenCalledTimes(2);
    // No-op when same id passed.
    bridge.setActive(wsB.id);
    expect(listener).toHaveBeenCalledTimes(2);
    sub.dispose();
    bridge.setActive(wsA.id);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('createWorkspaceScaffold creates .apicircle/ + workspace-<id>/workspace.json + attachments/', async () => {
    const folder = { uri: Uri.file(tmp), name: 'new-repo', index: 0 } as never;
    const seedSynced = {
      schemaVersion: 1,
      workspaceId: 'test',
      collections: {},
      environments: {},
    } as never;
    const out = await bridge.createWorkspaceScaffold(folder, seedSynced, {});

    expect(fs.existsSync(out.workspaceJsonPath)).toBe(true);
    expect(fs.existsSync(path.join(out.apicircleDir, 'attachments'))).toBe(true);
    // README.md lives in the parent .apicircle/ dir, not inside the workspace dir
    const apicircleRoot = path.join(tmp, '.apicircle');
    expect(fs.existsSync(path.join(apicircleRoot, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(apicircleRoot, 'registry.json'))).toBe(true);

    const content = JSON.parse(fs.readFileSync(out.workspaceJsonPath, 'utf8'));
    expect(content.workspaceId).toBe('test');
  });

  it('createWorkspaceScaffold refuses to overwrite an existing workspace.json', async () => {
    const folder = { uri: Uri.file(tmp), name: 'r', index: 0 } as never;
    await bridge.createWorkspaceScaffold(folder, { workspaceId: 'a' } as never, {});
    // Same workspaceId → same workspace-a/ dir → EEXIST on workspace.json
    await expect(
      bridge.createWorkspaceScaffold(folder, { workspaceId: 'a' } as never, {}),
    ).rejects.toThrow(/already exists/);
  });

  it('createWorkspaceScaffold appends defensive entries to .gitignore (idempotent)', async () => {
    const folder = { uri: Uri.file(tmp), name: 'r', index: 0 } as never;
    await bridge.createWorkspaceScaffold(folder, { workspaceId: 'a' } as never, {});

    const gitignorePath = path.join(tmp, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('workspace.local.json');
    expect(content).toContain('.apicircle/.local/');
    expect(content).toContain('.apicircle/.lock');

    // Idempotent re-run on the same folder shouldn't duplicate entries
    fs.rmSync(path.join(tmp, '.apicircle'), { recursive: true });
    await bridge.createWorkspaceScaffold(folder, { workspaceId: 'a' } as never, {});
    const content2 = fs.readFileSync(gitignorePath, 'utf8');
    const matches = content2.match(/workspace\.local\.json/g);
    expect(matches?.length).toBe(1);
  });

  it('dispose clears workspaces and active id', () => {
    bridge.registerWorkspace(makeWs(tmp));
    bridge.setActive(makeWs(tmp).id);
    bridge.dispose();
    expect(bridge.listWorkspaces()).toEqual([]);
    expect(bridge.activeWorkspace()).toBeNull();
  });

  // deactivate() awaits whenIdle() so the reads the status bars and views start
  // without awaiting cannot outlive the extension (and a test's temp folder).
  describe('whenIdle', () => {
    const STATE = { synced: { workspaceId: 'w' }, local: {} } as never;
    const spies: Array<{ mockRestore: () => void }> = [];

    afterEach(() => {
      for (const spy of spies.splice(0)) spy.mockRestore();
    });

    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    // True when `p` has settled after a full turn of the event loop.
    async function settledYet(p: Promise<unknown>): Promise<boolean> {
      let settled = false;
      const mark = () => {
        settled = true;
      };
      void p.then(mark, mark);
      await new Promise((resolve) => setImmediate(resolve));
      return settled;
    }

    it('resolves at once when no workspace operation is running', async () => {
      bridge.registerWorkspace(makeWs(tmp));
      expect(await settledYet(bridge.whenIdle())).toBe(true);
    });

    it('waits for every read, apply and write a surface started; a failed one still fails for its caller', async () => {
      const read = deferred<unknown>();
      const apply = deferred<unknown>();
      const write = deferred<unknown>();
      spies.push(
        vi.spyOn(GitWorkspaceProvider.prototype, 'read').mockReturnValue(read.promise as never),
        vi.spyOn(GitWorkspaceProvider.prototype, 'apply').mockReturnValue(apply.promise as never),
        vi.spyOn(GitWorkspaceProvider.prototype, 'write').mockReturnValue(write.promise as never),
      );
      const surface = bridge.registerWorkspace(makeWs(tmp));
      const reading = surface.read();
      const applying = surface.apply({ kind: 'request.delete', id: 'r1' } as never);
      const writing = surface.write({});
      const writeOutcome = writing.then(
        () => 'written',
        (err: Error) => err.message,
      );
      const idle = bridge.whenIdle();

      read.resolve(STATE);
      expect(await settledYet(idle)).toBe(false);
      apply.resolve({ state: STATE, changedIds: ['r1'] });
      expect(await settledYet(idle)).toBe(false);
      write.reject(new Error('disk full'));
      expect(await settledYet(idle)).toBe(true);

      await expect(reading).resolves.toBe(STATE);
      await expect(applying).resolves.toEqual({ next: STATE, changedIds: ['r1'] });
      await expect(writeOutcome).resolves.toBe('disk full');
    });

    it('also waits for an operation started by the continuation of one it was waiting on', async () => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      spies.push(
        vi
          .spyOn(GitWorkspaceProvider.prototype, 'read')
          .mockReturnValueOnce(first.promise as never)
          .mockReturnValueOnce(second.promise as never),
      );
      const surface = bridge.registerWorkspace(makeWs(tmp));
      const chain = surface.read().then(() => surface.read());
      const idle = bridge.whenIdle();

      first.resolve(STATE);
      expect(await settledYet(idle)).toBe(false);
      second.resolve(STATE);
      expect(await settledYet(idle)).toBe(true);
      await expect(chain).resolves.toBe(STATE);
    });
  });
});
