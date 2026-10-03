import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GIT_HOST_ACCESS,
  GitHostAccessProvider,
  isGitHostLocked,
  useGitHostAccess,
  type GitHostAccess,
} from './gitHostAccess';

describe('gitHostAccess', () => {
  it('locks nothing when no edition supplies a policy', () => {
    // The strict no-op that keeps Studio standalone unchanged.
    expect(DEFAULT_GIT_HOST_ACCESS.lockedHosts).toEqual([]);
    for (const host of ['github', 'gitlab', 'bitbucket', 'azure-devops'] as const) {
      expect(isGitHostLocked(DEFAULT_GIT_HOST_ACCESS, host)).toBe(false);
    }
  });

  it('locks exactly the hosts the policy names', () => {
    const access: GitHostAccess = { lockedHosts: ['gitlab', 'azure-devops'] };
    expect(isGitHostLocked(access, 'gitlab')).toBe(true);
    expect(isGitHostLocked(access, 'azure-devops')).toBe(true);
    expect(isGitHostLocked(access, 'bitbucket')).toBe(false);
  });

  it('never locks GitHub, which is built into the core', () => {
    expect(isGitHostLocked({ lockedHosts: ['github'] }, 'github')).toBe(false);
  });

  it('reads the default outside a provider, and the supplied policy inside one', () => {
    expect(renderHook(() => useGitHostAccess()).result.current).toBe(DEFAULT_GIT_HOST_ACCESS);

    const access: GitHostAccess = { lockedHosts: ['bitbucket'] };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GitHostAccessProvider value={access}>{children}</GitHostAccessProvider>
    );
    expect(renderHook(() => useGitHostAccess(), { wrapper }).result.current).toBe(access);
  });
});
