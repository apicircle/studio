import { describe, expect, it } from 'vitest';
import { buildProgram } from './index';
import { CLI_PACKAGE_VERSION } from './packageVersion';

describe('CLI program', () => {
  it('registers the six top-level commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['export', 'import', 'mcp', 'mock', 'run', 'workspaces']);
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
