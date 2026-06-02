import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { registerExportCommand } from './export';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-export-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const T0 = '2026-06-02T00:00:00.000Z';

async function seed(): Promise<string> {
  const ws = path.join(tmpDir, 'ws');
  const synced: WorkspaceSynced = {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: {
      tree: { id: 'r', type: 'root', children: [{ kind: 'folder', id: 'f-root' }] },
      requests: {
        'r-1': {
          id: 'r-1',
          name: 'POST /login',
          folderId: 'f-root',
          method: 'POST',
          url: 'https://api.example.com/login',
          headers: [],
          query: [],
          body: { type: 'none', content: '' },
          auth: { type: 'bearer', token: 'live-token' },
          contextVars: [],
          extractions: [],
          assertions: [],
          createdAt: T0,
          updatedAt: T0,
        },
      },
      folders: { 'f-root': { id: 'f-root', name: 'Auth', parentId: null } },
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
  };
  const local: WorkspaceLocal = {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: null, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
  await saveToFile(ws, { synced, local });
  return ws;
}

function buildProgram(): Command {
  const program = new Command().exitOverride();
  registerExportCommand(program);
  return program;
}

function captureStdout(): { restore: () => void; chunks: string[] } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Buffer): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    return true;
  }) as typeof process.stdout.write;
  return {
    restore: () => {
      process.stdout.write = original;
    },
    chunks,
  };
}

function captureStderr(): { restore: () => void; chunks: string[] } {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Buffer): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    return true;
  }) as typeof process.stderr.write;
  return {
    restore: () => {
      process.stderr.write = original;
    },
    chunks,
  };
}

describe('apicircle export folder', () => {
  it('writes a redacted envelope to a file', async () => {
    const ws = await seed();
    const outPath = path.join(tmpDir, 'out.json');
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'apicircle',
      'export',
      'folder',
      'Auth',
      '-w',
      ws,
      '-o',
      outPath,
    ]);
    const content = await fs.readFile(outPath, 'utf-8');
    expect(content).toContain('"format": "apicircle.folder/v1"');
    expect(content).toContain('"folderName": "Auth"');
    expect(content).not.toContain('live-token'); // redacted
    expect(content).toContain('"token": ""');
  });

  it('keeps a credential when --include-credential matches', async () => {
    const ws = await seed();
    const outPath = path.join(tmpDir, 'out.json');
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'apicircle',
      'export',
      'folder',
      'f-root',
      '-w',
      ws,
      '-o',
      outPath,
      '--include-credential',
      'request:r-1.bearer.token',
    ]);
    const content = await fs.readFile(outPath, 'utf-8');
    expect(content).toContain('live-token');
  });

  it('streams the envelope to stdout when --out is omitted', async () => {
    const ws = await seed();
    const captured = captureStdout();
    const program = buildProgram();
    try {
      await program.parseAsync(['node', 'apicircle', 'export', 'folder', 'f-root', '-w', ws]);
    } finally {
      captured.restore();
    }
    const out = captured.chunks.join('');
    expect(out).toContain('"format": "apicircle.folder/v1"');
  });

  it('lists detected credentials with --list-credentials', async () => {
    const ws = await seed();
    const captured = captureStdout();
    const program = buildProgram();
    try {
      await program.parseAsync([
        'node',
        'apicircle',
        'export',
        'folder',
        'f-root',
        '-w',
        ws,
        '--list-credentials',
      ]);
    } finally {
      captured.restore();
    }
    const out = captured.chunks.join('');
    expect(out).toContain('request:r-1.bearer.token');
    expect(out).toContain('Bearer · token');
  });

  it('prints "no credentials" when --list-credentials finds nothing', async () => {
    const ws = path.join(tmpDir, 'ws-empty');
    const synced: WorkspaceSynced = {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'folder', id: 'f' }] },
        requests: {},
        folders: { f: { id: 'f', name: 'Empty', parentId: null } },
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
    };
    const local: WorkspaceLocal = {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: { workspace: null, links: {} } },
      connectedRepo: null,
      workingBranch: null,
      seededWorkspaceSha: null,
      retiredBranch: null,
      sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
      linkedCollections: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: null,
        sidebarExpandedSections: [],
        themeId: 'studio-dark',
        fontId: 'system-mono',
        fontSizePercent: 100,
      },
      settings: { validateOnSend: true, monacoConsumesWheel: false },
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    };
    await saveToFile(ws, { synced, local });
    const captured = captureStdout();
    const program = buildProgram();
    try {
      await program.parseAsync([
        'node',
        'apicircle',
        'export',
        'folder',
        'f',
        '-w',
        ws,
        '--list-credentials',
      ]);
    } finally {
      captured.restore();
    }
    expect(captured.chunks.join('')).toContain('No credential-bearing');
  });

  it('exits with code 2 when the folder name does not match', async () => {
    const ws = await seed();
    const stderr = captureStderr();
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const program = buildProgram();
    try {
      await program.parseAsync(['node', 'apicircle', 'export', 'folder', 'Ghost', '-w', ws]);
    } catch (err) {
      expect(String(err)).toContain('exit:2');
    } finally {
      exit.mockRestore();
      stderr.restore();
    }
    expect(stderr.chunks.join('')).toMatch(/no folder matches/);
  });
});
