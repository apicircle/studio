import { describe, expect, it } from 'vitest';
import { buildProgram } from './index';

describe('CLI program', () => {
  it('registers the five top-level commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['import', 'mcp', 'mock', 'run', 'workspaces']);
  });

  it('exposes a stable name and version for `--version`', () => {
    const program = buildProgram();
    expect(program.name()).toBe('apicircle');
    expect(program.version()).toBe('1.0.0');
  });
});
