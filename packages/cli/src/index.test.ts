import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  buildProgram,
  registerExportCommand,
  registerFolderCommand,
  registerImportCommand,
  registerLinkedCommand,
  registerMcpCommand,
  registerMockCommand,
  registerMocksCommand,
  registerReleaseCommand,
  registerRunCommand,
  registerWorkspacesCommand,
} from './index';
import { CLI_PACKAGE_VERSION } from './packageVersion';

describe('CLI program', () => {
  it('registers the ten top-level commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'export',
      'folder',
      'import',
      'linked',
      'mcp',
      'mock',
      'mocks',
      'release',
      'run',
      'workspaces',
    ]);
  });

  it('folder has list/create/rename/set-auth/clear-auth/move/delete subcommands', () => {
    const program = buildProgram();
    const folder = program.commands.find((c) => c.name() === 'folder');
    expect(folder).toBeDefined();
    expect(folder!.commands.map((c) => c.name()).sort()).toEqual([
      'clear-auth',
      'create',
      'delete',
      'list',
      'move',
      'rename',
      'set-auth',
    ]);
  });

  it('linked has list/link/refresh/unlink subcommands', () => {
    const program = buildProgram();
    const linked = program.commands.find((c) => c.name() === 'linked');
    expect(linked).toBeDefined();
    expect(linked!.commands.map((c) => c.name()).sort()).toEqual([
      'link',
      'list',
      'refresh',
      'unlink',
    ]);
  });

  it('release has tag/topics subcommands', () => {
    const program = buildProgram();
    const release = program.commands.find((c) => c.name() === 'release');
    expect(release).toBeDefined();
    expect(release!.commands.map((c) => c.name()).sort()).toEqual(['tag', 'topics']);
  });

  it('exposes a stable name and version for `--version`', () => {
    const program = buildProgram();
    expect(program.name()).toBe('apicircle');
    expect(program.version()).toBe(CLI_PACKAGE_VERSION);
  });

  it('exposes help for command-line users', () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain('Usage: apicircle [options] [command]');
    expect(help).toContain('--version');
    expect(help).toContain('--help');
  });
});

describe('CLI composition seam (out-of-tree extension)', () => {
  it('re-exports all ten command registrars for out-of-tree composition', () => {
    for (const fn of [
      registerMockCommand,
      registerMocksCommand,
      registerMcpCommand,
      registerImportCommand,
      registerExportCommand,
      registerRunCommand,
      registerWorkspacesCommand,
      registerLinkedCommand,
      registerReleaseCommand,
      registerFolderCommand,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('an enterprise CLI can extend buildProgram() with its own command + rebrand the name', () => {
    const program = buildProgram();
    program.name('apicircle-ee'); // version stays the public one (see fresh-program test for full control)
    program.command('generate').description('enterprise generate');
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('generate'); // EE command added
    expect(names).toContain('mock'); // public commands still present
    expect(program.name()).toBe('apicircle-ee');
  });

  it('a fresh program composed from registrars gets full name + version control', () => {
    const program = new Command().name('apicircle-ee').version('9.9.9');
    registerMockCommand(program);
    registerRunCommand(program);
    expect(program.commands.map((c) => c.name()).sort()).toEqual(['mock', 'run']);
    expect(program.version()).toBe('9.9.9');
  });

  it('a registrar attaches its command group to a caller-owned program', () => {
    const program = new Command().name('apicircle-ee');
    registerReleaseCommand(program);
    const release = program.commands.find((c) => c.name() === 'release');
    expect(release).toBeDefined();
    expect(release!.commands.map((c) => c.name()).sort()).toEqual(['tag', 'topics']);
  });
});
