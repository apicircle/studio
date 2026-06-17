import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import {
  discoverRegistryWorkspaces,
  discoverWorkspaces,
  deviceLocalPath,
  findOwningWorkspace,
  workspaceIdForOpenEditor,
  type DiscoveredWorkspace,
} from './workspaceDiscovery';

function makeFolder(name: string, fsPath: string) {
  return {
    uri: Uri.file(fsPath),
    name,
    index: 0,
  } as unknown as Parameters<typeof discoverWorkspaces>[0] extends readonly (infer T)[] | undefined
    ? T
    : never;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-vscode-test-'));
}

describe('discoverWorkspaces', () => {
  let cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    cleanup = [];
  });

  it('returns empty result when no folders are open', () => {
    const r = discoverWorkspaces(undefined);
    expect(r.workspaces).toEqual([]);
    expect(r.foldersWithoutWorkspace).toEqual([]);
  });

  it('returns empty result when folders array is empty', () => {
    const r = discoverWorkspaces([]);
    expect(r.workspaces).toEqual([]);
    expect(r.foldersWithoutWorkspace).toEqual([]);
  });

  it('detects a single folder with canonical .apicircle/registry.json + workspace-<id>/workspace.json', () => {
    const dir = tmpDir();
    cleanup.push(dir);
    const apicircleRoot = path.join(dir, '.apicircle');
    const wsDir = path.join(apicircleRoot, 'workspace-ws1');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'workspace.json'), '{}');
    const registry = {
      schemaVersion: 1,
      activeWorkspaceId: 'ws1',
      workspaces: [{ id: 'ws1', name: 'repo-a', createdAt: 't', lastOpenedAt: 't' }],
    };
    fs.writeFileSync(path.join(apicircleRoot, 'registry.json'), JSON.stringify(registry));

    const r = discoverWorkspaces([makeFolder('repo-a', dir)]);
    expect(r.workspaces).toHaveLength(1);
    expect(r.workspaces[0].label).toBe('repo-a');
    expect(r.workspaces[0].apicircleDir).toBe(wsDir);
    expect(r.workspaces[0].workspaceJsonPath).toBe(path.join(wsDir, 'workspace.json'));
    expect(r.foldersWithoutWorkspace).toEqual([]);
  });

  it('flags folders without .apicircle/registry.json as candidates for "Create"', () => {
    const dir = tmpDir();
    cleanup.push(dir);
    // No .apicircle/ created

    const r = discoverWorkspaces([makeFolder('empty-repo', dir)]);
    expect(r.workspaces).toEqual([]);
    expect(r.foldersWithoutWorkspace).toHaveLength(1);
    expect(r.foldersWithoutWorkspace[0].name).toBe('empty-repo');
  });

  it('handles multi-root: mixed workspaces and empty folders', () => {
    const d1 = tmpDir();
    const d2 = tmpDir();
    const d3 = tmpDir();
    cleanup.push(d1, d2, d3);

    const d1Root = path.join(d1, '.apicircle');
    const d1WsDir = path.join(d1Root, 'workspace-ws1');
    fs.mkdirSync(d1WsDir, { recursive: true });
    fs.writeFileSync(path.join(d1WsDir, 'workspace.json'), '{}');
    fs.writeFileSync(
      path.join(d1Root, 'registry.json'),
      JSON.stringify({
        schemaVersion: 1,
        activeWorkspaceId: 'ws1',
        workspaces: [{ id: 'ws1', name: 'repo-one', createdAt: 't', lastOpenedAt: 't' }],
      }),
    );

    const d3Root = path.join(d3, '.apicircle');
    const d3WsDir = path.join(d3Root, 'workspace-ws3');
    fs.mkdirSync(d3WsDir, { recursive: true });
    fs.writeFileSync(path.join(d3WsDir, 'workspace.json'), '{}');
    fs.writeFileSync(
      path.join(d3Root, 'registry.json'),
      JSON.stringify({
        schemaVersion: 1,
        activeWorkspaceId: 'ws3',
        workspaces: [{ id: 'ws3', name: 'repo-two', createdAt: 't', lastOpenedAt: 't' }],
      }),
    );

    const r = discoverWorkspaces([
      makeFolder('repo-one', d1),
      makeFolder('no-workspace', d2),
      makeFolder('repo-two', d3),
    ]);
    expect(r.workspaces).toHaveLength(2);
    expect(r.workspaces.map((w) => w.label).sort()).toEqual(['repo-one', 'repo-two']);
    expect(r.foldersWithoutWorkspace).toHaveLength(1);
    expect(r.foldersWithoutWorkspace[0].name).toBe('no-workspace');
  });

  it('does NOT pick up a folder with .apicircle/ but no registry.json', () => {
    const dir = tmpDir();
    cleanup.push(dir);
    // Create .apicircle/ but no registry.json inside
    fs.mkdirSync(path.join(dir, '.apicircle'), { recursive: true });

    const r = discoverWorkspaces([makeFolder('half-baked', dir)]);
    expect(r.workspaces).toEqual([]);
    expect(r.foldersWithoutWorkspace).toHaveLength(1);
  });
});

