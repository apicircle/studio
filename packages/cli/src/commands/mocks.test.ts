import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { loadFromFile } from '@apicircle/core/workspace/file-backed';
import type { MockServer } from '@apicircle/shared';
import { registerMocksCommand, parsePortArg } from './mocks';
import { ensureWorkspace } from '../util/loadWorkspace';

let tmpDir: string;
let workspaceDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | null;
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;
let originalExit: typeof process.exit;

function makeMock(over: Partial<MockServer> = {}): MockServer {
  return {
    id: 'm1',
    name: 'Petstore',
    source: { kind: 'manual', endpoints: [] },
    endpoints: [],
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-mocks-'));
  workspaceDir = path.join(tmpDir, 'ws');
  await fs.mkdir(workspaceDir, { recursive: true });

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
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function buildProgram(): Command {
  const program = new Command().exitOverride();
  registerMocksCommand(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(['node', 'apicircle', ...args]);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('__cli_exit__:')) return;
    throw e;
  }
}

async function seedMock(over?: Partial<MockServer>): Promise<void> {
  const state = await ensureWorkspace(workspaceDir);
  const mock = makeMock(over);
  state.synced.mockServers[mock.id] = mock;
  const { saveToFile } = await import('@apicircle/core/workspace/file-backed');
  await saveToFile(workspaceDir, state);
}

describe('parsePortArg', () => {
  it('returns null for undefined / empty / auto / null inputs', () => {
    expect(parsePortArg(undefined)).toBeNull();
    expect(parsePortArg('')).toBeNull();
    expect(parsePortArg('auto')).toBeNull();
    expect(parsePortArg('AUTO')).toBeNull();
    expect(parsePortArg('null')).toBeNull();
  });

  it('returns a valid integer in 1024-65535', () => {
    expect(parsePortArg('3000')).toBe(3000);
    expect(parsePortArg('1024')).toBe(1024);
    expect(parsePortArg('65535')).toBe(65535);
  });

  it('returns "invalid" for out-of-range / non-integer inputs', () => {
    expect(parsePortArg('80')).toBe('invalid');
    expect(parsePortArg('99999')).toBe('invalid');
    expect(parsePortArg('1.5')).toBe('invalid');
    expect(parsePortArg('abc')).toBe('invalid');
  });
});

describe('apicircle mocks set-port', () => {
  it('persists a valid port on the matched mock', async () => {
    await seedMock();
    await run(['mocks', 'set-port', 'Petstore', '3000', '--workspace-path', workspaceDir]);
    const after = await loadFromFile(workspaceDir);
    expect(after?.synced.mockServers.m1.defaultPort).toBe(3000);
    expect(stdout.join('')).toMatch(/updated/);
    expect(exitCode).toBeNull();
  });

  it('clears the port back to null when the user passes "auto"', async () => {
    await seedMock({ defaultPort: 5000 });
    await run(['mocks', 'set-port', 'Petstore', 'auto', '--workspace-path', workspaceDir]);
    const after = await loadFromFile(workspaceDir);
    expect(after?.synced.mockServers.m1.defaultPort).toBeNull();
  });

  it('clears the port when the port arg is omitted entirely', async () => {
    await seedMock({ defaultPort: 5000 });
    await run(['mocks', 'set-port', 'Petstore', '--workspace-path', workspaceDir]);
    const after = await loadFromFile(workspaceDir);
    expect(after?.synced.mockServers.m1.defaultPort).toBeNull();
  });

  it('matches by id when the selector is the mock id', async () => {
    await seedMock();
    await run(['mocks', 'set-port', 'm1', '4040', '--workspace-path', workspaceDir]);
    const after = await loadFromFile(workspaceDir);
    expect(after?.synced.mockServers.m1.defaultPort).toBe(4040);
  });

  it('exits 2 with an error when the selector matches nothing', async () => {
    await seedMock();
    await run(['mocks', 'set-port', 'ghost', '3000', '--workspace-path', workspaceDir]);
    expect(exitCode).toBe(2);
    expect(stderr.join('')).toMatch(/no mock named "ghost"/);
  });

  it('exits 2 with an error when the port is out of range', async () => {
    await seedMock();
    await run(['mocks', 'set-port', 'Petstore', '80', '--workspace-path', workspaceDir]);
    expect(exitCode).toBe(2);
    expect(stderr.join('')).toMatch(/port must be an integer in 1024-65535/);
    // Unchanged because we never wrote.
    const after = await loadFromFile(workspaceDir);
    expect(after?.synced.mockServers.m1.defaultPort).toBeNull();
  });

  it('is a no-op when the requested port matches the current port', async () => {
    await seedMock({ defaultPort: 3030 });
    const before = await loadFromFile(workspaceDir);
    await run(['mocks', 'set-port', 'Petstore', '3030', '--workspace-path', workspaceDir]);
    const after = await loadFromFile(workspaceDir);
    expect(after?.synced.mockServers.m1.updatedAt).toBe(before?.synced.mockServers.m1.updatedAt);
    expect(stdout.join('')).toMatch(/unchanged/);
  });
});

describe('apicircle mocks list', () => {
  it('emits a JSON list when --json is set', async () => {
    await seedMock({ defaultPort: 3000 });
    await run(['mocks', 'list', '--workspace-path', workspaceDir, '--json']);
    const parsed = JSON.parse(stdout.join('')) as Array<{
      id: string;
      name: string;
      defaultPort: number | null;
    }>;
    expect(parsed).toEqual([{ id: 'm1', name: 'Petstore', defaultPort: 3000, endpoints: 0 }]);
  });

  it('renders the empty-state line when there are no mocks', async () => {
    await ensureWorkspace(workspaceDir);
    await run(['mocks', 'list', '--workspace-path', workspaceDir]);
    expect(stdout.join('')).toMatch(/No mock servers/);
  });
});
