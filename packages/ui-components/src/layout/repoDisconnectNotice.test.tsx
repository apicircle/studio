import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { RepoDisconnectNoticeProvider, useRepoDisconnectNotice } from './repoDisconnectNotice';

describe('repoDisconnectNotice', () => {
  it('adds nothing when no edition supplies a notice', () => {
    // The strict no-op that keeps Studio standalone unchanged.
    expect(renderHook(() => useRepoDisconnectNotice()).result.current).toBeNull();
  });

  it('hands the edition its own notice back inside a provider', () => {
    const notice = <p>The edition forgets its folder for this repository.</p>;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RepoDisconnectNoticeProvider value={notice}>{children}</RepoDisconnectNoticeProvider>
    );
    expect(renderHook(() => useRepoDisconnectNotice(), { wrapper }).result.current).toBe(notice);
  });
});