describe('deviceLocalPath', () => {
  it('produces a stable hash-based subfolder under globalStorageUri', () => {
    const storageRoot = path.join(os.tmpdir(), 'vscode-storage');
    const globalStorage = Uri.file(storageRoot);
    const ws: Pick<DiscoveredWorkspace, 'apicircleDir'> = {
      apicircleDir: '/home/user/project/.apicircle/workspace-ws-1',
    };
    const p1 = deviceLocalPath(globalStorage, ws);
    const p2 = deviceLocalPath(globalStorage, ws);
    expect(p1).toBe(p2);
    // path.join normalizes to the platform separator, so compare via path.dirname.
    expect(path.dirname(p1)).toBe(storageRoot);
  });

  it('produces different hashes for different workspace-<id>/ paths', () => {
    const globalStorage = Uri.file(path.join(os.tmpdir(), 'vscode-storage'));
    const p1 = deviceLocalPath(globalStorage, {
      apicircleDir: '/home/user/project-a/.apicircle/workspace-ws-1',
    });
    const p2 = deviceLocalPath(globalStorage, {
      apicircleDir: '/home/user/project-b/.apicircle/workspace-ws-2',
    });
    expect(p1).not.toBe(p2);
  });

  it('is case-insensitive and slash-normalized (Windows interoperability)', () => {
    const globalStorage = Uri.file(path.join(os.tmpdir(), 'vscode-storage'));
    const p1 = deviceLocalPath(globalStorage, {
      apicircleDir: 'C:\\Users\\dev\\project\\.apicircle\\workspace-ws-1',
    });
    const p2 = deviceLocalPath(globalStorage, {
      apicircleDir: 'c:/users/dev/project/.apicircle/workspace-ws-1',
    });
    expect(p1).toBe(p2);
  });
});

describe('findOwningWorkspace', () => {
  it('finds the workspace whose workspace-<id>/ directory contains the file', () => {
    const ws: DiscoveredWorkspace = {
      id: 'ws-1',
      apicircleDir: '/repo/.apicircle/workspace-ws-1',
      workspaceJsonPath: '/repo/.apicircle/workspace-ws-1/workspace.json',
      workspaceFolder: { uri: Uri.file('/repo'), name: 'repo', index: 0 } as never,
      label: 'repo',
      source: 'git-folder',
    };
    const result = {
      workspaces: [ws],
      foldersWithoutWorkspace: [],
    };
    expect(
      findOwningWorkspace(result, '/repo/.apicircle/workspace-ws-1/workspace.json')?.label,
    ).toBe('repo');
    expect(
      findOwningWorkspace(result, '/repo/.apicircle/workspace-ws-1/attachments/abc')?.label,
    ).toBe('repo');
  });

  it('returns undefined for paths outside any known workspace', () => {
    const ws: DiscoveredWorkspace = {
      id: 'ws-1',
      apicircleDir: '/repo/.apicircle/workspace-ws-1',
      workspaceJsonPath: '/repo/.apicircle/workspace-ws-1/workspace.json',
      workspaceFolder: { uri: Uri.file('/repo'), name: 'repo', index: 0 } as never,
      label: 'repo',
      source: 'git-folder',
    };
    const result = { workspaces: [ws], foldersWithoutWorkspace: [] };
    expect(findOwningWorkspace(result, '/somewhere/else/file.txt')).toBeUndefined();
  });
});

