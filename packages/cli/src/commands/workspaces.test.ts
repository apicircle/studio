import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { loadRegistry } from '@apicircle/core/workspace/registry';
import { registerWorkspacesCommand } from './workspaces';

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-ws-'));
  workspacesRoot = path.join(tmpDir, 'workspaces');
  prevEnv = process.env.APICIRCLE_WORKSPACES_ROOT;
  process.env.APICIRCLE_WORKSPACES_ROOT = workspacesRoot;

  // Capture stdout/stderr by replacing the writers. Each subcommand prints
  // formatted output we want to assert on; we restore the real writers
  // before each test so this file stays self-contained.
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
  return program;
}

function out(): string {
  return stdout.join('');
}

function err(): string {
  return stderr.join('');
}

async function run(args: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(['node', 'apicircle', ...args]);
  } catch (e) {
    // Swallow only our own process.exit() impostor; let real errors surface.
    if (e instanceof Error && e.message.startsWith('__cli_exit__:')) return;
    throw e;
  }
}

describe('apicircle workspaces list', () => {
  it('shows a friendly empty-state when no registry has been seeded', async () => {
    await run(['workspaces', 'list']);
    expect(out()).toMatch(/No workspaces registered yet/);
    expect(out()).toMatch(/apicircle workspaces create/);
  });

  it('emits a JSON envelope with --json (script-friendly)', async () => {
    await run(['workspaces', 'list', '--json']);
    const parsed: unknown = JSON.parse(out());
    expect(parsed).toMatchObject({
      registry: { schemaVersion: 1, activeWorkspaceId: null, workspaces: [] },
    });
  });

  it('lists registered workspaces with the active one marked', async () => {
    await run(['workspaces', 'create', 'Alpha']);
    stdout.length = 0;
    await run(['workspaces', 'create', 'Beta']);
    stdout.length = 0;
    await run(['workspaces', 'list']);
    const text = out();
    expect(text).toMatch(/Alpha/);
    expect(text).toMatch(/Beta/);
    // The first-created workspace becomes active; mark "●" appears next to it.
    expect(text).toMatch(/●/);
  });
});

describe('apicircle workspaces create', () => {
  it('creates a new workspace and registers it as active when none was set', async () => {
    await run(['workspaces', 'create', 'Petstore']);
    expect(out()).toMatch(/created workspace/);
    expect(out()).toMatch(/Petstore/);
    expect(out()).toMatch(/marked as active/);
    const registry = await loadRegistry(workspacesRoot);
    expect(registry?.workspaces).toHaveLength(1);
    expect(registry?.workspaces[0].name).toBe('Petstore');
    expect(registry?.activeWorkspaceId).toBe(registry?.workspaces[0].id);
  });

  it('rejects duplicate names (case-insensitive)', async () => {
    await run(['workspaces', 'create', 'Petstore']);
    stderr.length = 0;
    await run(['workspaces', 'create', 'petstore']);
    expect(err()).toMatch(/already exists/);
    expect(exitCode).toBe(2);
  });

  it('--sample seeds one request in the new workspace', async () => {
    await run(['workspaces', 'create', 'Demo', '--sample']);
    const registry = await loadRegistry(workspacesRoot);
    const ws = registry?.workspaces[0];
    expect(ws).toBeDefined();
    const synced = JSON.parse(
      await fs.readFile(path.join(workspacesRoot, ws!.id, 'workspace.synced.json'), 'utf-8'),
    ) as { collections: { requests: Record<string, unknown> } };
    expect(Object.keys(synced.collections.requests)).toHaveLength(1);
  });

  it('rejects an empty name', async () => {
    await run(['workspaces', 'create', '   ']);
    expect(err()).toMatch(/Workspace name is required/);
    expect(exitCode).toBe(2);
  });
});

describe('apicircle workspaces use', () => {
  beforeEach(async () => {
    await run(['workspaces', 'create', 'Alpha']);
    stdout.length = 0;
    await run(['workspaces', 'create', 'Beta']);
    stdout.length = 0;
  });

  it('switches the active workspace by name', async () => {
    await run(['workspaces', 'use', 'Beta']);
    expect(out()).toMatch(/active workspace is now/);
    expect(out()).toMatch(/Beta/);
    const registry = await loadRegistry(workspacesRoot);
    const beta = registry?.workspaces.find((w) => w.name === 'Beta');
    expect(registry?.activeWorkspaceId).toBe(beta?.id);
  });

  it('switches by id', async () => {
    const registry = await loadRegistry(workspacesRoot);
    const beta = registry?.workspaces.find((w) => w.name === 'Beta');
    await run(['workspaces', 'use', beta!.id]);
    const after = await loadRegistry(workspacesRoot);
    expect(after?.activeWorkspaceId).toBe(beta!.id);
  });

  it('matches names case-insensitively', async () => {
    await run(['workspaces', 'use', 'BeTa']);
    const registry = await loadRegistry(workspacesRoot);
    const beta = registry?.workspaces.find((w) => w.name === 'Beta');
    expect(registry?.activeWorkspaceId).toBe(beta?.id);
  });

  it('emits a clean error when the selector is unknown', async () => {
    await run(['workspaces', 'use', 'Gamma']);
    expect(err()).toMatch(/no workspace named "Gamma"/);
    expect(err()).toMatch(/apicircle workspaces list/);
    expect(exitCode).toBe(2);
  });
});

describe('apicircle workspaces path', () => {
  it('prints the workspaces root when called without an argument', async () => {
    await run(['workspaces', 'path']);
    expect(out().trim()).toBe(workspacesRoot);
  });

  it('prints the on-disk path for a registered workspace', async () => {
    await run(['workspaces', 'create', 'Alpha']);
    stdout.length = 0;
    await run(['workspaces', 'path', 'Alpha']);
    const registry = await loadRegistry(workspacesRoot);
    const id = registry?.workspaces[0].id;
    expect(out().trim()).toBe(path.join(workspacesRoot, id!));
  });

  it('emits a clean error when the selector is unknown', async () => {
    await run(['workspaces', 'path', 'nope']);
    expect(err()).toMatch(/no workspace named "nope"/);
    expect(exitCode).toBe(2);
  });
});

describe('command discovery', () => {
  // Sanity-check that the subcommand was registered with the canonical
  // shape so `--help` doesn't surprise users.
  it('exposes four subcommands: list, create, use, path', () => {
    const program = buildProgram();
    const wsCmd = program.commands.find((c) => c.name() === 'workspaces');
    expect(wsCmd).toBeDefined();
    const subs = wsCmd!.commands.map((c) => c.name()).sort();
    expect(subs).toEqual(['create', 'list', 'path', 'use']);
  });
});

// `vi` import is unused but keeping the namespace handy if future tests
// need it (e.g. clock mocks for lastOpenedAt assertions).
void vi;
