import { describe, it, expect } from 'vitest';
import { parseGitHubRemote } from './repoActions';

describe('parseGitHubRemote', () => {
  it('parses https remotes', () => {
    expect(parseGitHubRemote('https://github.com/octo-org/payments')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('parses https remotes with a .git suffix', () => {
    expect(parseGitHubRemote('https://github.com/octo-org/payments.git')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('parses ssh remotes', () => {
    expect(parseGitHubRemote('git@github.com:octo-org/payments.git')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('parses ssh:// remotes', () => {
    expect(parseGitHubRemote('ssh://git@github.com/octo-org/payments')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('trims trailing whitespace/newlines', () => {
    expect(parseGitHubRemote('https://github.com/o/n\n')).toEqual({ owner: 'o', name: 'n' });
  });

  it('returns null for non-GitHub remotes', () => {
    expect(parseGitHubRemote('https://gitlab.com/o/n')).toBeNull();
    expect(parseGitHubRemote('')).toBeNull();
  });
});
