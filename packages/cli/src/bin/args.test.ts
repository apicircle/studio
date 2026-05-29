import { describe, expect, it } from 'vitest';
import { formatRootHelp, hasRootHelpFlag, hasRootVersionFlag } from './args';

describe('cli root args', () => {
  it.each(['--version', '-v', '-V'])('detects %s as a root version flag', (flag) => {
    expect(hasRootVersionFlag([flag])).toBe(true);
  });

  it.each(['--help', '-h', 'help'])('detects %s as a root help flag', (flag) => {
    expect(hasRootHelpFlag([flag])).toBe(true);
  });

  it('leaves subcommand help for Commander', () => {
    expect(hasRootHelpFlag(['mock', '--help'])).toBe(false);
    expect(hasRootVersionFlag(['mock', '--version'])).toBe(false);
  });

  it('formats root help with usage, version, help, and commands', () => {
    const help = formatRootHelp();
    expect(help).toContain('Usage: apicircle [options] [command]');
    expect(help).toContain('--version');
    expect(help).toContain('--help');
    expect(help).toContain('mock [options] <workspace>');
    expect(help).toContain('workspaces');
  });
});
