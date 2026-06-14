import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { registerWorkspacesCommand } from './workspaces';
import { registerFolderCommand } from './folder';

let tmpDir: string;
let workspacesRoot: string;
let prevEnv: string | undefined;
let stdout: string[];
let stderr: string[];
let exitCode: number | null;
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;
let originalExit: typeof process.exit;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-fld-'));
  workspacesRoot = path.join(tmpDir, 'workspaces');
  prevEnv = process.env.APICIRCLE_WORKSPACES_ROOT;
  process.env.APICIRCLE_WORKSPACES_ROOT = workspacesRoot;

  stdout = [];
  stderr = [];
  exitCode = null;
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  originalExit = process.exit.bind(process);
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__cli_exit__:${exitCode}`);
  }) as typeof process.exit;
});

afterEach(async () => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  process.exit = originalExit;
  if (prevEnv === undefined) delete process.env.APICIRCLE_WORKSPACES_ROOT;
  else process.env.APICIRCLE_WORKSPACES_ROOT = prevEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function buildProgram(): Command {
  const program = new Command().exitOverride();
  registerWorkspacesCommand(program);
  registerFolderCommand(program);
  return program;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

function out(): string {
  return stripAnsi(stdout.join(''));
}

function err(): string {
  return stripAnsi(stderr.join(''));
}

async function run(args: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(['node', 'apicircle', ...args]);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('__cli_exit__:')) return;
    throw e;
  }
}

async function seedWorkspace(name: string): Promise<void> {
  await run(['workspaces', 'create', name]);
  stdout.length = 0;
  stderr.length = 0;
}

async function createFolder(name: string, opts: { parent?: string } = {}): Promise<string> {
  stdout.length = 0;
  stderr.length = 0;
  const args = ['folder', 'create', '--name', name, '--workspace-name', 'Demo'];
  if (opts.parent) args.push('--parent', opts.parent);
  await run(args);
  const m = stripAnsi(stdout.join('')).match(/created\s+(\S+)/);
  if (!m) throw new Error(`createFolder: no id in output: ${stripAnsi(stdout.join(''))}`);
  return m[1];
}

describe('apicircle folder', () => {
  it('list shows empty-state on a fresh workspace', async () => {
    await seedWorkspace('Demo');
    await run(['folder', 'list', '--workspace-name', 'Demo']);
    expect(out()).toMatch(/No folders/);
  });

  it('create + list round-trip', async () => {
    await seedWorkspace('Demo');
    await run(['folder', 'create', '--name', 'API v2', '--workspace-name', 'Demo']);
    expect(out()).toMatch(/created/);
    expect(out()).toMatch(/API v2/);

    stdout.length = 0;
    await run(['folder', 'list', '--workspace-name', 'Demo']);
    expect(out()).toMatch(/API v2/);
  });

  it('create with --parent nests the folder', async () => {
    await seedWorkspace('Demo');
    const parentId = await createFolder('Parent');
    await createFolder('Child', { parent: parentId });

    stdout.length = 0;
    await run(['folder', 'list', '--json', '--workspace-name', 'Demo']);
    const folders = JSON.parse(out()) as Array<{ name: string; parentId: string | null }>;
    const child = folders.find((f) => f.name === 'Child');
    expect(child?.parentId).toBe(parentId);
  });

  it('create seeds initial bearer auth in a single call', async () => {
    await seedWorkspace('Demo');
    stdout.length = 0;
    await run([
      'folder',
      'create',
      '--name',
      'Authed',
      '--type',
      'bearer',
      '--token',
      'INIT',
      '--workspace-name',
      'Demo',
    ]);
    expect(out()).toMatch(/auth=bearer/);
    stdout.length = 0;
    await run(['folder', 'list', '--json', '--workspace-name', 'Demo']);
    const folders = JSON.parse(out()) as Array<{
      name: string;
      auth?: { type: string; token?: string };
    }>;
    const me = folders.find((f) => f.name === 'Authed');
    expect(me?.auth).toEqual({ type: 'bearer', token: 'INIT' });
  });

  it('rename succeeds, then fails on duplicate sibling name', async () => {
    await seedWorkspace('Demo');
    await createFolder('A');
    const idB = await createFolder('B');

    stdout.length = 0;
    await run(['folder', 'rename', idB, '--name', 'BB', '--workspace-name', 'Demo']);
    expect(out()).toMatch(/renamed/);

    stderr.length = 0;
    await run(['folder', 'rename', idB, '--name', 'A', '--workspace-name', 'Demo']);
    expect(err()).toMatch(/rejected/);
    expect(exitCode).toBe(1);
  });

  it('set-auth bearer + clear-auth round-trip', async () => {
    await seedWorkspace('Demo');
    const id = await createFolder('Auth');

    stdout.length = 0;
    await run([
      'folder',
      'set-auth',
      id,
      '--type',
      'bearer',
      '--token',
      'TOK',
      '--workspace-name',
      'Demo',
    ]);
    expect(out()).toMatch(/auth\.type=bearer/);

    stdout.length = 0;
    await run(['folder', 'list', '--json', '--workspace-name', 'Demo']);
    const folders = JSON.parse(out()) as Array<{
      id: string;
      auth?: { type: string; token?: string };
    }>;
    const me = folders.find((f) => f.id === id);
    expect(me?.auth).toEqual({ type: 'bearer', token: 'TOK' });

    stdout.length = 0;
    await run(['folder', 'clear-auth', id, '--workspace-name', 'Demo']);
    expect(out()).toMatch(/cleared auth/);

    stdout.length = 0;
    await run(['folder', 'list', '--json', '--workspace-name', 'Demo']);
    const after = JSON.parse(out()) as Array<{ id: string; auth?: unknown }>;
    expect(after.find((f) => f.id === id)?.auth).toBeUndefined();
  });

  it('set-auth rejects an unsupported type with a CLI-friendly message', async () => {
    await seedWorkspace('Demo');
    const id = await createFolder('Auth');

    stderr.length = 0;
    await run([
      'folder',
      'set-auth',
      id,
      '--type',
      'oauth2-client-credentials',
      '--workspace-name',
      'Demo',
    ]);
    expect(err()).toMatch(/not supported by the CLI/);
    expect(err()).toMatch(/VS Code/);
    expect(exitCode).toBe(2);
  });

  it('move reparents a folder; cycle attempt is rejected', async () => {
    await seedWorkspace('Demo');
    const idA = await createFolder('A');
    const idB = await createFolder('B');

    stdout.length = 0;
    await run(['folder', 'move', idB, '--parent', idA, '--workspace-name', 'Demo']);
    expect(out()).toMatch(/moved/);

    stderr.length = 0;
    await run(['folder', 'move', idA, '--parent', idB, '--workspace-name', 'Demo']);
    expect(err()).toMatch(/rejected/);
    expect(exitCode).toBe(1);
  });

  it('delete removes the folder; missing-id errors with exit 1', async () => {
    await seedWorkspace('Demo');
    const id = await createFolder('A');

    stdout.length = 0;
    await run(['folder', 'delete', id, '--workspace-name', 'Demo']);
    expect(out()).toMatch(/deleted/);

    stderr.length = 0;
    await run(['folder', 'delete', 'ghost', '--workspace-name', 'Demo']);
    expect(err()).toMatch(/not found/);
    expect(exitCode).toBe(1);
  });
});
