import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './github/api';
import {
  getGitProvider,
  gitHostKindFromOrigin,
  hasGitProvider,
  registerGitProvider,
  resetGitProviderRegistry,
  type GitProvider,
} from './provider';

afterEach(() => resetGitProviderRegistry());

describe('getGitProvider', () => {
  it('returns a GitHubClient for the default (github) kind', () => {
    expect(getGitProvider()).toBeInstanceOf(GitHubClient);
    expect(getGitProvider('github')).toBeInstanceOf(GitHubClient);
  });

  it('forwards construction options to the github factory', () => {
    const fetchImpl = vi.fn();
    // Smoke: options are accepted and a client is built (no throw).
    expect(getGitProvider('github', { fetchImpl, timeoutMs: 1234 })).toBeInstanceOf(GitHubClient);
  });

  it('throws a helpful error for an unregistered non-github kind', () => {
    expect(() => getGitProvider('gitlab')).toThrow(/No Git provider registered for host "gitlab"/);
  });

  it('resolves a registered non-github provider and forwards options', () => {
    const fake = {} as GitProvider;
    const factory = vi.fn(() => fake);
    registerGitProvider('gitlab', factory);
    expect(getGitProvider('gitlab', { timeoutMs: 5 })).toBe(fake);
    expect(factory).toHaveBeenCalledWith({ timeoutMs: 5 });
  });
});

describe('registerGitProvider', () => {
  it('refuses to re-register the built-in github provider', () => {
    expect(() => registerGitProvider('github', () => ({}) as GitProvider)).toThrow(/built in/);
  });
});

describe('hasGitProvider', () => {
  it('github is always available; other hosts only after registration', () => {
    expect(hasGitProvider('github')).toBe(true);
    expect(hasGitProvider('bitbucket')).toBe(false);
    registerGitProvider('bitbucket', () => ({}) as GitProvider);
    expect(hasGitProvider('bitbucket')).toBe(true);
  });
});

describe('gitHostKindFromOrigin', () => {
  it.each([
    [null, 'github'],
    [undefined, 'github'],
    ['https://github.com/me/api.git', 'github'],
    ['git@github.com:me/api.git', 'github'],
    ['https://gitlab.com/me/api.git', 'gitlab'],
    ['git@gitlab.example.com:me/api.git', 'gitlab'],
    ['https://bitbucket.org/me/api', 'bitbucket'],
    ['https://dev.azure.com/org/proj/_git/api', 'azure-devops'],
    ['https://myorg.visualstudio.com/proj/_git/api', 'azure-devops'],
    ['https://git.mycorp.internal/me/api.git', 'github'],
  ] as const)('maps %s -> %s', (origin, expected) => {
    expect(gitHostKindFromOrigin(origin)).toBe(expected);
  });
});
