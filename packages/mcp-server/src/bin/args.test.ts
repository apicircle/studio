import { describe, expect, it } from 'vitest';
import { formatHelp, hasHelpFlag, hasVersionFlag } from './args';

describe('mcp-server args', () => {
  it.each(['--version', '-v', '-V'])('detects %s as a version flag', (flag) => {
    expect(hasVersionFlag([flag])).toBe(true);
  });

  it('does not treat workspace arguments as version flags', () => {
    expect(hasVersionFlag(['--workspace', './workspace'])).toBe(false);
  });

  it.each(['--help', '-h', 'help'])('detects %s as a help flag', (flag) => {
    expect(hasHelpFlag([flag])).toBe(true);
  });

  it('formats help with usage, version, help, and workspace options', () => {
    expect(formatHelp()).toContain('Usage: apicircle-mcp [options]');
    expect(formatHelp()).toContain('--workspace <dir>');
    expect(formatHelp()).toContain('--version');
    expect(formatHelp()).toContain('--help');
  });
});
