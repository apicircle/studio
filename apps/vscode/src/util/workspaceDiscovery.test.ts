import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import {
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

  it('detects a single folder with canonical .apicircle/workspace.json', () => {
    const dir = tmpDir();
    cleanup.push(dir);
    fs.mkdirSync(path.join(dir, '.apicircle'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.apicircle', 'workspace.json'), '{}');

    const r = discoverWorkspaces([makeFolder('repo-a', dir)]);
    expect(r.workspaces).toHaveLength(1);
    expect(r.workspaces[0].label).toBe('repo-a');
    expect(r.workspaces[0].apicircleDir).toBe(path.join(dir, '.apicircle'));
    expect(r.workspaces[0].workspaceJsonPath).toBe(path.join(dir, '.apicircle', 'workspace.json'));
    expect(r.foldersWithoutWorkspace).toEqual([]);
  });

  it('flags folders without .apicircle/workspace.json as candidates for "Create"', () => {
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
    fs.mkdirSync(path.join(d1, '.apicircle'), { recursive: true });
    fs.writeFileSync(path.join(d1, '.apicircle', 'workspace.json'), '{}');
    fs.mkdirSync(path.join(d3, '.apicircle'), { recursive: true });
    fs.writeFileSync(path.join(d3, '.apicircle', 'workspace.json'), '{}');

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

  it('does NOT pick up a folder named .apicircle that is not the canonical layout', () => {
    const dir = tmpDir();
    cleanup.push(dir);
    // Create .apicircle/ but no workspace.json inside
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
      apicircleDir: '/home/user/project/.apicircle',
    };
    const p1 = deviceLocalPath(globalStorage, ws);
    const p2 = deviceLocalPath(globalStorage, ws);
    expect(p1).toBe(p2);
    // path.join normalizes to the platform separator, so compare via path.dirname.
    expect(path.dirname(p1)).toBe(storageRoot);
  });

  it('produces different hashes for different .apicircle/ paths', () => {
    const globalStorage = Uri.file(path.join(os.tmpdir(), 'vscode-storage'));
    const p1 = deviceLocalPath(globalStorage, { apicircleDir: '/home/user/project-a/.apicircle' });
    const p2 = deviceLocalPath(globalStorage, { apicircleDir: '/home/user/project-b/.apicircle' });
    expect(p1).not.toBe(p2);
  });

  it('is case-insensitive and slash-normalized (Windows interoperability)', () => {
    const globalStorage = Uri.file(path.join(os.tmpdir(), 'vscode-storage'));
    const p1 = deviceLocalPath(globalStorage, {
      apicircleDir: 'C:\\Users\\dev\\project\\.apicircle',
    });
    const p2 = deviceLocalPath(globalStorage, { apicircleDir: 'c:/users/dev/project/.apicircle' });
    expect(p1).toBe(p2);
  });
});

describe('findOwningWorkspace', () => {
  it('finds the workspace whose .apicircle/ directory contains the file', () => {
    const ws: DiscoveredWorkspace = {
      id: '/repo/.apicircle',
      apicircleDir: '/repo/.apicircle',
      workspaceJsonPath: '/repo/.apicircle/workspace.json',
      workspaceFolder: { uri: Uri.file('/repo'), name: 'repo', index: 0 } as never,
      label: 'repo',
    };
    const result = {
      workspaces: [ws],
      foldersWithoutWorkspace: [],
    };
    expect(findOwningWorkspace(result, '/repo/.apicircle/workspace.json')?.label).toBe('repo');
    expect(findOwningWorkspace(result, '/repo/.apicircle/attachments/abc')?.label).toBe('repo');
  });

  it('returns undefined for paths outside any known workspace', () => {
    const ws: DiscoveredWorkspace = {
      id: '/repo/.apicircle',
      apicircleDir: '/repo/.apicircle',
      workspaceJsonPath: '/repo/.apicircle/workspace.json',
      workspaceFolder: { uri: Uri.file('/repo'), name: 'repo', index: 0 } as never,
      label: 'repo',
    };
    const result = { workspaces: [ws], foldersWithoutWorkspace: [] };
    expect(findOwningWorkspace(result, '/somewhere/else/file.txt')).toBeUndefined();
  });
});

describe('workspaceIdForOpenEditor', () => {
  const registered = [
    { id: '/repo-a/.apicircle', workspaceJsonPath: '/repo-a/.apicircle/workspace.json' },
    { id: 'C:\\repo-b\\.apicircle', workspaceJsonPath: 'C:\\repo-b\\.apicircle\\workspace.json' },
  ];
  const authorityFor = (id: string): string => Buffer.from(id, 'utf8').toString('base64url');

  it('resolves an apicircle:// editor via its base64url authority', () => {
    expect(
      workspaceIdForOpenEditor(
        { scheme: 'apicircle', authority: authorityFor('/repo-a/.apicircle'), fsPath: '' },
        registered,
      ),
    ).toBe('/repo-a/.apicircle');
  });

  it('resolves the raw .apicircle/workspace.json file (slash + case normalized)', () => {
    expect(
      workspaceIdForOpenEditor(
        { scheme: 'file', authority: '', fsPath: 'C:\\repo-b\\.apicircle\\workspace.json' },
        registered,
      ),
    ).toBe('C:\\repo-b\\.apicircle');
  });

  it('returns null for an apicircle:// authority that maps to no registered workspace', () => {
    expect(
      workspaceIdForOpenEditor(
        { scheme: 'apicircle', authority: authorityFor('/unknown/.apicircle'), fsPath: '' },
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