describe('workspaceIdForOpenEditor', () => {
  const registered = [
    { id: 'ws-a', workspaceJsonPath: '/repo-a/.apicircle/workspace-ws-a/workspace.json' },
    { id: 'ws-b', workspaceJsonPath: 'C:\\repo-b\\.apicircle\\workspace-ws-b\\workspace.json' },
  ];
  const authorityFor = (id: string): string => Buffer.from(id, 'utf8').toString('hex');

  it('resolves an apicircle:// editor via its hex authority', () => {
    expect(
      workspaceIdForOpenEditor(
        { scheme: 'apicircle', authority: authorityFor('ws-a'), fsPath: '' },
        registered,
      ),
    ).toBe('ws-a');
  });

  it('resolves the raw .apicircle/workspace-<id>/workspace.json file (slash + case normalized)', () => {
    expect(
      workspaceIdForOpenEditor(
        {
          scheme: 'file',
          authority: '',
          fsPath: 'C:\\repo-b\\.apicircle\\workspace-ws-b\\workspace.json',
        },
        registered,
      ),
    ).toBe('ws-b');
  });

  it('returns null for an apicircle:// authority that maps to no registered workspace', () => {
    expect(
      workspaceIdForOpenEditor(
        { scheme: 'apicircle', authority: authorityFor('ws-unknown'), fsPath: '' },
        registered,
      ),
    ).toBeNull();
  });

  it('returns null for a file editor that is not a workspace.json', () => {
    expect(
      workspaceIdForOpenEditor(
        { scheme: 'file', authority: '', fsPath: '/repo-a/src/index.ts' },
        registered,
      ),
    ).toBeNull();
  });

  it('returns null for an unrelated scheme or an empty authority', () => {
    expect(
      workspaceIdForOpenEditor({ scheme: 'untitled', authority: '', fsPath: '' }, registered),
    ).toBeNull();
    expect(
      workspaceIdForOpenEditor({ scheme: 'apicircle', authority: '', fsPath: '' }, registered),
    ).toBeNull();
  });
});

describe('discoverRegistryWorkspaces', () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty array when registry.json is missing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-reg-'));
    const result = discoverRegistryWorkspaces(tmp);
    expect(result).toEqual([]);
  });

  it('returns empty array when registry.json is malformed', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-reg-'));
    fs.writeFileSync(path.join(tmp, 'registry.json'), 'not json');
    const result = discoverRegistryWorkspaces(tmp);
    expect(result).toEqual([]);
  });

  it('discovers workspaces from a valid registry.json', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-reg-'));
    const wsDir = path.join(tmp, 'workspace-ws-abc');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'workspace.json'), '{}');

    const registry = {
      schemaVersion: 1,
      activeWorkspaceId: 'ws-abc',
      workspaces: [
        { id: 'ws-abc', name: 'My Workspace', createdAt: '2026-01-01', lastOpenedAt: '2026-01-01' },
      ],
    };
    fs.writeFileSync(path.join(tmp, 'registry.json'), JSON.stringify(registry));

    const result = discoverRegistryWorkspaces(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ws-abc');
    expect(result[0].label).toBe('My Workspace');
    expect(result[0].source).toBe('registry');
    expect(result[0].workspaceFolder).toBeUndefined();
    expect(result[0].apicircleDir).toBe(wsDir);
    expect(result[0].workspaceJsonPath).toBe(path.join(wsDir, 'workspace.json'));
  });

  it('skips registry entries whose workspace.json does not exist', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-reg-'));
    const registry = {
      schemaVersion: 1,
      activeWorkspaceId: 'ws-missing',
      workspaces: [
        { id: 'ws-missing', name: 'Ghost', createdAt: '2026-01-01', lastOpenedAt: '2026-01-01' },
      ],
    };
    fs.writeFileSync(path.join(tmp, 'registry.json'), JSON.stringify(registry));

    const result = discoverRegistryWorkspaces(tmp);
    expect(result).toEqual([]);
  });

  it('discovers multiple workspaces, skipping missing ones', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-reg-'));
    // ws-a exists
    const wsA = path.join(tmp, 'workspace-ws-a');
    fs.mkdirSync(wsA, { recursive: true });
    fs.writeFileSync(path.join(wsA, 'workspace.json'), '{}');
    // ws-b missing (no dir)
    // ws-c exists
    const wsC = path.join(tmp, 'workspace-ws-c');
    fs.mkdirSync(wsC, { recursive: true });
    fs.writeFileSync(path.join(wsC, 'workspace.json'), '{}');

    const registry = {
      schemaVersion: 1,
      activeWorkspaceId: 'ws-a',
      workspaces: [
        { id: 'ws-a', name: 'Alpha', createdAt: '2026-01-01', lastOpenedAt: '2026-01-01' },
        { id: 'ws-b', name: 'Beta', createdAt: '2026-01-01', lastOpenedAt: '2026-01-01' },
        { id: 'ws-c', name: 'Charlie', createdAt: '2026-01-01', lastOpenedAt: '2026-01-01' },
      ],
    };
    fs.writeFileSync(path.join(tmp, 'registry.json'), JSON.stringify(registry));

    const result = discoverRegistryWorkspaces(tmp);
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.id)).toEqual(['ws-a', 'ws-c']);
  });
});
