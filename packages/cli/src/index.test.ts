import { describe, expect, it } from 'vitest';
import { buildProgram } from './index';
import { CLI_PACKAGE_VERSION } from './packageVersion';

describe('CLI program', () => {
  it('registers the nine top-level commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'export',
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
