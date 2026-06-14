import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from './vscodeBridge';
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

  it('createWorkspaceScaffold creates .apicircle/ + workspace.json + attachments/', async () => {
    const folder = { uri: Uri.file(tmp), name: 'new-repo', index: 0 } as never;
    const seedSynced = { schemaVersion: 1, workspaceId: 'test', collections: {}, environments: {} };
    const out = await bridge.createWorkspaceScaffold(folder, seedSynced, {});

    expect(fs.existsSync(out.workspaceJsonPath)).toBe(true);
    expect(fs.existsSync(path.join(out.apicircleDir, 'attachments'))).toBe(true);
    expect(fs.existsSync(path.join(out.apicircleDir, 'README.md'))).toBe(true);

    const content = JSON.parse(fs.readFileSync(out.workspaceJsonPath, 'utf8'));
    expect(content.workspaceId).toBe('test');
  });

  it('createWorkspaceScaffold refuses to overwrite an existing workspace.json', async () => {
    const folder = { uri: Uri.file(tmp), name: 'r', index: 0 } as never;
    await bridge.createWorkspaceScaffold(folder, { workspaceId: 'a' }, {});
    await expect(bridge.createWorkspaceScaffold(folder, { workspaceId: 'b' }, {})).rejects.toThrow(
      /already exists/,
    );
  });

  it('createWorkspaceScaffold appends defensive entries to .gitignore (idempotent)', async () => {
    const folder = { uri: Uri.file(tmp), name: 'r', index: 0 } as never;
    await bridge.createWorkspaceScaffold(folder, { workspaceId: 'a' }, {});

    const gitignorePath = path.join(tmp, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('workspace.local.json');
    expect(content).toContain('.apicircle/.local/');
    expect(content).toContain('.apicircle/.lock');

    // Idempotent re-run on the same folder shouldn't duplicate entries
    fs.rmSync(path.join(tmp, '.apicircle'), { recursive: true });
    await bridge.createWorkspaceScaffold(folder, { workspaceId: 'a' }, {});
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
});
